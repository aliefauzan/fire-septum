// Reversal monitoring for peat carbon projects (REDD+ / VCS): has fire been seen inside a
// project boundary, or close to it, in the last 24 h and 7 days, and how much did it emit?
//
// A project loses credited carbon when its forest or peat burns ("reversal"). Buffer pools and
// insurers want early evidence. This module only describes what satellites observed: VIIRS
// detections against the boundary the proponent filed, and the fire-radiative-power emission
// estimate from frp.ts. It does not estimate avoided emissions, does not verify anything and
// says nothing about a project's credits.
import type { Rates } from './doctrine';
import { observedEmissions, type ObservedEmissions } from './frp';
import { FUEL_INDEX } from './fuels';
import type { Hotspot, Landscape } from './types';

/** [lon, lat] positions; a polygon is an outer ring then holes, as in GeoJSON. */
export type Ring = [number, number][];
export type Polygon = Ring[];

export interface ProjectBoundary {
  id: string;
  name: string;
  vcsId: number;
  registryUrl: string;
  province?: string;
  areaHa?: number;
  /** [west, south, east, north]. */
  bbox: [number, number, number, number];
  polygons: Polygon[];
}

/** One FIRMS detection, with the CSV row it came from kept verbatim for evidence. */
export interface Detection {
  lat: number;
  lon: number;
  frp: number;
  confidence: string;
  acquired: string; // ISO UTC
  satellite: string;
  /** FIRMS product the row came from, e.g. VIIRS_SNPP_NRT. */
  source?: string;
  row?: Record<string, string>;
}

export type ReversalStatus = 'inside' | 'within1km' | 'within5km' | 'clear';

export const STATUS_ORDER: ReversalStatus[] = ['inside', 'within1km', 'within5km', 'clear'];
export const NEAR_M = { within1km: 1000, within5km: 5000 } as const;

