// Client side of the Indonesian commander sources (server/bmkg.ts).

export interface BmkgHour {
  utc: string; local: string | null; tempC: number; rh: number | null; windKmh: number | null; windFromDeg: number | null;
  precipMm: number | null; cloudPct: number | null; weather: string | null;
}
export interface BmkgForecast {
  adm4: string;
  lokasi: { desa: string; kecamatan: string; kotkab: string; provinsi: string; lat: number; lon: number; timezone?: string };
  distanceKm: number | null;
  analysisDate: string | null;
  hours: BmkgHour[];
  fetchedAt: string;
  attribution: string;
}

export async function fetchBmkg(lat: number, lon: number, signal?: AbortSignal): Promise<BmkgForecast> {
  const r = await fetch(`/api/bmkg?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, { signal });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as BmkgForecast;
}

export type FdrsVar = 'ffmc' | 'dmc' | 'dc' | 'bui' | 'isi' | 'fwi';
export type FdrsRegion = '36_indonesia' | '37_sumatera' | '38_kalimantan' | '20_kalbar' | '21_kalsel' | '22_kalteng' | '04_riau' | '06_jambi' | '08_sumsel';
export const fdrsUrl = (region: FdrsRegion, v: FdrsVar, day: number | 'obs') =>
  `/api/bmkg-fdrs?region=${region}&var=${v}&day=${day === 'obs' ? 'obs' : String(day).padStart(2, '0')}`;

/** The island map for a point: Sumatra west of ~106.5° E, Kalimantan from 108° E, else all Indonesia. */
export function islandFor(lat: number, lon: number): FdrsRegion {
  if (lon < 106.8 && lat > -6.5) return '37_sumatera';
  if (lon >= 108 && lon <= 119.5 && lat > -4.6 && lat < 7.5) return '38_kalimantan';
  return '36_indonesia';
}

// ---------- SiPongi (only when the operator enabled it) ----------

export interface SipongiHotspot { lat: number; lon: number; desa: string | null; kecamatan: string | null; kabkota: string | null; provinsi: string | null; kawasan: string | null }
export interface TmatStation { id: string; name: string | null; company: string | null; lat: number; lon: number; waterLevelCm: number | null; time: string | null }

let statusP: Promise<boolean> | null = null;
/** True only when the server has SIPONGI_PERMISSION=granted. */
export function sipongiEnabled(): Promise<boolean> {
  statusP ??= fetch('/api/sipongi/status').then((r) => r.json()).then((j) => !!j.enabled).catch(() => false);
  return statusP;
}

const getItems = async <T,>(path: string): Promise<T[]> => {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return ((await r.json()).items ?? []) as T[];
};
let hotP: Promise<SipongiHotspot[]> | null = null;
let tmatP: Promise<TmatStation[]> | null = null;
export const sipongiHotspots = () => { hotP ??= getItems<SipongiHotspot>('/api/sipongi/hotspots'); hotP.catch(() => { hotP = null; }); return hotP; };
export const sipongiTmat = () => { tmatP ??= getItems<TmatStation>('/api/sipongi/tmat'); tmatP.catch(() => { tmatP = null; }); return tmatP; };

/** SiPongi's admin label for the nearest hotspot within `maxKm` of a point, e.g. "Desa X, Kec. Y · HPK". */
export function sipongiLabel(lat: number, lon: number, hs: SipongiHotspot[], maxKm = 3): string | null {
  let best: SipongiHotspot | null = null, bestKm = Infinity;
  for (const h of hs) {
    const km = Math.hypot((h.lat - lat) * 110.6, (h.lon - lon) * 111.3 * Math.cos((lat * Math.PI) / 180));
    if (km < bestKm) { bestKm = km; best = h; }
  }
  if (!best || bestKm > maxKm) return null;
  const place = [best.desa && `Desa ${best.desa}`, best.kecamatan && `Kec. ${best.kecamatan}`, best.kabkota].filter(Boolean).join(', ');
  return [place, best.kawasan].filter(Boolean).join(' · ') || null;
}
