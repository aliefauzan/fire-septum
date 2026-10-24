// Greenhouse-gas emissions from the simulated burn, IPCC Tier 1 for fires on peat.
//
// 2013 IPCC Wetlands Supplement, Eq. 2.8:  L = A · (M_B · C_f) · G_ef · 10⁻³
// with A = newly burned peat area (ha), M_B·C_f = peat burnt per ha and G_ef per gas
// (see RATE_INFO in doctrine.ts). M_B·C_f is set per cell by its fire history when the landscape
// carries one (see "Burn depth by fire history" below). Only peat-soil cells count. Burning vegetation above
// mineral soil is left out, as are CO, N2O and particulates, so the totals are a
// floor rather than a full inventory.
import { DET1 } from './detmath';
import { DEFAULT_RATES, type Rates } from './doctrine';
import { quantile } from './ensemble';
import { ON_PEAT, fuelOf } from './fuels';
import { hash4, mulberry32 } from './rng';
import type { EnsembleResult, Landscape } from './types';

/** Mass ratio of CO2 to carbon. */
export const CO2_PER_C = 44 / 12;

/** IPCC 95% confidence interval of peat burnt per ha (Table 2.6), as multipliers on the 353 t mean. */
export const PEAT_BURNT_CI: [number, number] = [170 / 353, 536 / 353];

/** Tonnes CO2-equivalent per hectare of burned peat: CO2 plus CH4 × GWP-100. */
export function tco2ePerHa(r: Pick<Rates, 'peatBurntTdmHa' | 'peatCo2cGkg' | 'peatCh4Gkg' | 'ch4Gwp100'>): number {
  const gPerKg = r.peatCo2cGkg * CO2_PER_C + r.peatCh4Gkg * r.ch4Gwp100;
  return (r.peatBurntTdmHa * gPerKg) / 1000;
}

/** 1 where the cell is on peat soil. */
export function peatMask(l: Landscape): Uint8Array {
  const m = new Uint8Array(l.w * l.h);
  for (let k = 0; k < m.length; k++) m[k] = ON_PEAT.has(fuelOf(l.fuel[k]).id) ? 1 : 0;
  return m;
}

/** Newly burned peat hectares by hour `at`, one value per run (same order as e.runs). */
export function peatHaPerRun(l: Landscape, e: EnsembleResult, at: number): number[] {
  const peat = peatMask(l);
  return e.runs.map((r) => {
    let c = 0;
    for (let k = 0; k < peat.length; k++) if (peat[k] && r.ign[k] > 0 && r.ign[k] <= at) c++;
    return c * e.cellHa;
  });
}

export interface Spread { mean: number; p10: number; p90: number }

const spread = (xs: number[]): Spread => {
  const s = [...xs].sort((a, b) => a - b);
  return { mean: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length), p10: quantile(s, 0.1) || 0, p90: quantile(s, 0.9) || 0 };
};

// ---------------------------------------------------------------------------------------------
// Burn depth by fire history.
//
// Each burned peat cell takes the peat consumed per hectare of its fire-history class, from the
// number of earlier calendar years NASA FIRMS saw fire on it (Landscape.fireYears):
//   0 earlier years  -> IPCC Tier 1, 353 t/ha (95% CI 170-536): first-time drought fires, 0.3-0.5 m.
//                       MODIS-era history starts in 2001, so "no record" may hide an older fire;
//                       the IPCC interval also covers Konecny's first-fire 206 t/ha.
//   1, 2, 3+ years   -> Konecny et al. 2016, Table 3: second, third, fourth-or-later fire,
//                       115, 69 and 23 t/ha.
// Landscapes without fireYears (every record made before 24 Oct 2026) put all burned peat in the
// first class, which is the flat IPCC default they were made with.

/** Fire-history classes: no earlier fire year, one, two, three or more. */
export const BURN_CLASSES = ['none', 'one', 'two', 'threePlus'] as const;
export type BurnClass = 0 | 1 | 2 | 3;
export const BURN_CLASS_LABEL = ['no fire seen since 2001', '1 earlier fire year', '2 earlier fire years', '3+ earlier fire years'] as const;

/** Class of a cell with `priorYears` earlier fire years. */
export const burnClassOf = (priorYears: number): BurnClass => (priorYears >= 3 ? 3 : priorYears <= 0 ? 0 : (priorYears as BurnClass));

