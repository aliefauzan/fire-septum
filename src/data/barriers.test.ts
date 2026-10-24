import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRAIN_CAP_M,
  barrierTileKeys,
  decodeBarrierTile,
  loadBarriers,
  rasterizeBarriers,
  type BarrierFeature,
  type BarrierGeo,
  type BarrierIndex,
  type BarrierTile,
} from './barriers';

const KINDS = ['canal', 'ditch', 'drain', 'river', 'stream', 'road_major', 'road_minor', 'track', 'water', 'built'];
const M_PER_DEG = 111_320;

/** A box of w × h cells of `cellM` metres whose south-west corner is (south, west). */
function box(south: number, west: number, w = 64, h = 64, cellM = 100): BarrierGeo {
  const dLat = (h * cellM) / M_PER_DEG;
  const dLon = (w * cellM) / (M_PER_DEG * Math.cos(((south + dLat / 2) * Math.PI) / 180));
  return { south, west, north: south + dLat, east: west + dLon };
}
const colLon = (g: BarrierGeo, w: number, x: number) => g.west + ((x + 0.5) / w) * (g.east - g.west);

describe('decodeBarrierTile', () => {
  it('decodes absolute-then-delta integer coordinates', () => {
    const tile: BarrierTile = {
      b: [114.25, -3, 114.5, -2.75],
      l: [[0, 11430000, -290000, 10, -5, 3, 4]],
      a: [[8, 11431000, -291000, 100, 0, 0, 100, -100, 0, 0, -100]],
    };
    const f = decodeBarrierTile(tile, KINDS, 1e5);
    expect(f).toHaveLength(2);
    expect(f[0].kind).toBe('canal');
    expect(f[0].closed).toBe(false);
    expect(f[0].pts.map((p) => [p.lon, p.lat])).toEqual([
      [114.3, -2.9],
      [114.3001, -2.90005],
      [114.30013, -2.90001],
    ].map(([lon, lat]) => [expect.closeTo(lon, 9), expect.closeTo(lat, 9)]));
    expect(f[1].kind).toBe('water');
    expect(f[1].closed).toBe(true);
    expect(f[1].pts).toHaveLength(5);
    expect(f[1].pts[4]).toEqual(f[1].pts[0]);
  });
});

describe('barrierTileKeys', () => {
  it('lists every 0.25° tile a box touches, with negative latitudes', () => {
    expect(barrierTileKeys({ south: -3.1, north: -2.9, west: 114.2, east: 114.3 })).toEqual([
      '-3.25_114.00', '-3.25_114.25', '-3.00_114.00', '-3.00_114.25',
    ]);
  });
  it('does not add neighbours a box only shares an edge with', () => {
    expect(barrierTileKeys({ south: -3, north: -2.75, west: 114.25, east: 114.5 })).toEqual(['-3.00_114.25']);
  });
  it('crosses the equator', () => {
    expect(barrierTileKeys({ south: -0.1, north: 0.1, west: 101.3, east: 101.4 })).toEqual(['-0.25_101.25', '0.00_101.25']);
  });
});

