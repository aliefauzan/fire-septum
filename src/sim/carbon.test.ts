// Burn depth by fire history and the Monte Carlo emission range.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeEnv } from '../../scripts/lib/node-env';
import { sampleFireHistory } from '../data/fireHistorySample';
import { BURN_CLASS_LABEL, burnClassOf, classTdmHa, emissionRange, normalDraw, emissions, peatHaByClassPerRun, peatHaPerRun, peatMask, tco2ePerHa } from './carbon';
import { DEFAULT_RATES, type Rates } from './doctrine';
import { runEnsemble } from './ensemble';
import { observedEmissions } from './frp';
import { decode, type RunInputs } from './receipt';
import { ENTRY_KIND, type RegisterEntry } from './register';
import { sketchScenario } from './scenarios';
import type { EnsembleResult, Hotspot, Landscape } from './types';

/** A fake ensemble: run r ignites the first `burn(r)` peat cells (by index) at hour 1. */
function fakeEnsemble(l: Landscape, burn: (r: number) => number, runs = 40): EnsembleResult {
  const peat = peatMask(l);
  const peatIdx = [...peat.keys()].filter((k) => peat[k]);
  const n = l.w * l.h;
  const rs = Array.from({ length: runs }, (_, r) => {
    const ign = new Float32Array(n), out = new Float32Array(n), ext = new Uint8Array(n);
    for (const k of peatIdx.slice(0, burn(r))) ign[k] = 1;
    return { ign, out, ext } as unknown as EnsembleResult['runs'][number];
  });
  return { runs: rs, burnedHa: rs.map(() => 0), zoneStats: [], horizonH: 24, cellHa: 1, seeds: rs.map((_, i) => i + 1) };
}

const base = sketchScenario();
const L = base.landscape;
const withYears = (years: (k: number) => number): Landscape => ({ ...L, fireYears: Uint8Array.from({ length: L.w * L.h }, (_, k) => years(k)) });

describe('burn-depth classes from fire history', () => {
  it('maps earlier fire years to the four classes', () => {
    expect([0, 1, 2, 3, 4, 9, 25].map(burnClassOf)).toEqual([0, 1, 2, 3, 3, 3, 3]);
    expect(BURN_CLASS_LABEL).toHaveLength(4);
  });

  it('uses IPCC 353 with no earlier fire and Konecny 115 / 69 / 23 after', () => {
    expect(classTdmHa(DEFAULT_RATES)).toEqual([353, 115, 69, 23]);
    // Rates from records made before the classes existed fall back to the defaults.
    const old = { ...DEFAULT_RATES } as Partial<Rates>;
    delete old.peatBurnt2ndTdmHa; delete old.peatBurnt3rdTdmHa; delete old.peatBurnt4thTdmHa;
    expect(classTdmHa(old as Rates)).toEqual([353, 115, 69, 23]);
    expect(classTdmHa({ ...DEFAULT_RATES, peatBurntTdmHa: 206, peatBurnt4thTdmHa: 10 })).toEqual([206, 115, 69, 10]);
  });

  it('counts burned peat per class, all in the first class without fire history', () => {
    const e = fakeEnsemble(L, () => 100, 3);
    expect(peatHaByClassPerRun(L, e, 24)[0]).toEqual([100, 0, 0, 0]);
    const l = withYears((k) => k % 4);
    const byClass = peatHaByClassPerRun(l, e, 24)[0];
    expect(byClass.reduce((a, b) => a + b, 0)).toBe(100);
    expect(byClass.every((x) => x > 0)).toBe(true);
  });

  it('repeat-fire ground emits the Konecny share of the IPCC default', () => {
    const e = fakeEnsemble(L, (r) => 50 + r);
    const flat = emissions(L, e, null, DEFAULT_RATES, 24);
    const burnedOften = emissions(withYears(() => 5), e, null, DEFAULT_RATES, 24);
    const noneSeen = emissions(withYears(() => 0), e, null, DEFAULT_RATES, 24);
    expect(burnedOften.base.mean / flat.base.mean).toBeCloseTo(23 / 353, 10);
    expect(noneSeen.base.mean).toBeCloseTo(flat.base.mean, 6);
    expect(burnedOften.range.history).toBe(true);
    expect(flat.range.history).toBe(false);
  });
});

