// Carbon-project boundaries (public/data/carbon-projects/, made by scripts/carbon-projects.mjs
// from the KMLs filed in the Verra registry) and the FIRMS detections around them.
import { boundaryFromGeoJson, dedupe, expandBbox, type Detection, type ProjectBoundary } from '../sim/reversal';
import { FirmsKeyMissing } from './firms';
import { PEAT_Z, peatTileUrl } from './peat';
import { loadTileImage } from './env';
import { latToY, lonToX } from './tiles';

export interface ProjectMeta {
  id: string; name: string; vcsId: number; province: string; registryUrl: string;
  source: { name: string; documentId: string; registry: string };
  retrieved: string; areaHa: number; bbox: [number, number, number, number]; file: string;
}
export interface ProjectIndex { attribution: string; terms: string; retrieved: string; simplifiedM: number; projects: ProjectMeta[] }

let indexP: Promise<ProjectIndex> | null = null;
export function loadProjectIndex(): Promise<ProjectIndex> {
  indexP ??= fetch('/data/carbon-projects/index.json').then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  indexP.catch(() => { indexP = null; });
  return indexP;
}

const boundaries = new Map<string, Promise<ProjectBoundary>>();
export function loadBoundary(m: ProjectMeta): Promise<ProjectBoundary> {
  if (!boundaries.has(m.id)) {
    const p = fetch(`/${m.file}`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(boundaryFromGeoJson);
    p.catch(() => boundaries.delete(m.id));
    boundaries.set(m.id, p);
  }
  return boundaries.get(m.id)!;
}

/** FIRMS CSV with every column kept as text, so evidence carries the rows verbatim. */
export function parseFirmsRows(csv: string, source: string): Detection[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const c = line.split(',');
    const row: Record<string, string> = {};
    head.forEach((h, i) => { row[h] = c[i] ?? ''; });
    const t = (row.acq_time ?? '0000').padStart(4, '0');
    return {
      lat: Number(row.latitude), lon: Number(row.longitude), frp: Number(row.frp ?? 0), confidence: row.confidence ?? '',
      acquired: `${row.acq_date}T${t.slice(0, 2)}:${t.slice(2)}:00Z`, satellite: row.satellite ?? '', source, row,
    };
  }).filter((d) => isFinite(d.lat) && isFinite(d.lon));
}

async function firms(bbox: [number, number, number, number], days: number, date?: string): Promise<{ dets: Detection[]; sources: string[]; query: string }> {
  const query = `/api/firms?bbox=${bbox.map((v) => v.toFixed(4)).join(',')}&days=${days}${date ? `&date=${date}` : ''}`;
  const res = await fetch(query);
  if (res.status === 503) throw new FirmsKeyMissing();
  if (!res.ok) throw new Error(`FIRMS proxy HTTP ${res.status}`);
  const j = (await res.json()) as { sources: string[]; csv: string[] };
  return { dets: j.csv.flatMap((c, i) => parseFirmsRows(c, j.sources[i] ?? '')), sources: j.sources, query };
}

export interface ProjectFires { detections: Detection[]; products: string[]; query: string; fetchedAt: string }

/**
 * Detections in the project's box grown by 5 km, covering the last 7 days: the 5 UTC days from
 * 7 days ago in one request and the 3 days up to today in another (FIRMS allows at most 5 days
 * per request), so the rolling 168 h window has no gap.
 */
export async function fetchProjectFires(b: ProjectBoundary, nowMs = Date.now()): Promise<ProjectFires> {
  const box = expandBbox(b.bbox, 5500);
  const day = (n: number) => new Date(nowMs - n * 864e5).toISOString().slice(0, 10);
  const [older, recent] = await Promise.all([firms(box, 5, day(7)), firms(box, 3, day(2))]);
  return {
    detections: dedupe([...recent.dets, ...older.dets]),
    products: recent.sources,
    query: `${older.query} + ${recent.query}`,
    fetchedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * Peat soil under each detection from the Global Forest Watch peatland tiles (the same layer the
 * live scenarios use). Where a tile cannot be read the detection counts as peat (these are peat
 * projects) and is reported in `unknown`.
 */
export async function peatUnder(dets: Detection[]): Promise<{ peat: boolean[]; unknown: number }> {
  const tiles = new Map<string, Promise<ImageData>>();
  let unknown = 0;
  const peat = await Promise.all(dets.map(async (d) => {
    const fx = lonToX(d.lon, PEAT_Z), fy = latToY(d.lat, PEAT_Z);
    const tx = Math.floor(fx), ty = Math.floor(fy);
    const url = peatTileUrl(PEAT_Z, tx, ty);
    if (!tiles.has(url)) tiles.set(url, loadTileImage(url));
    try {
      const img = await tiles.get(url)!;
      const px = Math.min(255, Math.floor((fx - tx) * 256)), py = Math.min(255, Math.floor((fy - ty) * 256));
      return img.data[(py * 256 + px) * 4 + 3] > 0;
    } catch {
      unknown++;
      return true;
    }
  }));
  return { peat, unknown };
}