const M_PER_DEG_LAT = 110_574;
const mPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Even–odd ray casting on one ring. */
function inRing(lon: number, lat: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inPolygon(lon: number, lat: number, p: Polygon): boolean {
  if (!p.length || !inRing(lon, lat, p[0])) return false;
  for (let h = 1; h < p.length; h++) if (inRing(lon, lat, p[h])) return false;
  return true;
}

export function insideProject(lon: number, lat: number, b: Pick<ProjectBoundary, 'polygons'>): boolean {
  return b.polygons.some((p) => inPolygon(lon, lat, p));
}

/** Shortest distance in metres from the point to any edge of the boundary (local flat-earth, fine within tens of km). */
export function edgeDistanceM(lon: number, lat: number, b: Pick<ProjectBoundary, 'polygons'>): number {
  const kx = mPerDegLon(lat), ky = M_PER_DEG_LAT;
  let best = Infinity;
  for (const p of b.polygons) for (const r of p) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const ax = (r[j][0] - lon) * kx, ay = (r[j][1] - lat) * ky;
      const bx = (r[i][0] - lon) * kx, by = (r[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy;
      const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

/** The project's bbox grown by `m` metres on every side, [west, south, east, north]. */
export function expandBbox(b: [number, number, number, number], m: number): [number, number, number, number] {
  const lat = (b[1] + b[3]) / 2;
  const dLat = m / M_PER_DEG_LAT, dLon = m / mPerDegLon(lat);
  return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}

export interface PlacedDetection {
  d: Detection;
  inside: boolean;
  /** Distance to the boundary edge, metres. 0 counts as on the line; inside points also carry their edge distance. */
  edgeM: number;
  /** 0 when inside, else the edge distance. */
  outsideM: number;
  status: ReversalStatus;
}

export function place(d: Detection, b: Pick<ProjectBoundary, 'polygons'>): PlacedDetection {
  const inside = insideProject(d.lon, d.lat, b);
  const edgeM = edgeDistanceM(d.lon, d.lat, b);
  const outsideM = inside ? 0 : edgeM;
  const status: ReversalStatus = inside ? 'inside' : outsideM <= NEAR_M.within1km ? 'within1km' : outsideM <= NEAR_M.within5km ? 'within5km' : 'clear';
  return { d, inside, edgeM, outsideM, status };
}

export interface WindowSummary {
  hours: number;
  fromMs: number;
  toMs: number;
  status: ReversalStatus;
  counts: Record<Exclude<ReversalStatus, 'clear'>, number>;
  /** Detections within 5 km or inside, nearest first. */
  near: PlacedDetection[];
  /** Nearest outside detection, metres (null when none within the search box). */
  nearestOutsideM: number | null;
  /** Emissions seen inside the boundary in this window (FRP method), null without detections inside. */
  observed: ObservedEmissions | null;
}

export interface ProjectReport {
  projectId: string;
  nowMs: number;
  h24: WindowSummary;
  d7: WindowSummary;
}

/** Cover under a detection inside a project: true = peat soil. */
export type PeatAt = (d: Detection) => boolean;

/**
 * Observed emissions from the detections inside a project, with the existing FRP method
 * (frp.ts: passes held to the next pass, GFAS β, IPCC emission factors). Each detection gets its
 * own cell of a one-row landscape whose fuel is peat swamp forest, or plantation (counted as
 * tropical forest) where the peat map says the ground is not peat.
 */
export function observedInside(inside: Detection[], nowMs: number, rates: Rates, windowH: number, peatAt: PeatAt = () => true): ObservedEmissions | null {
  if (inside.length === 0) return null;
  const w = inside.length;
  const fuel = Uint8Array.from(inside.map((d) => (peatAt(d) ? FUEL_INDEX.peat : FUEL_INDEX.plantation)));
  const l: Landscape = { w, h: 1, cellM: 375, fuel, elev: new Float32Array(w), zoneOf: new Uint8Array(w).fill(255), zones: [] };
  const hs: Hotspot[] = inside.map((d, i) => ({ lat: d.lat, lon: d.lon, x: i, y: 0, frp: d.frp, confidence: d.confidence, acquired: d.acquired, satellite: d.satellite }));
  return observedEmissions(l, hs, nowMs, rates, windowH);
}

export function summarize(b: Pick<ProjectBoundary, 'polygons'>, dets: Detection[], nowMs: number, hours: number, rates: Rates, peatAt?: PeatAt): WindowSummary {
  const fromMs = nowMs - hours * 3.6e6;
  const placed = dets
    .filter((d) => { const t = Date.parse(d.acquired); return t > fromMs && t <= nowMs; })
    .map((d) => place(d, b));
  const counts = { inside: 0, within1km: 0, within5km: 0 };
  for (const p of placed) if (p.status !== 'clear') counts[p.status]++;
  const status: ReversalStatus = counts.inside ? 'inside' : counts.within1km ? 'within1km' : counts.within5km ? 'within5km' : 'clear';
  const outside = placed.filter((p) => !p.inside).map((p) => p.outsideM);
  return {
    hours, fromMs, toMs: nowMs, status, counts,
    near: placed.filter((p) => p.status !== 'clear').sort((a, b2) => a.outsideM - b2.outsideM || Date.parse(b2.d.acquired) - Date.parse(a.d.acquired)),
    nearestOutsideM: outside.length ? Math.min(...outside) : null,
    observed: observedInside(placed.filter((p) => p.inside).map((p) => p.d), nowMs, rates, hours, peatAt),
  };
}

/** Status for the last 24 h and 7 days. */
export function monitorProject(b: ProjectBoundary, dets: Detection[], nowMs: number, rates: Rates, peatAt?: PeatAt): ProjectReport {
  return { projectId: b.id, nowMs, h24: summarize(b, dets, nowMs, 24, rates, peatAt), d7: summarize(b, dets, nowMs, 168, rates, peatAt) };
}

/** Same detection reported twice (overlapping FIRMS requests) counts once. */
export function dedupe(dets: Detection[]): Detection[] {
  const seen = new Set<string>();
  return dets.filter((d) => { const k = `${d.lat.toFixed(5)},${d.lon.toFixed(5)},${d.acquired},${d.satellite}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** GeoJSON (Polygon or MultiPolygon features) to boundaries. */
export function boundaryFromGeoJson(fc: { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] }): ProjectBoundary {
  const f = fc.features[0];
  const g = f.geometry;
  const polygons = (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) as Polygon[];
  const p = f.properties as unknown as ProjectBoundary;
  return { id: p.id, name: p.name, vcsId: p.vcsId, registryUrl: p.registryUrl, province: p.province, areaHa: p.areaHa, bbox: p.bbox, polygons };
}

/** True when two [w, s, e, n] boxes overlap. */
export const bboxOverlap = (a: [number, number, number, number], b: [number, number, number, number]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