/** Peat burnt per ha for each class, t dry matter/ha. Rates from older records lack the Konecny keys: defaults fill in. */
export function classTdmHa(r: Rates): [number, number, number, number] {
  return [
    r.peatBurntTdmHa,
    r.peatBurnt2ndTdmHa ?? DEFAULT_RATES.peatBurnt2ndTdmHa!,
    r.peatBurnt3rdTdmHa ?? DEFAULT_RATES.peatBurnt3rdTdmHa!,
    r.peatBurnt4thTdmHa ?? DEFAULT_RATES.peatBurnt4thTdmHa!,
  ];
}

/** Class of every cell (0 everywhere without fire history). */
export function burnClassMap(l: Landscape): Uint8Array {
  const m = new Uint8Array(l.w * l.h);
  if (l.fireYears) for (let k = 0; k < m.length; k++) m[k] = burnClassOf(l.fireYears[k]);
  return m;
}

/** Newly burned peat hectares by hour `at` in each class, one [4] per run (same order as e.runs). */
export function peatHaByClassPerRun(l: Landscape, e: EnsembleResult, at: number): number[][] {
  const peat = peatMask(l), cls = burnClassMap(l);
  return e.runs.map((r) => {
    const c = [0, 0, 0, 0];
    for (let k = 0; k < peat.length; k++) if (peat[k] && r.ign[k] > 0 && r.ign[k] <= at) c[cls[k]]++;
    return c.map((n) => n * e.cellHa);
  });
}

/** t CO2e per t dry matter with the current emission factors. */
const tco2ePerTdm = (r: Pick<Rates, 'peatCo2cGkg' | 'peatCh4Gkg' | 'ch4Gwp100'>) => (r.peatCo2cGkg * CO2_PER_C + r.peatCh4Gkg * r.ch4Gwp100) / 1000;

// ---------------------------------------------------------------------------------------------
// Monte Carlo range.
//
// Three sources, drawn together N times with counter-based randomness (rng.ts hash4 + mulberry32, fixed seed,
// fdlibm maths from detmath.ts), so the same inputs give the same quantiles on every call and in
// every engine:
//   spread         - draw i uses fire-spread run i mod R (each of the R runs equally often);
//   burn depth     - the no-history class ~ Normal(T0, T0 x 0.264) from the IPCC 95% CI; the
//                    Konecny classes x one shared log-normal depth factor (mean 1, rel. SD
//                    peatDepthRelSd) x one shared bulk-density factor ~ Normal(1, peatBdRelSd);
//   emission factor- CO2-C ~ Normal(464, x peatCo2cRelSd), CH4 ~ Normal(21, x peatCh4RelSd).
// Factors are systematic: one draw applies to every cell of its class, because a class value that
// is wrong is wrong everywhere (independent per-cell noise would average away). Normals are
// clamped at 0. Base and plan use the same run and the same factor draws, so avoided = base - plan
// is paired. GWP-100 is not varied.

export const MC_SAMPLES = 2000;
const MC_SEED = 0x5eedc02e;
/** Relative SD of the IPCC peat burnt per ha, from its 95% CI 170-536 around 353. */
export const IPCC_BURNT_REL_SD = (PEAT_BURNT_CI[1] - PEAT_BURNT_CI[0]) / (2 * 1.959964);

/**
 * Standard normal from draw i, slot s: Box-Muller on the (2s+1)-th and (2s+2)-th outputs of a
 * mulberry32 stream seeded by hash4(seed, i). A pure function of (seed, i, s), so the order of the
 * calls does not matter. (Two hash4 values that differ only in one argument are not independent
 * enough for this: the slots came out correlated.)
 */
export function normalDraw(seed: number, i: number, s: number): number {
  const rand = mulberry32(Math.floor(hash4(seed, i, 0x51ed, 0) * 4294967296));
  for (let k = 0; k < 2 * s; k++) rand();
  const u = Math.max(1e-12, rand()), v = rand();
  return DET1.sqrt(-2 * DET1.log(u)) * DET1.cos(2 * Math.PI * v);
}

export interface Quantiles { mean: number; median: number; p5: number; p95: number; p10: number; p90: number }

export function quantilesOf(xs: ArrayLike<number>): Quantiles {
  const s = Float64Array.from(xs).sort();
  const q = (p: number) => (s.length ? quantile(s as unknown as number[], p) : 0);
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s[i];
  return { mean: s.length ? sum / s.length : 0, median: q(0.5), p5: q(0.05), p95: q(0.95), p10: q(0.1), p90: q(0.9) };
}

