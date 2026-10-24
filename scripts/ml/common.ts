// Shared pieces of the forecaster pipeline (scripts/ml/extract.ts, assemble.ts, ca.ts).
//
// A box is one entry of data/validation/train-boxes.json (train) or events.json (validation,
// test, out-of-time). Its scenario is built exactly as a hindcast (src/data/hindcast.ts): the
// detections from 00:00 UTC two days before day D up to t0 are known (older than 24 h = burned
// scar, else burning), t0 is the published one. Labels are new-fire blocks (scoreBlocks' rule) for
// lead 1 (t0, t0+24 h], lead 2 (t0+24, t0+48 h] and lead 3 (t0+48, t0+72 h].
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataEnv } from '../../src/data/env.ts';
import type { RawHotspot } from '../../src/data/firms.ts';
import { buildLiveScenario } from '../../src/data/live.ts';
import type { LiveWeather } from '../../src/data/openmeteo.ts';
import { BOX_GRID } from '../../src/sim/forecast.ts';
import { blockFireMask, observedBlocks } from '../../src/sim/hindcast.ts';
import type { Scenario } from '../../src/sim/types.ts';

export const ROOT = process.cwd();
export const ML_DIR = join(ROOT, '.cache', 'ml');
export const LEADS = [1, 2, 3] as const;
export type Split = 'train' | 'validation' | 'test' | 'oot' | 'oot_allviirs';

export interface MlBox {
  id: string;
  split: Split;
  island: 'Kalimantan' | 'Sumatra';
  d: string;
  t0: string;
  lat: number;
  lon: number;
}

/** All boxes of the published split: train from train-boxes.json, the rest from events.json. */
export function loadBoxes(): MlBox[] {
  const read = (f: string) => (JSON.parse(readFileSync(join(ROOT, 'data', 'validation', f), 'utf8')) as { events: MlBox[] }).events;
  const train = read('train-boxes.json').filter((e) => e.split === 'train');
  const rest = read('events.json').filter((e) => e.split !== 'train');
  const pick = ({ id, split, island, d, t0, lat, lon }: MlBox): MlBox => ({ id, split, island, d, t0, lat, lon });
  const oot = rest.filter((e) => e.split === 'oot').map((e) => ({ ...pick(e), id: `${e.id}~all`, split: 'oot_allviirs' as Split }));
  return [...train.map(pick), ...rest.map(pick), ...oot];
}

/** Weather the feature extraction does not use (buildLiveScenario needs some). */
export function placeholderWeather(t0: string, hours = 48): LiveWeather & { note: string } {
  return {
    hours: Array.from({ length: hours + 1 }, (_, t) => ({ t, time: new Date(Date.parse(t0) + t * 3.6e6).toISOString(), windKmh: 0, windFromDeg: 0, tempC: 30, rh: 70, precipMm: 0 })),
    antecedentRainMm: 0, timezone: 'UTC', fetchedAt: new Date(0).toISOString(), url: 'none',
    note: 'Placeholder: weather is not used by the feature extraction',
  };
}

export interface BuiltBox {
  scenario: Scenario;
  warnings: string[];
  /** Per lead: new-fire blocks (1) and detections in the window. */
  labels: { obs: Uint8Array; newFires: number; detections: number }[];
}

/** Window of FIRMS detections read for a box: 00:00 UTC of D − 2 for 6 days (to past t0 + 72 h). */
export const firmsWindow = (d: string) => ({ from: new Date(Date.parse(`${d}T00:00:00Z`) - 2 * 864e5).toISOString().slice(0, 10), days: 6 });

export async function buildBox(b: MlBox, detections: RawHotspot[], env: DataEnv, weather?: LiveWeather & { note?: string }): Promise<BuiltBox> {
  const t0 = Date.parse(b.t0);
  const known = detections.filter((h) => Date.parse(h.acquired) <= t0);
  const inWin = (lead: number) => detections.filter((h) => { const a = Date.parse(h.acquired); return a > t0 + (lead - 1) * 864e5 && a <= t0 + lead * 864e5; });
  const { scenario, warnings } = await buildLiveScenario({
    lat: b.lat, lon: b.lon, horizonH: 48,
    past: { t0: b.t0, known, observed: inWin(1), windowH: 24 },
    weather: weather ?? placeholderWeather(b.t0),
  }, env);
  const l = scenario.landscape, g = l.geo!;
  const toCell = (r: RawHotspot) => ({ x: ((r.lon - g.west) / (g.east - g.west)) * l.w - 0.5, y: ((g.north - r.lat) / (g.north - g.south)) * l.h - 0.5 });
  const fire = blockFireMask(l, scenario.init, BOX_GRID.block);
  const labels = LEADS.map((lead) => {
    const obsDet = inWin(lead);
    const r = observedBlocks(BOX_GRID, fire, obsDet.map(toCell));
    return { ...r, detections: obsDet.length };
  });
  return { scenario, warnings, labels };
}

/** Read a JSON-lines file; later lines with the same id replace earlier ones. */
export function readJsonl<T extends { id: string }>(file: string): Map<string, T> {
  const m = new Map<string, T>();
  if (!existsSync(file)) return m;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line) as T; m.set(o.id, o); } catch { /* a line cut by a crash */ }
  }
  return m;
}

/** Run `f` over `items` with at most `n` in flight. */
export async function pool<T>(items: T[], n: number, f: (x: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; await f(items[i], i); }
  }));
}

export const nanToNull = (v: number) => (Number.isFinite(v) ? v : null);
