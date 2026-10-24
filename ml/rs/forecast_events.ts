// Fire Septum: run the app's own spread model on the recorded event and write per-cell burn
// probabilities at 24 h and 48 h, for comparison with the measured (Sentinel-2/1) burned area.
//
//   npx tsx ml/rs/forecast_events.ts
//
// Only src/data/events/kalimantan-2026-10-18.json has a stored scenario; the other 11
// validation events are compared with FIRMS only (see docs/burned-area.md).
//
// The recorded scenario carries 25 hours of weather (horizon 24 h). For the 48 h forecast the
// same Open-Meteo historical-forecast archive the scenario was built from is fetched again for
// hours 25-48 and appended; hours 0-24 stay exactly as recorded, so the first 24 h of the 48 h
// run are identical to the 24 h run. If the archive cannot be reached, the last recorded hour
// is held for hours 25-48 and the output says so.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWeatherAt } from '../../src/data/openmeteo';
import { burnProbabilityAt, runEnsemble } from '../../src/sim/ensemble';
import { scoreHindcast } from '../../src/sim/hindcast';
import { DEFAULT_PARAMS } from '../../src/sim/model';
import { decode } from '../../src/sim/receipt';
import { Cell, type EnsembleResult, type Scenario, type WeatherHour } from '../../src/sim/types';

// Node's 250 ms happy-eyeballs attempt timeout is too short on slow links to Open-Meteo.
setDefaultAutoSelectFamilyAttemptTimeout(5000);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EVENT = 'kalimantan-2026-10-18';
const OUT = resolve(ROOT, `data/validation/burned-area/forecast-${EVENT}.json`);
const B = 4; // 400 m blocks, as in src/sim/hindcast.ts

const scn = decode<Scenario>(JSON.parse(readFileSync(resolve(ROOT, `src/data/events/${EVENT}.json`), 'utf8')));
const l = scn.landscape;
const n = l.w * l.h;
const t0 = scn.hindcast!.t0;

/** Share of runs in which each 400 m block gets new fire by hour `at` (same rule as scoreHindcast). */
function blockProb(e: EnsembleResult, at: number): number[] {
  const bw = Math.ceil(l.w / B), bh = Math.ceil(l.h / B), nb = bw * bh;
  const p = new Float64Array(nb), hit = new Uint8Array(nb);
  for (const r of e.runs) {
    hit.fill(0);
    for (let k = 0; k < n; k++) if (r.ign[k] > 0 && r.ign[k] <= at) hit[Math.floor(Math.floor(k / l.w) / B) * bw + Math.floor((k % l.w) / B)] = 1;
    for (let b = 0; b < nb; b++) p[b] += hit[b];
  }
  return Array.from(p, (v) => +(v / Math.max(1, e.runs.length)).toFixed(4));
}

/** Per-cell share of runs with NEW ignition (ign > 0) by `at`; cells burning at t0 are excluded. */
function newCellProb(e: EnsembleResult, at: number): number[] {
  const p = new Float64Array(n);
  for (const r of e.runs) for (let k = 0; k < n; k++) if (r.ign[k] > 0 && r.ign[k] <= at) p[k] += 1;
  return Array.from(p, (v) => +(v / Math.max(1, e.runs.length)).toFixed(4));
}

const round4 = (a: Float32Array) => Array.from(a, (v) => +v.toFixed(4));

async function main() {
  const params = { ...DEFAULT_PARAMS };
  // 24 h: the recorded scenario exactly as stored.
  const e24 = runEnsemble(scn, [], params);
  const score24 = scoreHindcast(l, scn.init, e24, scn.hindcast!.observed, 24);

  // 48 h: recorded hours 0-24 + archived hours 25-48.
  let weatherNote: string;
  let ext: WeatherHour[];
  try {
    const lat = (l.geo!.north + l.geo!.south) / 2, lon = (l.geo!.east + l.geo!.west) / 2;
    const w = await fetchWeatherAt(lat, lon, t0, 48);
    const tail = w.hours.filter((h) => h.t > scn.weather.length - 1);
    if (w.hours.length < 49) throw new Error(`archive returned ${w.hours.length} hours`);
    ext = [...scn.weather, ...tail];
    weatherNote = `hours 0-${scn.weather.length - 1} as recorded; hours ${scn.weather.length}-48 from ${w.url.split('?')[0]} (fetched ${w.fetchedAt})`;
  } catch (err) {
    const last = scn.weather[scn.weather.length - 1];
    ext = [...scn.weather];
    for (let t = scn.weather.length; t <= 48; t++) ext.push({ ...last, t });
    weatherNote = `hours 0-${scn.weather.length - 1} as recorded; archive unavailable (${String(err)}), last hour held for 25-48`;
  }
  const scn48: Scenario = { ...scn, weather: ext, horizonH: 48 };
  const e48 = runEnsemble(scn48, [], params);

  const fireAtT0 = Array.from(scn.init.state, (s) => (s === Cell.Burning || s === Cell.Burned || s === Cell.Extinguished ? 1 : 0));
  const out = {
    event: EVENT,
    model: 'Fire Septum spread model (src/sim/model.ts), DEFAULT_PARAMS, no suppression',
    params: { runs: params.runs, tauH: params.tauH, dtH: params.dtH, math: params.math },
    t0,
    grid: { w: l.w, h: l.h, cellM: l.cellM, geo: l.geo, origin: 'cell (0,0) = north-west corner, row-major y*w+x' },
    weather48: weatherNote,
    hindcastScoreVsFirms24h: { observed: score24.observed, predicted: score24.predicted, hits: score24.hits, csi: +score24.csi.toFixed(3), distanceCsi: +score24.distance.csi.toFixed(3) },
    fireAtT0,
    // Any ignition by the hour (cells burning at t0 count as 1), as burnProbabilityAt in the app.
    p24: round4(burnProbabilityAt(e24, 24, n)),
    p48: round4(burnProbabilityAt(e48, 48, n)),
    // New ignitions only (ign > 0).
    pNew24: newCellProb(e24, 24),
    pNew48: newCellProb(e48, 48),
    block: B,
    blockPNew24: blockProb(e24, 24),
    blockPNew48: blockProb(e48, 48),
    check24vs48: 'blockPNew24 from the 48 h run equals the 24 h run when weather 0-24 is identical: ' + String(JSON.stringify(blockProb(e48, 24)) === JSON.stringify(blockProb(e24, 24))),
    ranAt: new Date().toISOString(),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`wrote ${OUT}`);
  console.log(`24 h vs FIRMS: CSI ${out.hindcastScoreVsFirms24h.csi} (distance ${out.hindcastScoreVsFirms24h.distanceCsi}); ${out.check24vs48}`);
  console.log(`48 h weather: ${weatherNote}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
