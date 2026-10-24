// The open forecast format (schema/forecast-v1.json, docs/forecast-schema.md) and its scorer.
//
// Any fire model can take part: a forecast is the probability of NEW VIIRS fire in each 400 m
// block of a 6.4 km box over the 24 h after it was issued. It is sealed (canonical JSON →
// SHA-256 → OpenTimestamps, and the daily Merkle batch) before the window opens, and scored with
// exactly the rules of the forecast register and the hindcasts (src/sim/hindcast.ts scoreBlocks):
// 400 m blocks, new fire only, blocks within 3 km of fire at t0, POD/FAR/CSI at p ≥ 0.5, Brier
// score and Brier skill, next to the distance-only reference of equal size.
//
// Two reference "models" are scored on every box, so the board always has baselines:
//   distance     p = exp(−d / 1 km), d = distance from the block centre to the nearest block on
//                fire at t0 (fixed a priori, never fitted on outcomes: the 8 neighbouring blocks
//                get p ≥ 0.5, so its yes/no forecast is "the fire grows by one VIIRS pixel").
//   climatology  p = 114 / 836 ≈ 0.136 everywhere: the share of candidate blocks (within 3 km of
//                fire at t0) that had new fire in the 12 hindcast events of 8–18 Oct 2026
//                (docs/hindcast-rerun-2026-10-24.json). Fixed; it is never refitted.
//
// Nothing here may import Node modules: it runs in the browser, the server and scripts.
import type { RawHotspot } from '../data/firms';
import { blockDistanceKm, scoreBlocks, type BlockGrid, type HindcastScore } from './hindcast';
import { canonical, sha256Hex } from './receipt';

export const FORECAST_SCHEMA = 'fireseptum.forecast.v1';
export const FORECAST_GRID = 'blocks400m';
export const FORECAST_WINDOW_H = 24;
/** The 6.4 km box: 64 × 64 cells of 100 m, scored in 16 × 16 blocks of 4 × 4 cells. */
export const BOX_GRID: BlockGrid = { w: 64, h: 64, cellM: 100, block: 4 };
export const BLOCKS = 256;
/** Detections up to this long before issuedAt make the "fire at t0" mask of a submitted box (the live scenario reads 2 days of FIRMS). */
export const FIRE_LOOKBACK_H = 48;
/** VIIRS I-band pixel radius in cells (375 m pixel at 100 m cells), as the live scenario's initial fire. */
export const FIRE_RADIUS_CELLS = 1.9;
/** Model ids the scorer computes itself; outside submissions cannot use them. */
export const REFERENCE_MODELS = ['distance', 'climatology'] as const;
export const REGISTER_MODEL = 'fire-septum-ca';
export const RESERVED_MODEL_IDS: readonly string[] = [REGISTER_MODEL, ...REFERENCE_MODELS];
export const CLIMATOLOGY_RATE = 114 / 836;
export const DISTANCE_EFOLD_KM = 1;
/** Rough bounds of Indonesia (lat, lon), for accepting submissions. */
export const INDONESIA = { south: -11.5, north: 6.5, west: 94.5, east: 141.5 };
/** Submissions must reach the server within this long after issuedAt, so nobody can forecast what FIRMS already shows. */
export const MAX_SUBMISSION_LAG_H = 1;

export interface ForecastModel { id: string; name: string; version: string; url?: string }
export interface ForecastBox { lat: number; lon: number }
export interface BoxProbabilities extends ForecastBox { probabilities: number[] }

/** A forecast in the open format. Either one box (`box` + `probabilities`) or several (`boxes`). */
export interface Forecast {
  schema: typeof FORECAST_SCHEMA;
  model: ForecastModel;
  /** ISO 8601 with time zone. The window is (issuedAt, issuedAt + windowH]. */
  issuedAt: string;
  windowH: typeof FORECAST_WINDOW_H;
  grid: typeof FORECAST_GRID;
  box?: ForecastBox;
  /** 256 numbers in [0, 1]: P(new VIIRS fire in the block during the window), row-major from the NW block. */
  probabilities?: number[];
  boxes?: BoxProbabilities[];
  metadata?: Record<string, unknown>;
}

