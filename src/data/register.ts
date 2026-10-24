// Issue and score pre-registered forecasts (see src/sim/register.ts).
import { emissions } from '../sim/carbon';
import { observedEmissions, scenarioNow } from '../sim/frp';
import {
  FORECAST_GRID, FORECAST_SCHEMA, REFERENCE_MODEL_INFO, REGISTER_MODEL, detectionsInWindow, maskToString, scoreForecast, scoreReferences,
  type BoxForecast,
} from '../sim/forecast';
import { blockFireMask, ensembleBlockProbabilities, scoreHindcast } from '../sim/hindcast';
import { DEFAULT_PARAMS } from '../sim/model';
import { buildReceipt, checkRecord, decode, encode, engineLabel, outputsDigest, type Anchor, type RunInputs, type RunRecord, type Signature } from '../sim/receipt';
import { ENTRY_KIND, REGISTER_WINDOW_H, observedInWindow, type RegisterEntry, type RegisterScore } from '../sim/register';
import type { EnsembleResult, Scenario, SimParams } from '../sim/types';
import { browserEnv, type DataEnv } from './env';
import { bboxAround, buildLiveScenario } from './live';
import { fetchHotspots, type FirmsResult } from './firms';

/** Runs the no-action ensemble (the Web Worker in the app, the main thread in tests). */
export type Runner = (scn: Scenario, params: SimParams) => Promise<EnsembleResult>;

async function post<T>(path: string, body: object): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

/** Signs a receipt hash and anchors it on Bitcoin: the dev server's /api/receipt in the app, in-process in scripts/register-daily.ts. */
export interface Sealer {
  sign(receiptSha256: string): Promise<Signature>;
  /** Must throw when no OpenTimestamps calendar answers: a forecast without a timestamp is never stored. */
  anchor(receiptSha256: string): Promise<Anchor>;
}

const browserSealer: Sealer = {
  sign: (receiptSha256) => post('/api/receipt/sign', { receiptSha256 }),
  anchor: (receiptSha256) => post('/api/receipt/anchor', { receiptSha256 }),
};

/**
 * Forecast the next 24 h at (lat, lon) from live data and seal it: receipt, signature and
 * OpenTimestamps proof. Nothing about the outcome exists yet when this runs. Does not store it.
 */
export async function sealForecast(
  lat: number, lon: number, rule: string, run: Runner,
  o: { env?: DataEnv; sealer?: Sealer; region?: string } = {},
): Promise<RegisterEntry> {
  const { scenario } = await buildLiveScenario({ lat, lon, horizonH: REGISTER_WINDOW_H }, o.env ?? browserEnv);
  if (!scenario.hotspots?.length) throw new Error(`No FIRMS detections around ${lat.toFixed(3)}, ${lon.toFixed(3)}.`);
  const params: SimParams = DEFAULT_PARAMS;
  const base = await run(scenario, params);
  const inputs: RunInputs = { scenario, actions: [], params, seeds: base.seeds };
  const em = emissions(scenario.landscape, base, null, params.rates, scenario.horizonH);
  const obs = observedEmissions(scenario.landscape, scenario.hotspots, scenarioNow(scenario), params.rates);
  const { receipt, receiptSha256 } = await buildReceipt(inputs, base, base, em, engineLabel(), obs);
  const record: RunRecord = { receipt, receiptSha256, inputs: encode(inputs) };
  const sealer = o.sealer ?? browserSealer;
  record.signature = await sealer.sign(receiptSha256);
  // A forecast without a timestamp proves nothing about when it was made, so this must succeed.
  record.anchor = await sealer.anchor(receiptSha256);
  return {
    v: 2, kind: ENTRY_KIND[2],
    issuedAt: receipt.createdAt, lat, lon, windowH: REGISTER_WINDOW_H, rule, ...(o.region ? { region: o.region } : {}), record,
  };
}

/**
 * Forecast the next 24 h at (lat, lon) from live data, seal it, sign it, timestamp it on
 * Bitcoin and store it. Nothing about the outcome exists yet when this runs.
 */
export async function issueForecast(lat: number, lon: number, rule: string, run: Runner): Promise<RegisterEntry> {
  const entry = await sealForecast(lat, lon, rule, run);
  await post('/api/register', { entry });
  return entry;
}

/** FIRMS detections for bbox [w, s, e, n], `days` days from `date` (DataEnv.firms or the browser proxy). */
export type FirmsFetch = (bbox: [number, number, number, number], days: number, date?: string) => Promise<FirmsResult>;

/** The register's sealed forecast for its box in the open format (model 'fire-septum-ca'): block probabilities from the sealed ensemble. */
export function registerAsForecast(e: Pick<RegisterEntry, 'issuedAt' | 'lat' | 'lon' | 'windowH'>, inputs: RunInputs, base: EnsembleResult): BoxForecast {
  const { note: _note, ...model } = REFERENCE_MODEL_INFO[REGISTER_MODEL];
  void _note;
  return {
    schema: FORECAST_SCHEMA, model, issuedAt: e.issuedAt, windowH: e.windowH as 24, grid: FORECAST_GRID,
    box: { lat: e.lat, lon: e.lon },
    probabilities: Array.from(ensembleBlockProbabilities(inputs.scenario.landscape, base, e.windowH)),
  };
}

/**
 * Compute a forecast's score once its window is in FIRMS: re-run the sealed inputs (they must
 * give the sealed output hash), fetch the detections of the window and score new fire only, as a
 * hindcast and, with the same mask and detections, on the open benchmark's terms next to the two
 * reference models. Writes nothing.
 */
export async function computeScore(e: RegisterEntry, run: Runner, firms: FirmsFetch = fetchHotspots): Promise<RegisterScore> {
  const checks = await checkRecord(e.record);
  if (!checks.receiptHash || !checks.inputsHash) throw new Error('The stored record does not match its hashes.');
  const inputs = decode<RunInputs>(e.record.inputs);
  const base = await run(inputs.scenario, inputs.params);
  const reproduced = (await outputsDigest(base, base)) === e.record.receipt.outputsSha256;
  const g = bboxAround(e.lat, e.lon);
  const from = e.issuedAt.slice(0, 10);
  const days = Math.min(5, Math.ceil((Date.parse(e.issuedAt) + e.windowH * 3.6e6 - Date.parse(from)) / 864e5) + 1);
  const { hotspots, sources } = await firms([g.west, g.south, g.east, g.north], days, from);
  const l = inputs.scenario.landscape;
  const observed = observedInWindow(l, e, hotspots);
  const result = scoreHindcast(l, inputs.scenario.init, base, observed, e.windowH);
  const mask = blockFireMask(l, inputs.scenario.init);
  const ca = registerAsForecast(e, inputs, base);
  const benchmark = {
    fireAtT0: maskToString(mask),
    observed: detectionsInWindow(ca, hotspots).map(({ lat, lon, acquired, frp, satellite, confidence }) => ({ lat, lon, acquired, frp, satellite, confidence })),
    sources,
    models: { [REGISTER_MODEL]: scoreForecast(ca, hotspots, mask), ...scoreReferences(ca.box, e.issuedAt, e.windowH, hotspots, mask) },
  };
  return { scoredAt: new Date().toISOString(), reproduced, detections: observed.length, result, benchmark };
}

/**
 * Score a forecast once its window is in FIRMS and store the score (once) through the dev server.
 */
export async function scoreEntry(e: RegisterEntry, run: Runner): Promise<RegisterScore> {
  const score = await computeScore(e, run);
  await post('/api/register/score', { receiptSha256: e.record.receiptSha256, score });
  return score;
}