/** Shares of the variance from each source alone (one-at-a-time, the others at their central value). They sum to 1. */
export interface Drivers { spread: number; depth: number; ef: number }

export interface EmissionRange {
  samples: number;
  base: Quantiles;
  plan: Quantiles | null;
  avoided: Quantiles | null;
  drivers: { base: Drivers; avoided: Drivers | null };
  /** True when burn depth came from the fire-history classes; false = flat IPCC default for every cell. */
  history: boolean;
  /** Mean newly burned peat ha per class across runs: [none, 1, 2, 3+]. */
  classHa: { base: number[]; plan: number[] | null };
}

interface Draws { m: Float64Array; g: Float64Array }

/** Factor draws: m[i*4+c] t dry matter/ha for class c, g[i] t CO2e per t dry matter. */
function factorDraws(r: Rates, n: number): Draws {
  const T = classTdmHa(r);
  const cv = r.peatDepthRelSd ?? DEFAULT_RATES.peatDepthRelSd!;
  const sigma = DET1.sqrt(DET1.log(1 + cv * cv));
  const bdSd = r.peatBdRelSd ?? DEFAULT_RATES.peatBdRelSd!;
  const co2Sd = r.peatCo2cRelSd ?? DEFAULT_RATES.peatCo2cRelSd!;
  const ch4Sd = r.peatCh4RelSd ?? DEFAULT_RATES.peatCh4RelSd!;
  const m = new Float64Array(n * 4), g = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    m[i * 4] = Math.max(0, T[0] * (1 + IPCC_BURNT_REL_SD * normalDraw(MC_SEED, i, 0)));
    const depth = DET1.exp(sigma * normalDraw(MC_SEED, i, 1) - (sigma * sigma) / 2);
    const bd = Math.max(0, 1 + bdSd * normalDraw(MC_SEED, i, 2));
    for (let c = 1; c < 4; c++) m[i * 4 + c] = T[c] * depth * bd;
    const co2c = Math.max(0, r.peatCo2cGkg * (1 + co2Sd * normalDraw(MC_SEED, i, 3)));
    const ch4 = Math.max(0, r.peatCh4Gkg * (1 + ch4Sd * normalDraw(MC_SEED, i, 4)));
    g[i] = (co2c * CO2_PER_C + ch4 * r.ch4Gwp100) / 1000;
  }
  return { m, g };
}

const variance = (xs: ArrayLike<number>) => {
  const n = Math.max(1, xs.length);
  let mu = 0;
  for (let i = 0; i < xs.length; i++) mu += xs[i];
  mu /= n;
  let v = 0;
  for (let i = 0; i < xs.length; i++) v += (xs[i] - mu) * (xs[i] - mu);
  return v / n;
};

/** Variance shares of spread, depth and emission factors for per-run class hectares `ha`. */
function drivers(ha: number[][], d: Draws, T: number[], g0: number, n: number): Drivers {
  const R = ha.length;
  const mean = [0, 1, 2, 3].map((c) => ha.reduce((a, h) => a + h[c], 0) / Math.max(1, R));
  const vSpread = variance(ha.map((h) => (h[0] * T[0] + h[1] * T[1] + h[2] * T[2] + h[3] * T[3]) * g0));
  const dm = new Float64Array(n), ef = new Float64Array(n);
  const tdm0 = mean[0] * T[0] + mean[1] * T[1] + mean[2] * T[2] + mean[3] * T[3];
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    dm[i] = (mean[0] * d.m[o] + mean[1] * d.m[o + 1] + mean[2] * d.m[o + 2] + mean[3] * d.m[o + 3]) * g0;
    ef[i] = tdm0 * d.g[i];
  }
  const vDepth = variance(dm), vEf = variance(ef);
  const total = vSpread + vDepth + vEf;
  return total > 0 ? { spread: vSpread / total, depth: vDepth / total, ef: vEf / total } : { spread: 0, depth: 0, ef: 0 };
}

/**
 * Monte Carlo of the emissions: median and 5-95% / 10-90% for doing nothing, with the plan, and
 * the paired difference. `baseHa` and `planHa` are per-run class hectares (peatHaByClassPerRun).
 */
