import { describe, expect, it } from 'vitest';
import { computeBoxFeatures, FEATURE_DOCS, FEATURE_NAMES, featureIndex, featureRow, fwiDateAt, fwiFeatureValues, NF, type FeatureName } from './features';
import { FUEL_INDEX } from './fuels';
import { scoreBlocks } from './hindcast';
import { burnDisc, emptyState, igniteDisc } from './landscape';
import type { Landscape } from './types';

const T0 = '2023-09-10T18:00:00Z';
const hoursBefore = (h: number) => new Date(Date.parse(T0) - h * 3.6e6).toISOString();

function box(opts: { drain?: boolean; history?: boolean } = {}) {
  const w = 64, h = 64;
  const fuel = new Uint8Array(w * h).fill(FUEL_INDEX.peat);
  for (let x = 0; x < w; x++) fuel[40 * w + x] = FUEL_INDEX.water; // a canal along row 40
  const elev = new Float32Array(w * h).map((_, k) => 10 + (k % w) * 0.1);
  const l = { w, h, cellM: 100, fuel, elev, zoneOf: new Uint8Array(w * h), zones: [] } as unknown as Landscape;
  if (opts.drain) l.drainM = new Float32Array(w * h).map((_, k) => Math.abs(Math.floor(k / w) - 40) * 100);
  if (opts.history) l.fireYears = new Uint8Array(w * h).fill(2);
  const init = emptyState(l);
  const hotspots = [
    { x: 30, y: 30, acquired: hoursBefore(0), frp: 12 },
    { x: 32, y: 30, acquired: hoursBefore(5), frp: 8 },
    { x: 26, y: 30, acquired: hoursBefore(30), frp: 3 },
  ];
  for (const p of hotspots) {
    const age = (Date.parse(T0) - Date.parse(p.acquired)) / 3.6e6;
    if (age > 24) burnDisc(l, init, p.x, p.y, 1.9); else igniteDisc(l, init, p.x, p.y, 1.9, 0.5);
  }
  return { l, init, hotspots };
}

const at = (f: ReturnType<typeof computeBoxFeatures>, b: number, n: FeatureName) => f.x[b * NF + featureIndex(n)];

describe('block features', () => {
  it('documents every column once', () => {
    expect(new Set(FEATURE_NAMES).size).toBe(FEATURE_NAMES.length);
    expect(FEATURE_DOCS.every(([, d]) => d.length >= 15)).toBe(true);
  });

  it('uses the scorer\'s candidate blocks', () => {
    const { l, init, hotspots } = box();
    const f = computeBoxFeatures({ landscape: l, init, hotspots, t0: T0 });
    const s = scoreBlocks({ w: 64, h: 64, cellM: 100, block: 4 }, new Array(256).fill(0), f.fireAtT0, []);
    expect(f.candidate.reduce((a, v) => a + v, 0)).toBe(s.candidates);
  });

  it('measures distance, counts and age from t0', () => {
    const { l, init, hotspots } = box();
    const f = computeBoxFeatures({ landscape: l, init, hotspots, t0: T0 });
    const b = 7 * 16 + 10; // block (10, 7): centre (41.5, 29.5)
    expect(at(f, b, 'd_active_km')).toBeCloseTo(Math.sqrt(9.5 ** 2 + 0.5 ** 2) * 0.1, 12);
    expect(at(f, b, 'd_older_km')).toBeCloseTo(Math.sqrt(15.5 ** 2 + 0.5 ** 2) * 0.1, 12);
    expect(at(f, b, 'n_active_3km')).toBe(2);
    expect(at(f, b, 'n_active_1km')).toBe(1);
    expect(at(f, b, 'frp_active_3km')).toBe(20);
    expect(at(f, b, 'n_active_box')).toBe(2);
    expect(at(f, b, 'n_older_box')).toBe(1);
    expect(at(f, b, 'fire_duration_h')).toBe(30);
    // The fire moved east (centroid 26 → 31), and this block lies east of it.
    expect(at(f, b, 'spread_align')).toBeGreaterThan(0.9);
    expect(at(f, 7 * 16 + 2, 'spread_align')).toBeLessThan(-0.9);
  });

  it('leaves missing layers, FWI and wind as NaN', () => {
    const { l, init, hotspots } = box();
    const f = computeBoxFeatures({ landscape: l, init, hotspots, t0: T0 });
    for (const n of ['drain_min_m', 'canal_density', 'fire_years_mean', 'dc', 'wind_align'] as const) expect(at(f, 0, n)).toBeNaN();
    expect(at(f, 0, 'peat_frac')).toBe(1);
    expect(at(f, 10 * 16 + 3, 'f_water')).toBe(0.25); // row 40 is in block row 10
  });

  it('fills layers, FWI and wind when given', () => {
    const { l, init, hotspots } = box({ drain: true, history: true });
    const fwi = { ffmc: 90, dmc: 60, dc: 600, isi: 8, bui: 90, fwi: 25, daysSinceRain: 12, rain24: 0, rh: 55, windKmh: 9, tempC: 33 };
    const f = computeBoxFeatures({ landscape: l, init, hotspots, t0: T0, fwi, windFromDeg: 270 });
    expect(at(f, 10 * 16 + 3, 'drain_min_m')).toBe(0);
    expect(at(f, 0, 'fire_years_max')).toBe(2);
    expect(at(f, 0, 'dc')).toBe(600);
    expect(at(f, 0, 'days_since_rain')).toBe(12);
    // Wind from the west blows east: the eastern block is downwind.
    expect(at(f, 7 * 16 + 10, 'wind_align')).toBeGreaterThan(0.99);
    expect(at(f, 0, 'doy')).toBe(253);
  });

  it('is deterministic and row-addressable', () => {
    const { l, init, hotspots } = box({ drain: true });
    const a = computeBoxFeatures({ landscape: l, init, hotspots, t0: T0 });
    const b = computeBoxFeatures({ landscape: l, init, hotspots, t0: Date.parse(T0) });
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(featureRow(a, 5)).toHaveLength(NF);
  });

  it('dates FWI at the latest 05 UTC', () => {
    expect(fwiDateAt('2023-09-10T18:00:00Z')).toBe('2023-09-10');
    expect(fwiDateAt('2023-09-10T04:59:00Z')).toBe('2023-09-09');
    expect(fwiFeatureValues(null).every(Number.isNaN)).toBe(true);
  });
});