/** A forecast for exactly one box, as scoreForecast takes it. */
export type BoxForecast = Forecast & { box: ForecastBox; probabilities: number[] };

/** Score of one forecast on one box: the register's HindcastScore plus the detections counted. */
export interface ForecastScore extends HindcastScore {
  /** Detections in the box during the window (before the "new fire only" filter). */
  detections: number;
}

// --- Validation (the same rules as schema/forecast-v1.json; src/sim/forecast.test.ts checks both agree).

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{1,62}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_BOXES = 50;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number) => typeof v === 'string' && v.length >= 1 && v.length <= max;

function checkProbabilities(p: unknown, at: string, err: string[]) {
  if (!Array.isArray(p) || p.length !== BLOCKS) { err.push(`${at} must be an array of ${BLOCKS} numbers`); return; }
  const bad = p.findIndex((x) => typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1);
  if (bad >= 0) err.push(`${at}[${bad}] must be a number in [0, 1]`);
}

function checkBox(b: unknown, at: string, err: string[]) {
  if (!isObj(b)) { err.push(`${at} must be an object {lat, lon}`); return; }
  if (typeof b.lat !== 'number' || !(b.lat >= -90 && b.lat <= 90)) err.push(`${at}.lat must be a number in [-90, 90]`);
  if (typeof b.lon !== 'number' || !(b.lon >= -180 && b.lon <= 180)) err.push(`${at}.lon must be a number in [-180, 180]`);
}

/** Schema check. Returns the list of problems (empty when the forecast is valid). */
export function validateForecast(f: unknown): string[] {
  const err: string[] = [];
  if (!isObj(f)) return ['a forecast must be a JSON object'];
  const allowed = new Set(['schema', 'model', 'issuedAt', 'windowH', 'grid', 'box', 'probabilities', 'boxes', 'metadata', '$schema']);
  for (const k of Object.keys(f)) if (!allowed.has(k)) err.push(`unknown field "${k}"`);
  if (f.schema !== FORECAST_SCHEMA) err.push(`schema must be "${FORECAST_SCHEMA}"`);
  if (!isObj(f.model)) err.push('model must be an object {id, name, version, url?}');
  else {
    const m = f.model;
    for (const k of Object.keys(m)) if (!['id', 'name', 'version', 'url'].includes(k)) err.push(`unknown field "model.${k}"`);
    if (typeof m.id !== 'string' || !MODEL_ID.test(m.id)) err.push('model.id must match ^[a-z0-9][a-z0-9._-]{1,62}$');
    if (!str(m.name, 120)) err.push('model.name must be a string of 1–120 characters');
    if (!str(m.version, 64)) err.push('model.version must be a string of 1–64 characters');
    if (m.url !== undefined && !(typeof m.url === 'string' && /^https?:\/\/\S+$/.test(m.url) && m.url.length <= 500)) err.push('model.url must be an http(s) URL');
  }
  if (typeof f.issuedAt !== 'string' || !ISO.test(f.issuedAt) || Number.isNaN(Date.parse(f.issuedAt))) err.push('issuedAt must be an ISO 8601 date-time with a time zone');
  if (f.windowH !== FORECAST_WINDOW_H) err.push(`windowH must be ${FORECAST_WINDOW_H}`);
  if (f.grid !== FORECAST_GRID) err.push(`grid must be "${FORECAST_GRID}"`);
  const single = f.box !== undefined || f.probabilities !== undefined;
  if (single && f.boxes !== undefined) err.push('give either box + probabilities or boxes, not both');
  else if (single) {
    checkBox(f.box, 'box', err);
    checkProbabilities(f.probabilities, 'probabilities', err);
  } else if (f.boxes !== undefined) {
    if (!Array.isArray(f.boxes) || f.boxes.length < 1 || f.boxes.length > MAX_BOXES) err.push(`boxes must be an array of 1–${MAX_BOXES} boxes`);
    else f.boxes.forEach((b, i) => {
      checkBox(b, `boxes[${i}]`, err);
      if (isObj(b)) {
        for (const k of Object.keys(b)) if (!['lat', 'lon', 'probabilities'].includes(k)) err.push(`unknown field "boxes[${i}].${k}"`);
        checkProbabilities(b.probabilities, `boxes[${i}].probabilities`, err);
      }
    });
  } else err.push('box + probabilities (or boxes) is required');
  if (f.metadata !== undefined && !isObj(f.metadata)) err.push('metadata must be an object');
  return err;
}

