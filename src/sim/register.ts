// Pre-registered forecasts: a forecast is sealed, signed and timestamped on Bitcoin
// (OpenTimestamps) BEFORE the satellites see what happens next, then scored against
// the NASA FIRMS detections of the following 24 h. A hindcast can be tuned after the
// fact; a pre-registered forecast cannot, because the timestamp proves when it was made.
import type { HindcastScore } from './hindcast';
import type { RunRecord } from './receipt';
import type { Hotspot, Landscape } from './types';

export const REGISTER_WINDOW_H = 24;
/** FIRMS near-real-time data appears about 3 h after the overpass; wait a little longer before scoring. */
export const FIRMS_LATENCY_H = 6;

export interface RegisterScore {
  scoredAt: string;
  /** The sealed inputs re-ran to the sealed output hash in the scoring browser. */
  reproduced: boolean;
  /** Detections in the 6.4 km box during the window (before the "new fire only" filter). */
  detections: number;
  result: HindcastScore;
}

/** Entry formats. Version 1 entries were written under the project's first name, SekatApi. */
export const ENTRY_KIND = { 1: 'sekatapi.preregistered-forecast', 2: 'fireseptum.preregistered-forecast' } as const;

export interface RegisterEntry {
  v: 1 | 2;
  kind: (typeof ENTRY_KIND)[1 | 2];
  /** When the forecast was sealed. The observation window starts here. */
  issuedAt: string;
  lat: number;
  lon: number;
  windowH: number;
  /** How this place was picked, fixed before any outcome was known. */
  rule: string;
  /** The sealed forecast (no actions): receipt, signature, OpenTimestamps proof and the inputs to re-run it. */
  record: RunRecord;
  score?: RegisterScore;
}

/** Earliest time the window's detections are all in FIRMS. */
export const dueAt = (e: Pick<RegisterEntry, 'issuedAt' | 'windowH'>) => Date.parse(e.issuedAt) + (e.windowH + FIRMS_LATENCY_H) * 3.6e6;

/** Cell coordinates of a detection in a geo-referenced landscape (cell centres at integer coordinates). */
export function cellOf(l: Landscape, lat: number, lon: number): { x: number; y: number } {
  const g = l.geo!;
  return {
    x: ((lon - g.west) / (g.east - g.west)) * l.w - 0.5,
    y: ((g.north - lat) / (g.north - g.south)) * l.h - 0.5,
  };
}

/** Detections acquired in (issuedAt, issuedAt + windowH], placed on the forecast grid. */
export function observedInWindow(
  l: Landscape, e: Pick<RegisterEntry, 'issuedAt' | 'windowH'>,
  detections: Omit<Hotspot, 'x' | 'y'>[],
): Hotspot[] {
  const from = Date.parse(e.issuedAt), to = from + e.windowH * 3.6e6;
  return detections
    .filter((d) => { const a = Date.parse(d.acquired); return a > from && a <= to; })
    .map((d) => ({ ...d, ...cellOf(l, d.lat, d.lon) }))
    .filter((p) => p.x >= -0.5 && p.y >= -0.5 && p.x < l.w - 0.5 && p.y < l.h - 0.5);
}

export interface RegisterSummary {
  issued: number;
  scored: number;
  /** Pooled over scored entries with any new fire. */
  observed: number;
  predicted: number;
  hits: number;
  csi: number;
  distanceCsi: number;
}

/** Pool the scored entries: CSI from summed hits, misses and false alarms; distance-only from per-entry CSI weights. */
export function summarize(entries: RegisterEntry[]): RegisterSummary {
  const scored = entries.filter((e) => e.score);
  let hits = 0, misses = 0, fa = 0, dHits = 0, dDen = 0, predicted = 0;
  for (const e of scored) {
    const s = e.score!.result;
    hits += s.hits; misses += s.misses; fa += s.falseAlarms; predicted += s.predicted;
    // Distance-only forecast has the same size as the model's, so its hits follow from its CSI.
    const den = s.hits + s.misses + s.falseAlarms;
    dHits += s.distance.csi * den; dDen += den;
  }
  const r = (a: number, b: number) => (b > 0 ? a / b : 0);
  return { issued: entries.length, scored: scored.length, observed: hits + misses, predicted, hits, csi: r(hits, hits + misses + fa), distanceCsi: r(dHits, dDen) };
}
