// Issue and score pre-registered forecasts (see src/sim/register.ts).
import { emissions } from '../sim/carbon';
import { observedEmissions, scenarioNow } from '../sim/frp';
import { scoreHindcast } from '../sim/hindcast';
import { DEFAULT_PARAMS } from '../sim/model';
import { buildReceipt, checkRecord, decode, encode, engineLabel, outputsDigest, type RunInputs, type RunRecord } from '../sim/receipt';
import { ENTRY_KIND, REGISTER_WINDOW_H, observedInWindow, type RegisterEntry, type RegisterScore } from '../sim/register';
import type { EnsembleResult, Scenario, SimParams } from '../sim/types';
import { bboxAround, buildLiveScenario } from './live';
import { fetchHotspots } from './firms';

/** Runs the no-action ensemble (the Web Worker in the app, the main thread in tests). */
export type Runner = (scn: Scenario, params: SimParams) => Promise<EnsembleResult>;

async function post<T>(path: string, body: object): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

// The register as stored with the code, for static hosting where /api/register does not exist.
const bundled = import.meta.glob<RegisterEntry>('../../data/register/*.json', { import: 'default' });

export async function listRegister(): Promise<RegisterEntry[]> {
  try {
    const r = await fetch('/api/register');
    if (r.ok && r.headers.get('content-type')?.includes('json')) return (await r.json()).entries as RegisterEntry[];
  } catch { /* static deploy: fall through */ }
  return Promise.all(Object.values(bundled).map((load) => load()));
}

/**
 * Forecast the next 24 h at (lat, lon) from live data, seal it, sign it, timestamp it on
 * Bitcoin and store it. Nothing about the outcome exists yet when this runs.
 */
export async function issueForecast(lat: number, lon: number, rule: string, run: Runner): Promise<RegisterEntry> {
  const { scenario } = await buildLiveScenario({ lat, lon, horizonH: REGISTER_WINDOW_H });
  if (!scenario.hotspots?.length) throw new Error(`No FIRMS detections around ${lat.toFixed(3)}, ${lon.toFixed(3)}.`);
  const params: SimParams = DEFAULT_PARAMS;
  const base = await run(scenario, params);
  const inputs: RunInputs = { scenario, actions: [], params, seeds: base.seeds };
  const em = emissions(scenario.landscape, base, null, params.rates, scenario.horizonH);
  const obs = observedEmissions(scenario.landscape, scenario.hotspots, scenarioNow(scenario), params.rates);
  const { receipt, receiptSha256 } = await buildReceipt(inputs, base, base, em, engineLabel(), obs);
  const record: RunRecord = { receipt, receiptSha256, inputs: encode(inputs) };
  record.signature = await post('/api/receipt/sign', { receiptSha256 });
  // A forecast without a timestamp proves nothing about when it was made, so this must succeed.
  record.anchor = await post('/api/receipt/anchor', { receiptSha256 });
  const entry: RegisterEntry = {
    v: 2, kind: ENTRY_KIND[2],
    issuedAt: receipt.createdAt, lat, lon, windowH: REGISTER_WINDOW_H, rule, record,
  };
  await post('/api/register', { entry });
  return entry;
}

/**
 * Score a forecast once its window is in FIRMS: re-run the sealed inputs (they must give
 * the sealed output hash), fetch the detections of the window and score new fire only.
 */
export async function scoreEntry(e: RegisterEntry, run: Runner): Promise<RegisterScore> {
  const checks = await checkRecord(e.record);
  if (!checks.receiptHash || !checks.inputsHash) throw new Error('The stored record does not match its hashes.');
  const inputs = decode<RunInputs>(e.record.inputs);
  const base = await run(inputs.scenario, inputs.params);
  const reproduced = (await outputsDigest(base, base)) === e.record.receipt.outputsSha256;
  const g = bboxAround(e.lat, e.lon);
  const from = e.issuedAt.slice(0, 10);
  const days = Math.min(5, Math.ceil((Date.parse(e.issuedAt) + e.windowH * 3.6e6 - Date.parse(from)) / 864e5) + 1);
  const { hotspots } = await fetchHotspots([g.west, g.south, g.east, g.north], days, from);
  const observed = observedInWindow(inputs.scenario.landscape, e, hotspots);
  const result = scoreHindcast(inputs.scenario.landscape, inputs.scenario.init, base, observed, e.windowH);
  const score: RegisterScore = { scoredAt: new Date().toISOString(), reproduced, detections: observed.length, result };
  await post('/api/register/score', { receiptSha256: e.record.receiptSha256, score });
  return score;
}