/** One single-box forecast per box, in order. */
export function splitForecast(f: Forecast): BoxForecast[] {
  const { boxes, box, probabilities, ...rest } = f;
  if (boxes) return boxes.map((b) => ({ ...rest, box: { lat: b.lat, lon: b.lon }, probabilities: b.probabilities }));
  return [{ ...rest, box: box!, probabilities: probabilities! }];
}

export const inIndonesia = (b: ForecastBox) => b.lat >= INDONESIA.south && b.lat <= INDONESIA.north && b.lon >= INDONESIA.west && b.lon <= INDONESIA.east;

/** SHA-256 of the canonical JSON (sorted keys): the hash that is timestamped and batched. */
export const forecastSha256 = (f: Forecast) => sha256Hex(canonical(f));

// --- Geometry: the same box as src/data/live.ts bboxAround (64 cells of 100 m around the centre).

export function boxBounds(lat: number, lon: number) {
  const sizeM = BOX_GRID.w * BOX_GRID.cellM;
  const dLat = sizeM / 2 / 111_320;
  const dLon = sizeM / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { north: lat + dLat, south: lat - dLat, west: lon - dLon, east: lon + dLon };
}

/** Cell coordinates of a point in the box (cell centres at integers, (0, 0) the NW cell). */
export function boxCell(b: ForecastBox, lat: number, lon: number) {
  const g = boxBounds(b.lat, b.lon);
  return { x: ((lon - g.west) / (g.east - g.west)) * BOX_GRID.w - 0.5, y: ((g.north - lat) / (g.north - g.south)) * BOX_GRID.h - 0.5 };
}

type Detection = Pick<RawHotspot, 'lat' | 'lon' | 'acquired'>;

/** Detections acquired in (issuedAt, issuedAt + windowH] inside the box, in cell coordinates (as register.observedInWindow). */
export function detectionsInWindow<D extends Detection>(f: { issuedAt: string; windowH: number; box: ForecastBox }, detections: D[]): (D & { x: number; y: number })[] {
  const from = Date.parse(f.issuedAt), to = from + f.windowH * 3.6e6;
  return detections
    .filter((d) => { const a = Date.parse(d.acquired); return a > from && a <= to; })
    .map((d) => ({ ...d, ...boxCell(f.box, d.lat, d.lon) }))
    .filter((p) => p.x >= -0.5 && p.y >= -0.5 && p.x < BOX_GRID.w - 0.5 && p.y < BOX_GRID.h - 0.5);
}

/**
 * Fire at t0 for a box with no sealed scenario: every block with a cell within 1.9 cells (one VIIRS
 * pixel) of a detection acquired in [issuedAt − 48 h, issuedAt]. The register uses its sealed
 * initial state instead, which applies the same disc to the fuel cells.
 */
export function fireMaskFromDetections(box: ForecastBox, issuedAt: string, detections: Detection[]): Uint8Array {
  const t0 = Date.parse(issuedAt), from = t0 - FIRE_LOOKBACK_H * 3.6e6;
  const { w, h, block } = BOX_GRID, bw = w / block;
  const mask = new Uint8Array(BLOCKS);
  const r = FIRE_RADIUS_CELLS, r2 = r * r;
  for (const d of detections) {
    const a = Date.parse(d.acquired);
    if (!(a >= from && a <= t0)) continue;
    const { x: cx, y: cy } = boxCell(box, d.lat, d.lon);
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) mask[Math.floor(y / block) * bw + Math.floor(x / block)] = 1;
      }
    }
  }
  return mask;
}

