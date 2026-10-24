// NASA FIRMS active-fire detections through our server-side proxy (/api/firms),
// which keeps the MAP_KEY out of the browser.

export interface RawHotspot {
  lat: number;
  lon: number;
  frp: number;
  confidence: string;
  acquired: string; // ISO UTC
  satellite: string;
}

export interface FirmsResult {
  hotspots: RawHotspot[];
  sources: string[];
  fetchedAt: string;
}

/** The VIIRS near-real-time products the app reads (server/firmsProxy.ts uses the same three). */
export const FIRMS_SOURCES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'];

export class FirmsKeyMissing extends Error {
  constructor() { super('FIRMS_MAP_KEY is not set on the server'); }
}

export function parseFirmsCsv(csv: string): RawHotspot[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(',');
  const col = (n: string) => head.indexOf(n);
  const iLat = col('latitude'), iLon = col('longitude'), iFrp = col('frp'), iConf = col('confidence');
  const iDate = col('acq_date'), iTime = col('acq_time'), iSat = col('satellite');
  if (iLat < 0 || iLon < 0) return [];
  return lines.slice(1).map((line) => {
    const c = line.split(',');
    const t = (c[iTime] ?? '0000').padStart(4, '0');
    return {
      lat: Number(c[iLat]),
      lon: Number(c[iLon]),
      frp: Number(c[iFrp] ?? 0),
      confidence: c[iConf] ?? '',
      acquired: `${c[iDate]}T${t.slice(0, 2)}:${t.slice(2)}:00Z`,
      satellite: c[iSat] ?? '',
    };
  }).filter((h) => isFinite(h.lat) && isFinite(h.lon));
}

/** Detections in the box for the last `days` days, or for `days` days starting at `date` (YYYY-MM-DD, UTC). */
export async function fetchHotspots(bbox: [number, number, number, number], days = 2, date?: string): Promise<FirmsResult> {
  const res = await fetch(`/api/firms?bbox=${bbox.map((v) => v.toFixed(4)).join(',')}&days=${days}${date ? `&date=${date}` : ''}`);
  if (res.status === 503) throw new FirmsKeyMissing();
  if (!res.ok) throw new Error(`FIRMS proxy HTTP ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { hotspots: j.csv.flatMap((c: string) => parseFirmsCsv(c)), sources: j.sources, fetchedAt: new Date().toISOString() };
}

export interface Cluster {
  lat: number;
  lon: number;
  count: number;
  frpSum: number;
  latest: string;
}

/** Group detections on a ~6 km grid and rank by count and FRP (where is the fire most active?). */
export function clusterHotspots(hs: RawHotspot[], cellDeg = 0.06): Cluster[] {
  const m = new Map<string, RawHotspot[]>();
  for (const h of hs) {
    const k = `${Math.floor(h.lat / cellDeg)}:${Math.floor(h.lon / cellDeg)}`;
    (m.get(k) ?? m.set(k, []).get(k)!).push(h);
  }
  return [...m.values()]
    .map((g) => ({
      lat: g.reduce((a, h) => a + h.lat, 0) / g.length,
      lon: g.reduce((a, h) => a + h.lon, 0) / g.length,
      count: g.length,
      frpSum: g.reduce((a, h) => a + (isFinite(h.frp) ? h.frp : 0), 0),
      latest: g.map((h) => h.acquired).sort().at(-1) ?? '',
    }))
    .sort((a, b) => b.count + b.frpSum / 50 - (a.count + a.frpSum / 50));
}

export const KALIMANTAN_BBOX: [number, number, number, number] = [108.5, -4.5, 119.5, 4.5];
export const SUMATRA_BBOX: [number, number, number, number] = [95.0, -6.0, 106.5, 6.0];
