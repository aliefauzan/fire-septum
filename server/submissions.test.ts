import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BLOCKS, FORECAST_GRID, FORECAST_SCHEMA, type Forecast } from '../src/sim/forecast';
import { canonical } from './register';
import { memoryBlob } from './store';
import { makeSubmissionsHandler, submissionsCollection } from './submissions';

const NOW = Date.parse('2026-10-24T10:30:00Z');
const forecast = (over: Partial<Forecast> = {}): Forecast => ({
  schema: FORECAST_SCHEMA, model: { id: 'example-gbm', name: 'GBM', version: '0.1' },
  issuedAt: '2026-10-24T10:00:00Z', windowH: 24, grid: FORECAST_GRID,
  box: { lat: -2.96, lon: 112.15 }, probabilities: new Array(BLOCKS).fill(0.05), ...over,
});

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function setup(o: { readOnly?: boolean; anchorOk?: boolean; token?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'subs-'));
  dirs.push(root);
  const blob = memoryBlob();
  const store = submissionsCollection({ root, readOnly: o.readOnly ?? false, blob: o.readOnly ? blob : null });
  let anchored = 0;
  const handler = makeSubmissionsHandler({
    getStore: () => store,
    anchor: async () => { anchored++; return o.anchorOk === false ? null : { calendar: 'https://cal.test', ots: Buffer.from('ots') }; },
    now: () => NOW,
    token: () => o.token,
  });
  const call = (method: string, body?: unknown, headers: Record<string, string> = {}) => new Promise<{ status: number; json: Record<string, unknown> }>((resolve) => {
    const req = { method, url: '/api/submissions', headers, body: body === undefined ? undefined : JSON.stringify(body) } as unknown as IncomingMessage;
    const res = { statusCode: 200, setHeader() {}, end: (s: string) => resolve({ status: res.statusCode, json: JSON.parse(s) }) };
    handler(req, res as unknown as ServerResponse, () => resolve({ status: 404, json: {} }));
  });
  return { root, blob, store, call, anchored: () => anchored };
}

describe('POST /api/submissions', () => {
  it('validates, hashes, timestamps and stores a forecast once', async () => {
    const t = setup();
    const f = forecast();
    const r = await t.call('POST', { forecast: f });
    const sha = createHash('sha256').update(canonical(f)).digest('hex');
    expect(r.status).toBe(200);
    expect(r.json.sha256).toBe(sha);
    expect(r.json.file).toBe(`data/submissions/2026-10-24/example-gbm_${sha.slice(0, 16)}.json`);
    expect(readdirSync(join(t.root, 'data', 'submissions', '2026-10-24'))).toEqual([`example-gbm_${sha.slice(0, 16)}.json`]);
    const again = await t.call('POST', { forecast: f });
    expect(again.status).toBe(409);
    expect(t.anchored()).toBe(1);
    const list = await t.call('GET');
    expect((list.json.submissions as { sha256: string; anchor: { calendar: string } }[]).map((s) => [s.sha256, s.anchor.calendar])).toEqual([[sha, 'https://cal.test']]);
  });

  it.each([
    ['an invalid forecast', { probabilities: [0.1] }, 'not a valid forecast'],
    ['a reserved model id', { model: { id: 'fire-septum-ca', name: 'x', version: '1' } }, 'reserved'],
    ['the forecaster model id', { model: { id: 'fire-septum-gbm', name: 'x', version: '1' } }, 'reserved'],
    ['a forecast issued in the future', { issuedAt: '2026-10-24T10:31:00Z' }, 'future'],
    ['a late forecast', { issuedAt: '2026-10-24T09:00:00Z' }, 'late'],
    ['a box outside Indonesia', { box: { lat: 14.6, lon: 121 } }, 'outside Indonesia'],
  ])('refuses %s', async (_n, over, why) => {
    const t = setup();
    const r = await t.call('POST', { forecast: forecast(over as Partial<Forecast>) });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).toContain(why);
    expect(t.anchored()).toBe(0);
  });

  it('stores nothing when OpenTimestamps fails', async () => {
    const t = setup({ anchorOk: false });
    expect((await t.call('POST', { forecast: forecast() })).status).toBe(502);
    expect((await t.store.list()).length).toBe(0);
  });

  it('writes to Blob, write-once, when hosted with a token', async () => {
    const t = setup({ readOnly: true });
    expect(t.store.mode).toBe('blob');
    expect((await t.call('POST', { forecast: forecast() })).status).toBe(200);
    expect((await t.call('POST', { forecast: forecast() })).status).toBe(409);
    expect([...t.blob.data.keys()]).toHaveLength(1);
    expect([...t.blob.data.keys()][0]).toMatch(/^submissions\/records\/2026-10-24\/example-gbm_[0-9a-f]{16}\.json$/);
  });

  it('requires the bearer token when SUBMISSIONS_TOKEN is set', async () => {
    const t = setup({ token: 'sekret' });
    expect((await t.call('POST', { forecast: forecast() })).status).toBe(401);
    expect((await t.call('POST', { forecast: forecast() }, { authorization: 'Bearer sekret' })).status).toBe(200);
  });
});
