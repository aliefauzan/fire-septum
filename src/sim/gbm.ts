// The statistical forecaster: gradient-boosted trees over the per-block features of
// src/sim/features.ts, one model per lead (1 = the 24 h after t0, 2 = 24–48 h, 3 = 48–72 h),
// trained and calibrated in ml/gbm/ (docs/forecaster.md) and shipped as
// public/data/forecaster/gbm-v1.json.
//
// Where the cellular automaton (model.ts) answers "what if we act", this answers "where will new
// fire be seen": P(new VIIRS fire in each 400 m block of the 6.4 km box) per lead, the target the
// register and the open benchmark score (src/sim/forecast.ts).
//
// Inference is pure: comparisons, + and ÷, and DET1.exp for the logistic, so every engine gives
// the same bits (src/sim/gbm.test.ts checks it against scikit-learn to 1e-12). Tree walking follows
// scikit-learn's HistGradientBoosting predictor exactly: NaN goes where the node's missing flag
// says, else x <= threshold goes left; raw = baseline + Σ leaf values in tree order; p = 1 / (1 +
// exp(−raw)); the isotonic map is scipy's interp1d (linear, searchsorted left) after clipping to
// the end knots.
import { DET1 } from './detmath';
import { computeBoxFeatures, FEATURE_NAMES, NF, type FeatureName, type FwiFeatureValues } from './features';
import { FORECAST_GRID, FORECAST_SCHEMA, FORECAST_WINDOW_H, type BoxForecast, type ForecastBox } from './forecast';
import type { Scenario } from './types';

export const GBM_MODEL_ID = 'fire-septum-gbm';
export const GBM_MODEL_PATH = 'data/forecaster/gbm-v1.json';
export type Lead = 1 | 2 | 3;
export const GBM_LEADS: readonly Lead[] = [1, 2, 3];

/** One tree, columnar: node i has feature f[i] (−1 = leaf), threshold t[i] (null = +∞), missing-goes-left m[i], children l[i] r[i], leaf value v[i]. */
export interface GbmTree { f: number[]; t: (number | null)[]; m: number[]; l: number[]; r: number[]; v: number[] }
export interface GbmLeadModel {
  baseline: number;
  nTrees: number;
  trees: GbmTree[];
  /** Isotonic calibration knots (increasing x). */
  isotonic: { x: number[]; y: number[] };
  trainBaseRate?: number;
  hyperparameters?: Record<string, number>;
}
export interface GbmModel {
  kind: 'fireseptum.gbm-forecaster';
  v: number;
  model: { id: string; name: string; version: string };
  createdAt: string;
  /** Feature names in the column order the trees index (a subset of FEATURE_NAMES). */
  features: FeatureName[];
  leads: Record<'1' | '2' | '3', GbmLeadModel>;
  training?: Record<string, unknown>;
}

/** Check the shape of a parsed model file (throws with the reason). */
export function parseGbmModel(j: unknown): GbmModel {
  const m = j as GbmModel;
  if (!m || m.kind !== 'fireseptum.gbm-forecaster') throw new Error('not a fireseptum.gbm-forecaster model');
  for (const f of m.features) if (!FEATURE_NAMES.includes(f)) throw new Error(`model feature ${f} is not computed by features.ts`);
  for (const k of ['1', '2', '3'] as const) {
    const lm = m.leads[k];
    if (!lm || !Array.isArray(lm.trees) || lm.isotonic.x.length !== lm.isotonic.y.length) throw new Error(`lead ${k} is malformed`);
  }
  return m;
}

/** Raw score (log-odds) of one row, features in model.features order. */
export function gbmRaw(lm: GbmLeadModel, row: ArrayLike<number>): number {
  let raw = lm.baseline;
  for (const t of lm.trees) {
    let i = 0;
    while (t.f[i] !== -1) {
      const x = row[t.f[i]];
      const th = t.t[i];
      if (x !== x) i = t.m[i] ? t.l[i] : t.r[i];
      else i = th === null || x <= th ? t.l[i] : t.r[i];
    }
    raw += t.v[i];
  }
  return raw;
}

export const logistic = (raw: number) => 1 / (1 + DET1.exp(-raw));