export function emissionRange(baseHa: number[][], planHa: number[][] | null, rates: Rates, history: boolean, n = MC_SAMPLES): EmissionRange {
  const R = baseHa.length;
  const d = factorDraws(rates, n);
  const b = new Float64Array(n), p = planHa ? new Float64Array(n) : null, a = planHa ? new Float64Array(n) : null;
  for (let i = 0; i < n && R > 0; i++) {
    const r = i % R, o = i * 4;
    const hb = baseHa[r];
    b[i] = (hb[0] * d.m[o] + hb[1] * d.m[o + 1] + hb[2] * d.m[o + 2] + hb[3] * d.m[o + 3]) * d.g[i];
    if (planHa && p && a) {
      const hp = planHa[r] ?? hb;
      p[i] = (hp[0] * d.m[o] + hp[1] * d.m[o + 1] + hp[2] * d.m[o + 2] + hp[3] * d.m[o + 3]) * d.g[i];
      a[i] = b[i] - p[i];
    }
  }
  const T = classTdmHa(rates), g0 = tco2ePerTdm(rates);
  const meanHa = (ha: number[][]) => [0, 1, 2, 3].map((c) => ha.reduce((s, h) => s + h[c], 0) / Math.max(1, ha.length));
  const diffHa = planHa ? baseHa.map((h, r) => h.map((x, c) => x - (planHa[r]?.[c] ?? x))) : null;
  return {
    samples: n,
    base: quantilesOf(b),
    plan: p ? quantilesOf(p) : null,
    avoided: a ? quantilesOf(a) : null,
    drivers: { base: drivers(baseHa, d, T, g0, n), avoided: diffHa ? drivers(diffHa, d, T, g0, n) : null },
    history,
    classHa: { base: meanHa(baseHa), plan: planHa ? meanHa(planHa) : null },
  };
}

export interface Emissions {
  /** t CO2e per hectare of burned peat with the no-history (IPCC) class and the current factors. */
  perHa: number;
  /** t CO2e if nothing is done (fire-spread mean and 10–90%, central factors). */
  base: Spread;
  /** t CO2e with the plan, and the paired (same-seed) reduction. Null without a plan. */
  plan: Spread | null;
  avoided: Spread | null;
  /** Multipliers for the IPCC 95% range of peat burnt per ha (burn depth). */
  factorRange: [number, number];
  /** Monte Carlo over spread, burn depth and emission factors. */
  range: EmissionRange;
}

/**
 * Emissions by hour `at`. `base`, `plan` and `avoided` use the central factors and vary only with
 * the fire spread (10–90% of runs); `range` adds burn-depth and emission-factor uncertainty.
 * Landscapes without fireYears give exactly the numbers they gave before fire history existed.
 */
export function emissions(l: Landscape, base: EnsembleResult, plan: EnsembleResult | null, rates: Rates, at: number): Emissions {
  const perHa = tco2ePerHa(rates);
  const bHa = peatHaByClassPerRun(l, base, at);
  const pHa = plan ? peatHaByClassPerRun(l, plan, at) : null;
  let b: number[], p: number[] | null;
  if (!l.fireYears) {
    // Unchanged arithmetic for records without fire history: hectares × one rate.
    b = peatHaPerRun(l, base, at).map((ha) => ha * perHa);
    p = plan ? peatHaPerRun(l, plan, at).map((ha) => ha * perHa) : null;
  } else {
    const T = classTdmHa(rates), g = tco2ePerTdm(rates);
    const t = (h: number[]) => (h[0] * T[0] + h[1] * T[1] + h[2] * T[2] + h[3] * T[3]) * g;
    b = bHa.map(t);
    p = pHa ? pHa.map(t) : null;
  }
  return {
    perHa,
    base: spread(b),
    plan: p ? spread(p) : null,
    avoided: p ? spread(b.map((x, i) => x - (p[i] ?? x))) : null,
    factorRange: PEAT_BURNT_CI,
    range: emissionRange(bHa, pHa, rates, !!l.fireYears),
  };
}

/** The source with the largest variance share, for "most of the range comes from …". */
export function mainDriver(d: Drivers): { key: keyof Drivers; share: number } {
  const keys: (keyof Drivers)[] = ['spread', 'depth', 'ef'];
  const key = keys.reduce((a, k) => (d[k] > d[a] ? k : a), keys[0]);
  return { key, share: d[key] };
}

export const DRIVER_LABEL: Record<keyof Drivers, string> = { spread: 'where the fire spreads', depth: 'how deep the peat burns', ef: 'the emission factors' };

/** Round to 2 significant figures for display: the factors do not support more. */
export function fmtTonnes(t: number): string {
  if (Math.abs(t) < 1) return '0';
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(t))) - 1));
  return (Math.round(t / mag) * mag).toLocaleString('en-US');
}