describe('fire history on the scenario grid counts only earlier years', () => {
  // A cell that burned in 2004, 2009, 2011, 2013, 2014, 2015, 2018, 2019, 2023 (fireHistory.test.ts).
  const LAT = -2.31406, LON = 114.10638, d = 0.0025;
  const box = { north: LAT + d, south: LAT - d, west: LON - d, east: LON + d };

  it('a fire year never counts itself', async () => {
    const env = nodeEnv({ offline: true });
    const at = async (year: number) => (await sampleFireHistory(box, 1, 1, year, env))!.years[0];
    expect(await at(2015)).toBe(5);
    expect(await at(2016)).toBe(6);
    expect(await at(2026)).toBe(9);
    expect(await at(2001)).toBe(0);
  });

  it('is null outside every island and without binary access', async () => {
    const sea = { north: -7.4, south: -7.5, west: 100.0, east: 100.1 };
    expect(await sampleFireHistory(sea, 4, 4, 2026, nodeEnv({ offline: true }))).toBeNull();
    const { fetchBuffer: _drop, ...noBin } = nodeEnv({ offline: true });
    expect(await sampleFireHistory(box, 4, 4, 2026, noBin)).toBeNull();
  });
});

describe('records without fire history keep their emission numbers', () => {
  it('flat IPCC arithmetic, bit for bit, on a synthetic ensemble', () => {
    const e = fakeEnsemble(L, (r) => 30 + 7 * r);
    const p = fakeEnsemble(L, (r) => 20 + 3 * r);
    const em = emissions(L, e, p, DEFAULT_RATES, 24);
    const perHa = tco2ePerHa(DEFAULT_RATES);
    const b = peatHaPerRun(L, e, 24).map((ha) => ha * perHa);
    const q = peatHaPerRun(L, p, 24).map((ha) => ha * perHa);
    expect(em.perHa).toBe(perHa);
    expect(em.base.mean).toBe(b.reduce((a, x) => a + x, 0) / b.length);
    expect(em.plan!.mean).toBe(q.reduce((a, x) => a + x, 0) / q.length);
  });

  it('a sealed register forecast re-runs to its sealed t CO2e', async () => {
    const dir = join(process.cwd(), 'data', 'register');
    const file = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()[0];
    const entry = JSON.parse(readFileSync(join(dir, file), 'utf8')) as RegisterEntry;
    expect(entry.kind).toBe(ENTRY_KIND[1]);
    const inputs = decode<RunInputs>(entry.record.inputs);
    expect(inputs.scenario.landscape.fireYears).toBeUndefined();
    const ens = runEnsemble(inputs.scenario, inputs.actions, inputs.params, inputs.seeds);
    const em = emissions(inputs.scenario.landscape, ens, null, inputs.params.rates, inputs.scenario.horizonH);
    const t = entry.record.receipt.results.tco2e;
    expect(Math.round(em.base.mean)).toBe(t.base);
    expect(Math.round(em.perHa * 10) / 10).toBe(t.perHa);
  }, 60_000);
});

