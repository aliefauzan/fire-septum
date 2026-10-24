// The cellular automaton as a baseline at scale: leads 1 and 2 (48 h) on the validation, test and
// out-of-time boxes, scored on the same candidate blocks as the forecaster.
//
//   npx tsx scripts/ml/ca.ts                  # after extract.ts; resumable; offline (cached tiles)
//
// Settings: DEFAULT_PARAMS (τ = 6 h, 40 runs, det1 maths), no actions. Weather: hourly ERA5 from
// the cache the FWI pipeline wrote (.cache/era5/<year>/archive_<lat>_<lon>.json, nearest 0.5°
// point; ml/forecast/era5.py), starting at the hour of t0, with the 72 h of rain before it as
// antecedent rain. Boxes whose weather file is missing are skipped and counted.
//
// That archive has no wind direction (temperature, humidity, wind speed, rain only), and this run
// must not call Open-Meteo. The 40 runs are therefore split over 8 wind directions (0°, 45° …
// 315°, 5 seeds each) with the ERA5 speed: a direction-averaged CA, the honest forecast when the
// direction is unknown. On top of that each run perturbs direction and speed as usual.
//
// Probabilities: lead 1 = share of runs in which a cell of the block newly ignites in (0, 24 h]
// (ensembleBlockProbabilities, as the register and the hindcasts); lead 2 = share of runs in which
// a cell of the block that ignited after t0 is burning at some time in (24, 48 h] (what a satellite
// could see in that window).
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataEnv } from '../../src/data/env.ts';
import type { RawHotspot } from '../../src/data/firms.ts';
import { bboxAround } from '../../src/data/live.ts';
import type { LiveWeather } from '../../src/data/openmeteo.ts';
import { runEnsemble, seedsFor } from '../../src/sim/ensemble.ts';
import { ensembleBlockProbabilities } from '../../src/sim/hindcast.ts';
import { DEFAULT_PARAMS } from '../../src/sim/model.ts';
import type { EnsembleResult, Landscape, Scenario, WeatherHour } from '../../src/sim/types.ts';
import { firmsArchive } from '../lib/firms-archive.ts';
import { nodeEnv } from '../lib/node-env.ts';
import { buildBox, firmsWindow, loadBoxes, ML_DIR, pool, readJsonl, ROOT, type MlBox } from './common.ts';

const args = process.argv.slice(2);
const arg = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const splits = new Set(arg('splits', 'validation,test,oot,oot_allviirs').split(','));
const conc = Number(arg('concurrency', '4'));
const limit = Number(arg('limit', '0'));
const OUT = join(ML_DIR, `ca${arg('shard', '') ? '-' + arg('shard', '').replace('/', 'of') : ''}.jsonl`);
const DIRECTIONS = 8;
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

const base = nodeEnv({ offline: true });
const env: DataEnv = { ...base, overpass: async () => { throw new Error('Overpass is switched off in batch runs'); } };
const archive = firmsArchive(join(ROOT, '.cache', 'firms-archive'));