describe('rasterizeBarriers', () => {
  const w = 64, h = 64;
  const g = box(-2.95, 114.37, w, h);

  it('turns a canal crossing the box into a 4-connected water line', () => {
    // Diagonal canal entering through the north edge and leaving through the south edge.
    const canal: BarrierFeature = {
      kind: 'canal', closed: false,
      pts: [{ lat: g.north + 0.01, lon: g.west }, { lat: g.south - 0.01, lon: g.east }],
    };
    const r = rasterizeBarriers(g, w, h, [canal]);
    expect(r.features).toBe(1);
    const water = r.fuel.map((f) => f === 'water');
    expect(water.filter(Boolean).length).toBeGreaterThan(64);
    // Flood fill 4-connected from the first water cell: every water cell must be reached.
    const start = water.indexOf(true);
    const seen = new Uint8Array(w * h);
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % w, y = (k / w) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (water[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    expect(water.every((v, k) => !v || seen[k] === 1)).toBe(true);
    // And the line spans the box edge to edge.
    const rows = new Set<number>();
    water.forEach((v, k) => v && rows.add((k / w) | 0));
    expect(rows.size).toBe(h);
  });

  it('measures distance to a straight canal and drainage density around it', () => {
    const lon = colLon(g, w, 20);
    const canal: BarrierFeature = { kind: 'canal', closed: false, pts: [{ lat: g.north + 0.1, lon }, { lat: g.south - 0.1, lon }] };
    const r = rasterizeBarriers(g, w, h, [canal]);
    const row = 32;
    for (let x = 0; x < w; x++) expect(r.fuel[row * w + x]).toBe(x === 20 ? 'water' : null);
    expect(r.drainDistM[row * w + 20]).toBe(0);
    expect(r.drainDistM[row * w + 30]).toBeCloseTo(1000, -1);
    expect(r.drainDistM[row * w + 5]).toBeCloseTo(1500, -1);
    expect(r.drainDistM[row * w + 63]).toBeCloseTo(4300, -1);
    // A straight line through a 1 km disk: 2 km of canal over π km² ≈ 0.64 km/km².
    expect(r.canalKmPerKm2[row * w + 20]).toBeGreaterThan(0.55);
    expect(r.canalKmPerKm2[row * w + 20]).toBeLessThan(0.75);
    expect(r.canalKmPerKm2[row * w + 40]).toBe(0);
  });

  it('counts a canal just outside the box and caps far distances', () => {
    const lon = g.east + 500 / (M_PER_DEG * Math.cos((g.south * Math.PI) / 180));
    const outside: BarrierFeature = { kind: 'ditch', closed: false, pts: [{ lat: g.north, lon }, { lat: g.south, lon }] };
    const r = rasterizeBarriers(g, w, h, [outside]);
    expect(r.fuel.every((f) => f === null)).toBe(true);
    expect(r.features).toBe(0);
    // True distance 550 m; the transform works between cell centres, so allow half a cell.
    expect(r.drainDistM[32 * w + 63]).toBeGreaterThanOrEqual(500);
    expect(r.drainDistM[32 * w + 63]).toBeLessThanOrEqual(600);
    const none = rasterizeBarriers(g, w, h, []);
    expect(none.drainDistM.every((d) => d === DRAIN_CAP_M)).toBe(true);
  });

  it('fills water and built areas, roads become firebreaks, rivers do not count as drainage', () => {
    const c = (x: number, y: number) => ({ lat: g.north - (y / h) * (g.north - g.south), lon: g.west + (x / w) * (g.east - g.west) });
    const lake: BarrierFeature = { kind: 'water', closed: true, pts: [c(10, 10), c(20, 10), c(20, 20), c(10, 20), c(10, 10)] };
    const town: BarrierFeature = { kind: 'built', closed: true, pts: [c(40, 40), c(50, 40), c(50, 50), c(40, 50), c(40, 40)] };
    const track: BarrierFeature = { kind: 'track', closed: false, pts: [c(0, 30.5), c(64, 30.5)] };
    const river: BarrierFeature = { kind: 'river', closed: false, pts: [c(30.5, 0), c(30.5, 64)] };
    const r = rasterizeBarriers(g, w, h, [lake, town, track, river]);
    expect(r.fuel[15 * w + 15]).toBe('water');
    expect(r.fuel[45 * w + 45]).toBe('settlement');
    expect(r.fuel[30 * w + 5]).toBe('settlement');
    expect(r.fuel[30 * w + 30]).toBe('water'); // river wins over track where they cross
    expect(r.drainDistM.every((d) => d === DRAIN_CAP_M)).toBe(true);
  });
});

describe('loadBarriers', () => {
  it('memoises the index and removes the overlap between neighbouring tiles', async () => {
    // One straight canal at lat -2.9 from 114.20 to 114.30, stored in both tiles with ~200 m of padding.
    const q = (lon: number, lat: number) => [Math.round(lon * 1e5), Math.round(lat * 1e5)];
    const line = (a: number, b: number) => { const [x0, y0] = q(a, -2.9), [x1] = q(b, -2.9); return [0, x0, y0, x1 - x0, 0]; };
    const files: Record<string, unknown> = {
      'data/osm-barriers/index.json': {
        v: 1, kind: 'fireseptum.osm-barriers', tileDeg: 0.25, quant: 1e5, generatedAt: '', sources: [], simplifyM: 7, kinds: KINDS,
        tiles: { '-3.00_114.00': { bytes: 1, lines: 1, areas: 0 }, '-3.00_114.25': { bytes: 1, lines: 1, areas: 0 } },
      } satisfies BarrierIndex,
      'data/osm-barriers/-3.00_114.00.json': { b: [114, -3, 114.25, -2.75], l: [line(114.2, 114.2518)], a: [] },
      'data/osm-barriers/-3.00_114.25.json': { b: [114.25, -3, 114.5, -2.75], l: [line(114.2482, 114.3)], a: [] },
    };
    const calls: string[] = [];
    const fetchJson = async (p: string) => { calls.push(p); return files[p] ?? null; };
    const geo = { south: -2.95, north: -2.85, west: 114.22, east: 114.28 };
    const feats = await loadBarriers(geo, fetchJson, 0);
    const totalDeg = feats.reduce((s, f) => s + Math.abs(f.pts[f.pts.length - 1].lon - f.pts[0].lon), 0);
    expect(totalDeg).toBeCloseTo(0.06, 6); // clipped to the box, no double counting at the seam
    await loadBarriers(geo, fetchJson, 0);
    expect(calls.filter((c) => c.endsWith('index.json'))).toHaveLength(1);
  });

  it('throws when the snapshot is missing', async () => {
    await expect(loadBarriers({ south: 0, north: 0.01, west: 100, east: 100.01 }, async () => null)).rejects.toThrow(/snapshot missing/);
  });

  const dir = join(process.cwd(), 'public');
  const real = existsSync(join(dir, 'data/osm-barriers/index.json'));
  it.runIf(real)('finds the ex-Mega Rice Project canals in the real snapshot (Central Kalimantan, -2.9 114.4)', async () => {
    const fetchJson = async (p: string) => {
      const f = join(dir, p);
      return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
    };
    const geo = box(-2.93, 114.37, 64, 64);
    expect(barrierTileKeys(geo)).toEqual(['-3.00_114.25']);
    const feats = await loadBarriers(geo, fetchJson);
    const canals = feats.filter((f) => f.kind === 'canal');
    expect(canals.length).toBeGreaterThan(0);
    const r = rasterizeBarriers(geo, 64, 64, feats);
    expect(r.fuel.some((f) => f === 'water')).toBe(true);
    expect(Math.min(...r.drainDistM)).toBe(0);
    expect(Math.max(...r.canalKmPerKm2)).toBeGreaterThan(0);
  });
});