describe('Monte Carlo range', () => {
  it('draws standard normals, independent between slots', () => {
    const n = 4000;
    const z = [0, 1, 2].map((s) => Array.from({ length: n }, (_, i) => normalDraw(0x5eedc02e, i, s)));
    const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
    for (const x of z) {
      const m = mean(x), sd = Math.sqrt(mean(x.map((v) => (v - m) ** 2)));
      expect(Math.abs(m)).toBeLessThan(0.06);
      expect(Math.abs(sd - 1)).toBeLessThan(0.05);
      const s = [...x].sort((a, b) => a - b);
      expect(s[Math.round(0.95 * n)]).toBeCloseTo(1.645, 0);
      expect(s[Math.round(0.05 * n)]).toBeCloseTo(-1.645, 0);
    }
    const r01 = mean(z[0].map((v, i) => v * z[1][i])), r12 = mean(z[1].map((v, i) => v * z[2][i]));
    expect(Math.abs(r01)).toBeLessThan(0.05);
    expect(Math.abs(r12)).toBeLessThan(0.05);
  });

  const l = withYears((k) => (k * 7) % 5);
  const e = fakeEnsemble(l, (r) => 40 + ((r * 13) % 29));
  const p = fakeEnsemble(l, (r) => 20 + ((r * 5) % 11));

  it('is deterministic across calls', () => {
    const a = emissions(l, e, p, DEFAULT_RATES, 24).range;
    const b = emissions(l, e, p, DEFAULT_RATES, 24).range;
    expect(b).toEqual(a);
  });

  it('quantiles bracket the median', () => {
    const r = emissions(l, e, p, DEFAULT_RATES, 24).range;
    for (const q of [r.base, r.plan!, r.avoided!]) {
      expect(q.p5).toBeLessThanOrEqual(q.p10);
      expect(q.p10).toBeLessThanOrEqual(q.median);
      expect(q.median).toBeLessThanOrEqual(q.p90);
      expect(q.p90).toBeLessThanOrEqual(q.p95);
      expect(q.p95).toBeGreaterThan(q.p5);
    }
    // The central (spread-only) mean sits inside the 5-95% range.
    const em = emissions(l, e, p, DEFAULT_RATES, 24);
    expect(em.base.mean).toBeGreaterThan(r.base.p5);
    expect(em.base.mean).toBeLessThan(r.base.p95);
  });

  it('avoided is paired: same run and same factor draws on both sides', () => {
    // A plan that burns exactly half of every class in every run: avoided = base / 2 in every draw.
    const baseHa = peatHaByClassPerRun(l, e, 24);
    const half = baseHa.map((h) => h.map((x) => x / 2));
    const r = emissionRange(baseHa, half, DEFAULT_RATES, true);
    for (const k of ['median', 'p5', 'p95', 'p10', 'p90'] as const) expect(r.avoided![k]).toBeCloseTo(r.base[k] / 2, 6);
    // And no plan effect gives exactly zero avoided in every draw.
    const same = emissionRange(baseHa, baseHa, DEFAULT_RATES, true);
    expect(same.avoided).toMatchObject({ median: 0, p5: 0, p95: 0 });
  });

  it('variance shares sum to 1 and follow the inputs', () => {
    const r = emissions(l, e, p, DEFAULT_RATES, 24).range;
    const d = r.drivers.base;
    expect(d.spread + d.depth + d.ef).toBeCloseTo(1, 10);
    // Same burn in every run: no spread variance.
    const fixed = emissions(l, fakeEnsemble(l, () => 50), null, DEFAULT_RATES, 24).range.drivers.base;
    expect(fixed.spread).toBeCloseTo(0, 12);
    // No factor uncertainty except burn depth.
    const onlyDepth = emissions(l, fakeEnsemble(l, () => 50), null, { ...DEFAULT_RATES, peatCo2cRelSd: 0, peatCh4RelSd: 0 }, 24).range.drivers.base;
    expect(onlyDepth.depth).toBeCloseTo(1, 10);
  });

  it('is fast enough for every render (64 × 64, 40 runs, with a plan)', () => {
    const t0 = performance.now();
    emissions(l, e, p, DEFAULT_RATES, 24);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe('Monte Carlo of the satellite number', () => {
  const T0 = Date.parse('2026-10-18T19:06:00Z');
  const peatK = (() => { const m = peatMask(L); for (let k = 0; k < m.length; k++) { const x = k % L.w, y = Math.floor(k / L.w); if (m[k] && x > 2 && y > 2 && x < L.w - 3 && y < L.h - 3) return k; } return -1; })();
  const hs: Hotspot[] = [3, 1].map((h, i) => ({ lat: 0, lon: 0, x: peatK % L.w, y: Math.floor(peatK / L.w), frp: 10 + 10 * i, confidence: 'n', satellite: i ? 'N20' : 'N', acquired: new Date(T0 - h * 3.6e6).toISOString() }));

  it('brackets the point value, deterministically', () => {
    const a = observedEmissions(L, hs, T0, DEFAULT_RATES)!;
    const b = observedEmissions(L, hs, T0, DEFAULT_RATES)!;
    expect(b.range).toEqual(a.range);
    const r = a.range!;
    expect(r.p5).toBeLessThan(a.tco2e);
    expect(r.p95).toBeGreaterThan(a.tco2e);
    // Log-normal β centred on the point: the median stays within a few % of it.
    expect(r.median / a.tco2e).toBeGreaterThan(0.9);
    expect(r.median / a.tco2e).toBeLessThan(1.1);
    // ×/÷ about 2.7 at 90%.
    expect(r.p95 / r.median).toBeGreaterThan(2);
    expect(r.p95 / r.median).toBeLessThan(3.5);
  });
});