/** Nearest 0.5° ERA5 point file of the FWI pipeline (snap as ml/forecast/era5.py). */
export function era5File(lat: number, lon: number, year: number): string {
  const snap = (v: number) => Math.round(v / 0.5) * 0.5;
  const f = (v: number) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}`;
  return join(ROOT, '.cache', 'era5', String(year), `archive_${f(snap(lat))}_${f(snap(lon))}.json`);
}

/** Hourly weather from t0's hour for 48 h, from a cached ERA5 point, with no wind direction (set per run group). */
export function era5Weather(file: string, t0: string, hours = 48): LiveWeather & { note: string } {
  const j = JSON.parse(readFileSync(file, 'utf8')) as { response: { hourly: Record<string, (number | string | null)[]> } };
  const h = j.response.hourly;
  const times = h.time as string[];
  const key = new Date(Date.parse(t0)).toISOString().slice(0, 13) + ':00';
  const i0 = times.indexOf(key);
  if (i0 < 0) throw new Error(`no ERA5 hour ${key} in ${file}`);
  let antecedent = 0;
  for (let i = Math.max(0, i0 - 72); i < i0; i++) antecedent += Number(h.precipitation[i] ?? 0);
  const out: WeatherHour[] = [];
  for (let t = 0; t <= hours && i0 + t < times.length; t++) {
    const i = i0 + t;
    if (h.wind_speed_10m[i] === null || h.temperature_2m[i] === null) break;
    out.push({ t, time: `${times[i]} UTC`, windKmh: Number(h.wind_speed_10m[i]), windFromDeg: 0, tempC: Number(h.temperature_2m[i]), rh: Number(h.relative_humidity_2m[i]), precipMm: Number(h.precipitation[i] ?? 0) });
  }
  if (out.length < hours + 1) throw new Error(`ERA5 ${file} has only ${out.length} hours from ${key}`);
  return { hours: out, antecedentRainMm: Math.round(antecedent * 10) / 10, timezone: 'UTC', fetchedAt: new Date(0).toISOString(), url: file, note: `ERA5 hourly (Open-Meteo archive, cached by ml/forecast/era5.py), nearest 0.5° point; no wind direction (runs split over ${DIRECTIONS} directions)` };
}

/** Run the direction-averaged ensemble: DEFAULT_PARAMS.runs split evenly over DIRECTIONS wind directions. */
export function directionAveragedEnsemble(s: Scenario): EnsembleResult['runs'] {
  const params = { ...DEFAULT_PARAMS, tauH: 6 };
  const seeds = seedsFor(params.runs);
  const per = params.runs / DIRECTIONS;
  const runs: EnsembleResult['runs'] = [];
  for (let k = 0; k < DIRECTIONS; k++) {
    const scn: Scenario = { ...s, weather: s.weather.map((w) => ({ ...w, windFromDeg: k * (360 / DIRECTIONS) })) };
    runs.push(...runEnsemble(scn, [], params, seeds.slice(k * per, (k + 1) * per)).runs);
  }
  return runs;
}

/** Lead-2 probability: share of runs with a cell (ignited after t0) burning at some time in (from, to]. */
export function burningInWindow(l: Landscape, runs: EnsembleResult['runs'], from: number, to: number, block = 4): Float32Array {
  const bw = Math.ceil(l.w / block), nb = bw * Math.ceil(l.h / block);
  const p = new Float32Array(nb), hit = new Uint8Array(nb);
  for (const r of runs) {
    hit.fill(0);
    for (let k = 0; k < r.ign.length; k++) {
      const ig = r.ign[k];
      if (ig > 0 && ig <= to && (r.out[k] === -1 || r.out[k] > from)) hit[Math.floor(Math.floor(k / l.w) / block) * bw + Math.floor((k % l.w) / block)] = 1;
    }
    for (let b = 0; b < nb; b++) p[b] += hit[b];
  }
  for (let b = 0; b < nb; b++) p[b] /= Math.max(1, runs.length);
  return p;
}

async function detectionsFor(b: MlBox): Promise<RawHotspot[]> {
  const { from, days } = firmsWindow(b.d);
  const g = bboxAround(b.lat, b.lon);
  const bbox: [number, number, number, number] = [g.west, g.south, g.east, g.north];
  if (b.split === 'oot' || b.split === 'oot_allviirs') {
    const a = await base.firms(bbox, 4, from);
    const c = await base.firms(bbox, days - 4, new Date(Date.parse(`${from}T00:00:00Z`) + 4 * 864e5).toISOString().slice(0, 10));
    const hs = [...a.hotspots, ...c.hotspots];
    return b.split === 'oot' ? hs.filter((h) => h.satellite === 'N') : hs;
  }
  return (await archive.firms(bbox, days, from)).hotspots;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const extracted = readJsonl<{ id: string; ok: boolean; blocks?: number[]; y?: number[][] }>(join(ML_DIR, 'boxes.jsonl'));
  const done = readJsonl<{ id: string; status: string }>(OUT);
  let boxes = loadBoxes().filter((b) => splits.has(b.split) && extracted.get(b.id)?.ok && done.get(b.id)?.status !== 'ok');
  const [si, sn] = arg('shard', '0/1').split('/').map(Number);
  boxes = boxes.filter((_, i) => i % sn === si);
  if (limit) boxes = boxes.slice(0, limit);
  log(`${boxes.length} boxes for the CA (${done.size} already in ${OUT})`);
  const t = Date.now();
  let n = 0;
  await pool(boxes, conc, async (b) => {
    const year = Number(b.d.slice(0, 4));
    const file = era5File(b.lat, b.lon, year);
    try {
      if (!existsSync(file)) { appendFileSync(OUT, JSON.stringify({ id: b.id, split: b.split, status: 'no-weather', file }) + '\n'); return; }
      const weather = era5Weather(file, b.t0);
      const built = await buildBox(b, await detectionsFor(b), env, weather);
      const s = built.scenario;
      const ex = extracted.get(b.id)!;
      // The scenario must give the same candidate blocks and labels as the extraction.
      const labelsMatch = built.labels.every((lb, k) => ex.blocks!.every((blk, i) => lb.obs[blk] === ex.y![k][i]));
      const runs = directionAveragedEnsemble(s);
      const p1 = ensembleBlockProbabilities(s.landscape, { runs } as EnsembleResult, 24);
      const p2 = burningInWindow(s.landscape, runs, 24, 48);
      appendFileSync(OUT, JSON.stringify({
        id: b.id, split: b.split, status: 'ok', labelsMatch, antecedentRainMm: weather.antecedentRainMm,
        meanWindKmh: weather.hours.reduce((a, w) => a + w.windKmh, 0) / weather.hours.length,
        p1: ex.blocks!.map((k) => p1[k]), p2: ex.blocks!.map((k) => p2[k]),
      }) + '\n');
    } catch (e) {
      appendFileSync(OUT, JSON.stringify({ id: b.id, split: b.split, status: 'error', error: e instanceof Error ? e.message : String(e) }) + '\n');
      log(`FAILED ${b.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    n++;
    if (n % 10 === 0 || n === boxes.length) log(`${n}/${boxes.length}, ${((Date.now() - t) / 1000 / n).toFixed(1)} s/box`);
  });
  log('done');
}