/** "0"/"1" string of a 256-block mask (compact storage), and back. */
export const maskToString = (m: ArrayLike<number>) => Array.from(m, (v) => (v ? '1' : '0')).join('');
export const maskFromString = (s: string) => Uint8Array.from(s, (c) => (c === '1' ? 1 : 0));

/**
 * Score one single-box forecast: detections in (issuedAt, issuedAt + windowH] against the
 * per-block probabilities, new fire only (blocks not in `fireAtT0`, within 3 km of it). The same
 * rules and code as the register and the hindcasts.
 */
export function scoreForecast(forecast: BoxForecast, observedDetections: Detection[], fireAtT0: ArrayLike<number>): ForecastScore {
  if (forecast.probabilities.length !== BLOCKS || fireAtT0.length !== BLOCKS) throw new Error(`a forecast and its fire mask have ${BLOCKS} blocks`);
  const obs = detectionsInWindow(forecast, observedDetections);
  return { ...scoreBlocks(BOX_GRID, forecast.probabilities, fireAtT0, obs), detections: obs.length };
}

// --- Reference models.

/** Distance reference: p = exp(−d / 1 km) from each block centre to the nearest block on fire at t0 (0 where there is none). */
export function distanceProbabilities(fireAtT0: ArrayLike<number>): number[] {
  const d = blockDistanceKm(BOX_GRID, fireAtT0);
  return Array.from(d, (km, b) => (fireAtT0[b] || !Number.isFinite(km) ? 0 : Math.exp(-km / DISTANCE_EFOLD_KM)));
}

export const climatologyProbabilities = (): number[] => new Array(BLOCKS).fill(CLIMATOLOGY_RATE);

export const REFERENCE_MODEL_INFO: Record<string, ForecastModel & { note: string }> = {
  [REGISTER_MODEL]: { id: REGISTER_MODEL, name: 'Fire Septum cellular automaton (40-run ensemble)', version: 'register', url: 'https://github.com/aliefauzan/fire-septum', note: 'Share of the 40 sealed runs that ignite the block within 24 h.' },
  distance: { id: 'distance', name: 'Distance to fire (reference)', version: '1', note: 'p = exp(−d / 1 km), d = distance to the nearest block on fire at t0.' },
  climatology: { id: 'climatology', name: 'Climatology (reference)', version: '1', note: 'p = 114/836 ≈ 0.136 in every block: the new-fire rate of the 12 hindcast events, 8–18 Oct 2026.' },
};

/** A reference forecast for a box, in the open format. */
export function referenceForecast(id: (typeof REFERENCE_MODELS)[number], box: ForecastBox, issuedAt: string, fireAtT0: ArrayLike<number>, windowH = FORECAST_WINDOW_H): BoxForecast {
  const { note: _note, ...model } = REFERENCE_MODEL_INFO[id];
  void _note;
  return {
    schema: FORECAST_SCHEMA, model, issuedAt, windowH: windowH as typeof FORECAST_WINDOW_H, grid: FORECAST_GRID, box,
    probabilities: id === 'distance' ? distanceProbabilities(fireAtT0) : climatologyProbabilities(),
  };
}

/** Scores of the two reference models on a box. */
export function scoreReferences(box: ForecastBox, issuedAt: string, windowH: number, observedDetections: Detection[], fireAtT0: ArrayLike<number>): Record<string, ForecastScore> {
  const out: Record<string, ForecastScore> = {};
  for (const id of REFERENCE_MODELS) out[id] = scoreForecast(referenceForecast(id, box, issuedAt, fireAtT0, windowH), observedDetections, fireAtT0);
  return out;
}

/** Key that identifies a scored box (centre to ~10 m and the hour the window opens), for counting each box's baselines once. */
export const boxKey = (b: ForecastBox, issuedAt: string) => `${b.lat.toFixed(4)},${b.lon.toFixed(4)}@${new Date(issuedAt).toISOString().slice(0, 13)}`;