/** Isotonic map as scikit-learn applies it: clip to the end knots, then scipy interp1d (linear). */
export function isotonic(iso: { x: number[]; y: number[] }, p: number): number {
  const { x, y } = iso, n = x.length;
  if (n === 1) return y[0];
  const v = p < x[0] ? x[0] : p > x[n - 1] ? x[n - 1] : p;
  // searchsorted(x, v, side='left'), clipped to [1, n − 1].
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (x[mid] < v) lo = mid + 1; else hi = mid; }
  const j = Math.min(n - 1, Math.max(1, lo));
  const slope = (y[j] - y[j - 1]) / (x[j] - x[j - 1]);
  return slope * (v - x[j - 1]) + y[j - 1];
}

export interface GbmPrediction { raw: number; p: number; calibrated: number }

export function gbmPredictRow(model: GbmModel, lead: Lead, row: ArrayLike<number>): GbmPrediction {
  const lm = model.leads[String(lead) as '1'];
  const raw = gbmRaw(lm, row);
  const p = logistic(raw);
  return { raw, p, calibrated: isotonic(lm.isotonic, p) };
}

/** Column indices of the model's features in a FEATURE_NAMES row. */
const columnsOf = (model: GbmModel) => model.features.map((f) => FEATURE_NAMES.indexOf(f));

export interface GbmForecastOptions {
  model: GbmModel;
  lead?: Lead;
  /** Forecast time; default the scenario's hindcast t0. */
  t0?: string;
  /** Raw (uncalibrated) probabilities instead of the isotonic ones. */
  raw?: boolean;
  /** Wind direction at t0 (degrees from), when known; the v1 model does not use it. */
  windFromDeg?: number | null;
}

export interface GbmForecast {
  lead: Lead;
  /** P(new fire) per 400 m block, row-major from the NW block (256 for the 6.4 km box). Blocks on fire at t0 are 0. */
  probabilities: Float32Array;
  /** Blocks on fire at t0 and the scorer's candidate blocks (within 3 km of them). */
  fireAtT0: Uint8Array;
  candidate: Uint8Array;
}

/**
 * Forecast new fire for one lead from a scenario (live, hindcast or a sealed register record) and
 * the FWI System values at t0 (src/data/fwiArchive.ts; null when unknown, the trees then follow
 * their missing-value branches).
 */
export function gbmForecast(scenario: Pick<Scenario, 'landscape' | 'init' | 'hotspots' | 'hindcast'>, fwi: Partial<FwiFeatureValues> | null, opts: GbmForecastOptions): GbmForecast {
  return gbmForecastAll(scenario, fwi, { ...opts, leads: [opts.lead ?? 1] })[0];
}

/** All requested leads from one feature computation. */
export function gbmForecastAll(scenario: Pick<Scenario, 'landscape' | 'init' | 'hotspots' | 'hindcast'>, fwi: Partial<FwiFeatureValues> | null, opts: GbmForecastOptions & { leads?: readonly Lead[] }): GbmForecast[] {
  const t0 = opts.t0 ?? scenario.hindcast?.t0;
  if (!t0) throw new Error('gbmForecast needs t0 (opts.t0 or scenario.hindcast.t0)');
  const f = computeBoxFeatures({ landscape: scenario.landscape, init: scenario.init, hotspots: scenario.hotspots ?? [], t0, fwi, windFromDeg: opts.windFromDeg });
  const cols = columnsOf(opts.model);
  const nb = f.fireAtT0.length;
  const row = new Float64Array(cols.length);
  const leads = opts.leads ?? GBM_LEADS;
  const out = leads.map((lead) => ({ lead, probabilities: new Float32Array(nb), fireAtT0: f.fireAtT0, candidate: f.candidate }));
  for (let b = 0; b < nb; b++) {
    if (f.fireAtT0[b]) continue;
    for (let j = 0; j < cols.length; j++) row[j] = f.x[b * NF + cols[j]];
    leads.forEach((lead, i) => {
      const r = gbmPredictRow(opts.model, lead, row);
      out[i].probabilities[b] = opts.raw ? r.p : r.calibrated;
    });
  }
  return out;
}

/** A forecast-v1 document for the box (lead 1 only: the open format's window is the 24 h after issuedAt). */
export function gbmBoxForecast(model: GbmModel, box: ForecastBox, issuedAt: string, probabilities: ArrayLike<number>): BoxForecast {
  return {
    schema: FORECAST_SCHEMA,
    model: { id: GBM_MODEL_ID, name: model.model.name, version: model.model.version },
    issuedAt, windowH: FORECAST_WINDOW_H, grid: FORECAST_GRID, box,
    probabilities: Array.from(probabilities, (p) => Math.min(1, Math.max(0, p))),
    metadata: { lead: 1, calibrated: 'isotonic (validation 2023 Kalimantan)', modelCreatedAt: model.createdAt },
  };
}
