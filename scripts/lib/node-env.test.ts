import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchLandCover } from '../../src/data/landcover';
import { bboxAround } from '../../src/data/live';
import { decodePng, nodeEnv, readDotenv } from './node-env';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Four ESA WorldCover tiles (Planetary Computer, z13) under the recorded Kalimantan 18 Oct box,
// committed in the tile-cache layout so the Node env reads them without the network.
const FIXTURES = join(process.cwd(), 'scripts', 'lib', 'fixtures');

describe('Node data env', () => {
  it('decodes real cached grey+alpha tiles to RGBA, the same classes the browser read', async () => {
    const env = nodeEnv({ cacheDir: FIXTURES, offline: true });
    const lc = await fetchLandCover(bboxAround(-2.8179, 110.6934), 64, 64, env.fetchTile);
    const hist: Record<number, number> = {};
    for (const c of lc.cls) hist[c] = (hist[c] ?? 0) + 1;
    // Built in the browser on 24 Oct (createImageBitmap), the recorded event has exactly this land cover.
    expect(hist).toEqual({ 10: 1815, 20: 945, 30: 1261, 40: 52, 90: 23 });
    expect(lc.known).toBe(1);
  });

  it('expands grey to RGB and keeps alpha', () => {
    const file = join(FIXTURES, 'tiles', 'planetarycomputer.microsoft.com', 'ee69775e2702905e2c88a5f7b8065e1e9f82aa70.png');
    const t = decodePng(readFileSync(file));
    expect([t.width, t.height, t.data.length]).toEqual([256, 256, 256 * 256 * 4]);
    for (let i = 0; i < t.data.length; i += 4) {
      expect(t.data[i + 1]).toBe(t.data[i]);
      expect(t.data[i + 2]).toBe(t.data[i]);
    }
  });

  it('offline mode refuses uncached requests and never puts the FIRMS key in an error', async () => {
    const env = nodeEnv({ cacheDir: FIXTURES, offline: true, firmsKey: 'SECRETKEY123' });
    await expect(env.fetchTile('https://example.org/1/2/3.png')).rejects.toThrow(/offline/);
    const err = await env.firms([110, -3, 110.1, -2.9], 1).catch((e: Error) => e.message);
    expect(err).toMatch(/offline/);
    expect(err).not.toContain('SECRETKEY123');
  });

  it('reads public/ from disk and dotenv files', async () => {
    const env = nodeEnv({ offline: true });
    const ix = (await env.fetchJson('data/osm-barriers/index.json')) as { kind: string } | null;
    expect(ix?.kind).toBe('fireseptum.osm-barriers');
    expect(await env.fetchJson('data/does-not-exist.json')).toBeNull();
    const dir = mkdtempSync(join(tmpdir(), 'fs-env-'));
    writeFileSync(join(dir, '.env'), '# c\nFIRMS_MAP_KEY="abc"\nexport OTHER=1\n');
    expect(readDotenv(join(dir, '.env'))).toEqual({ FIRMS_MAP_KEY: 'abc', OTHER: '1' });
  });
});
