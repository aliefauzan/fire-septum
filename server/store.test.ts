import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collection, memoryBlob } from './store';

interface Rec { hash: string; n: number; score?: unknown }
const H = (c: string) => c.repeat(64);
const name = (r: Rec) => `2026102410_${r.hash.slice(0, 16)}.json`;

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'store-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const make = (dir: string, readOnly: boolean, blob = memoryBlob()) => ({ blob, c: collection<Rec>({ dir, rel: 'data/x', prefix: 'x', hashOf: (r) => r.hash, readOnly, blob }) });

describe('write-once store: filesystem', () => {
  it('adds once, scores once, and never overwrites', async () => {
    const dir = tmp();
    const { c } = make(dir, false);
    expect(c.mode).toBe('fs');
    const r = { hash: H('a'), n: 1 };
    expect(await c.add(name(r), r)).toEqual({ status: 200, file: `data/x/${name(r)}` });
    expect((await c.add(name(r), { ...r, n: 2 })).status).toBe(409);
    expect(await c.addScore(H('a'), { csi: 0.5 })).toEqual({ status: 200 });
    const again = await c.addScore(H('a'), { csi: 0.9 });
    expect(again).toMatchObject({ status: 409, score: { csi: 0.5 } });
    expect(JSON.parse(readFileSync(join(dir, name(r)), 'utf8'))).toEqual({ hash: H('a'), n: 1, score: { csi: 0.5 } });
    expect((await c.addScore(H('b'), {})).status).toBe(404);
  });

  it('finds records in day sub-folders', async () => {
    const dir = tmp();
    const c = collection<Rec>({ dir, rel: 'data/s', prefix: 's', hashOf: (r) => r.hash, readOnly: false, recursive: true });
    await c.add(`2026-10-24/m_${H('c').slice(0, 16)}.json`, { hash: H('c'), n: 3 });
    expect(readdirSync(join(dir, '2026-10-24'))).toHaveLength(1);
    expect((await c.find(H('c')))?.n).toBe(3);
    expect(await c.list()).toHaveLength(1);
  });

  it('is read-only without a blob store on a serverless host', async () => {
    const { c } = make(tmp(), true, null as never);
    expect(c.mode).toBe('read-only');
    expect((await c.add(name({ hash: H('a'), n: 1 }), { hash: H('a'), n: 1 })).status).toBe(405);
  });
});

describe('write-once store: Vercel Blob (in-memory fake)', () => {
  it('lists bundled files ∪ blobs, writes new records and scores as blobs, never overwrites', async () => {
    const dir = tmp();
    mkdirSync(dir, { recursive: true });
    const bundled = { hash: H('a'), n: 1 };
    writeFileSync(join(dir, name(bundled)), JSON.stringify(bundled));
    const { c, blob } = make(dir, true);
    expect(c.mode).toBe('blob');

    // A bundled record cannot be stored again, not even as a blob.
    expect((await c.add(name(bundled), bundled)).status).toBe(409);
    const fresh = { hash: H('b'), n: 2 };
    expect(await c.add(name(fresh), fresh)).toEqual({ status: 200, file: `blob:x/records/${name(fresh)}` });
    expect((await c.add(name(fresh), { ...fresh, n: 99 })).status).toBe(409);
    expect(JSON.parse(blob.data.get(`x/records/${name(fresh)}`)!).n).toBe(2);

    // Scores: once, as separate blobs; the bundled file is untouched.
    expect(await c.addScore(H('a'), { csi: 0.1 })).toEqual({ status: 200 });
    expect(await c.addScore(H('a'), { csi: 0.2 })).toMatchObject({ status: 409, score: { csi: 0.1 } });
    expect(await c.addScore(H('b'), { csi: 0.3 })).toEqual({ status: 200 });
    expect(JSON.parse(readFileSync(join(dir, name(bundled)), 'utf8')).score).toBeUndefined();
    expect([...blob.data.keys()].sort()).toEqual([`x/records/${name(fresh)}`, `x/scores/${H('a').slice(0, 16)}.json`, `x/scores/${H('b').slice(0, 16)}.json`]);

    const all = await c.list();
    expect(all.map((r) => [r.n, r.score])).toEqual([[1, { csi: 0.1 }], [2, { csi: 0.3 }]]);
  });

  it('keeps a bundled score over a blob score and does not list a blob twice', async () => {
    const dir = tmp();
    const scored = { hash: H('d'), n: 4, score: { csi: 1 } };
    writeFileSync(join(dir, name(scored)), JSON.stringify(scored));
    const { c, blob } = make(dir, true);
    await blob.create(`x/records/${name(scored)}`, JSON.stringify({ hash: H('d'), n: 4 }));
    await blob.create(`x/scores/${H('d').slice(0, 16)}.json`, JSON.stringify({ csi: 0 }));
    expect(await c.list()).toEqual([scored]);
    expect((await c.addScore(H('d'), { csi: 2 })).status).toBe(409);
  });
});
