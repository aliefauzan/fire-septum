// Indonesian commander data sources, server side.
//
//   GET /api/bmkg?lat=&lon=                 BMKG public village forecast for the nearest kecamatan
//                                           (api.bmkg.go.id/publik/prakiraan-cuaca, keyless, credit BMKG,
//                                           max 60 requests/min/IP: we cache 1 h and cap our own rate)
//   GET /api/bmkg-fdrs?region=&var=&day=    BMKG SPARTAN fire danger (FWI system) map PNG, strict allow-list, cache 3 h
//   GET /api/sipongi/status                 whether the SiPongi adapter is enabled
//   GET /api/sipongi/hotspots               SiPongi (Kemenhut) hotspots with village/district/area labels
//   GET /api/sipongi/tmat                   SiPongi peat water-table (TMAT) stations, latest level in cm
//
// SiPongi's disclaimer forbids access without written permission from the Ministry of Forestry
// (Kemenhut). The adapter is therefore off: it answers 403 unless SIPONGI_PERMISSION=granted is
// set by an operator who holds that permission.
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const UA = 'FireSeptum/0.2 (IEEE ClimateChain hackathon prototype)';

// ---------- BMKG village forecast ----------

interface Lookup { rows: [string, number, number][] }
let lookup: Lookup | null = null;
function loadLookup(): Lookup {
  if (lookup) return lookup;
  // Vite and local runs serve public/ from the repo; the Vercel function gets it via includeFiles.
  for (const p of [join(process.cwd(), 'public', 'data', 'bmkg-adm4.json'), join(process.cwd(), 'dist', 'data', 'bmkg-adm4.json')]) {
    if (existsSync(p)) return (lookup = JSON.parse(readFileSync(p, 'utf8')) as Lookup);
  }
  throw new Error('public/data/bmkg-adm4.json not found (node scripts/bmkg-adm4.mjs)');
}

const kmBetween = (lat1: number, lon1: number, lat2: number, lon2: number) =>
  Math.hypot((lat2 - lat1) * 110.574, (lon2 - lon1) * 111.32 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180));

/** Nearest kecamatan centroid, or null beyond 75 km (outside the provinces covered). */
export function nearestAdm4(lat: number, lon: number, rows: Lookup['rows']): { adm4: string; km: number } | null {
  let best: { adm4: string; km: number } | null = null;
  for (const [adm4, la, lo] of rows) {
    if (Math.abs(la - lat) > 1 || Math.abs(lo - lon) > 1) continue;
    const km = kmBetween(lat, lon, la, lo);
    if (!best || km < best.km) best = { adm4, km };
  }
  return best && best.km <= 75 ? best : null;
}

// Our own cap on calls to BMKG, well under its 60 per minute per IP.
const calls: number[] = [];
function allowCall(limit = 40): boolean {
  const now = Date.now();
  while (calls.length && now - calls[0] > 60_000) calls.shift();
  if (calls.length >= limit) return false;
  calls.push(now);
  return true;
}

const forecastCache = new Map<string, { at: number; body: string }>();
const FORECAST_TTL = 60 * 60 * 1000;

interface BmkgStep { datetime: string; local_datetime?: string; t: number; tcc?: number; tp?: number; weather_desc_en?: string; wd_deg?: number; ws?: number; hu?: number }

async function bmkgForecast(adm4: string): Promise<string> {
  const hit = forecastCache.get(adm4);
  if (hit && Date.now() - hit.at < FORECAST_TTL) return hit.body;
  if (!allowCall()) throw Object.assign(new Error('BMKG rate limit reached here, try again in a minute'), { status: 429 });
  const r = await fetch(`https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${adm4}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw Object.assign(new Error(`BMKG HTTP ${r.status}`), { status: 502 });
  const j = (await r.json()) as { lokasi: Record<string, unknown>; data: { cuaca: BmkgStep[][] }[] };
  const steps = (j.data?.[0]?.cuaca ?? []).flat();
  const l = j.lokasi ?? {};
  const body = JSON.stringify({
    adm4,
    lokasi: { desa: l.desa, kecamatan: l.kecamatan, kotkab: l.kotkab, provinsi: l.provinsi, lat: l.lat, lon: l.lon, timezone: l.timezone },
    analysisDate: (steps[0] as BmkgStep & { analysis_date?: string })?.analysis_date ?? null,
    // BMKG documents ws in km/h, wd_deg as the direction the wind comes from, tp in mm, hu in %.
    hours: steps.map((s) => ({
      utc: s.datetime, local: s.local_datetime ?? null, tempC: s.t, rh: s.hu ?? null, windKmh: s.ws ?? null, windFromDeg: s.wd_deg ?? null,
      precipMm: s.tp ?? null, cloudPct: s.tcc ?? null, weather: s.weather_desc_en ?? null,
    })),
    fetchedAt: new Date().toISOString(),
    attribution: 'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika), api.bmkg.go.id',
  });
  forecastCache.set(adm4, { at: Date.now(), body });
  return body;
}

// ---------- BMKG fire danger maps ----------

export const FDRS_REGIONS = ['36_indonesia', '37_sumatera', '38_kalimantan', '20_kalbar', '21_kalsel', '22_kalteng', '04_riau', '06_jambi', '08_sumsel'] as const;
export const FDRS_VARS = ['ffmc', 'dmc', 'dc', 'bui', 'isi', 'fwi'] as const;
const FDRS_DAYS = ['obs', '00', '01', '02', '03', '04', '05', '06', '07'];
const fdrsCache = new Map<string, { at: number; png: Buffer }>();
const FDRS_TTL = 3 * 60 * 60 * 1000;

// ---------- SiPongi (off unless permitted) ----------

const SIPONGI = 'https://opsroom.sipongidata.my.id/api';
const sipongiCache = new Map<string, { at: number; body: string }>();
const SIPONGI_TTL = 10 * 60 * 1000;
const SIPONGI_DENIED = 'SiPongi (Kementerian Kehutanan) does not allow access to its data without written permission from the Ministry. This adapter stays off until an operator who holds that permission sets SIPONGI_PERMISSION=granted on the server.';

type Feature = { geometry?: { type?: string; coordinates?: number[] }; properties?: Record<string, unknown> };
const pick = (p: Record<string, unknown>, ...keys: string[]) => { for (const k of keys) { const v = p[k] ?? p[k.toLowerCase()] ?? p[k.toUpperCase()]; if (v !== undefined && v !== null && v !== '') return v; } return null; };
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/** SiPongi hotspot GeoJSON to plain points with their admin labels. */
export function normalizeHotspots(j: { features?: Feature[] }) {
  return (j.features ?? []).filter((f) => f.geometry?.type === 'Point' && f.geometry.coordinates).map((f) => {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry!.coordinates!;
    return {
      lat, lon,
      desa: pick(p, 'desa'), kecamatan: pick(p, 'kecamatan'), kabkota: pick(p, 'kabkota', 'kabupaten'), provinsi: pick(p, 'provinsi'),
      kawasan: pick(p, 'kawasan'), satellite: pick(p, 'satelit', 'satellite', 'sumber'), confidence: pick(p, 'confidence', 'kepercayaan'),
      time: pick(p, 'date_hotspot', 'tanggal', 'waktu', 'acq_date'),
    };
  });
}

/** SiPongi TMAT stations to plain points; accepts GeoJSON or an array of rows. */
export function normalizeTmat(j: unknown) {
  const rows: Record<string, unknown>[] = Array.isArray(j)
    ? (j as Record<string, unknown>[])
    : Array.isArray((j as { features?: unknown[] })?.features)
      ? ((j as { features: Feature[] }).features).map((f) => ({ ...(f.properties ?? {}), lon: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1] }))
      : Array.isArray((j as { data?: unknown[] })?.data) ? ((j as { data: Record<string, unknown>[] }).data) : [];
  return rows.map((r) => ({
    id: String(pick(r, 'id', 'kode', 'station_id') ?? ''),
    name: pick(r, 'nama', 'name', 'station', 'nama_stasiun'),
    company: pick(r, 'konsesi', 'perusahaan', 'company'),
    lat: num(pick(r, 'lat', 'latitude', 'Latitude')), lon: num(pick(r, 'lon', 'lng', 'longitude', 'Longitude')),
    waterLevelCm: num(pick(r, 'WaterLevel', 'water_level', 'tmat')),
    time: pick(r, 'tanggal', 'waktu', 'datetime', 'updated_at'),
  })).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

async function sipongi(path: string, query: string, normalize: (j: unknown) => unknown): Promise<string> {
  const k = `${path}?${query}`;
  const hit = sipongiCache.get(k);
  if (hit && Date.now() - hit.at < SIPONGI_TTL) return hit.body;
  const r = await fetch(`${SIPONGI}/${k}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw Object.assign(new Error(`SiPongi HTTP ${r.status}`), { status: 502 });
  const body = JSON.stringify({ items: normalize(await r.json()), fetchedAt: new Date().toISOString(), attribution: 'SiPongi, Kementerian Kehutanan Republik Indonesia (used with permission)' });
  sipongiCache.set(k, { at: Date.now(), body });
  return body;
}

// ---------- Handler ----------

export function bmkgHandler(getSipongi: () => string | undefined) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const u = new URL(req.url ?? '/', 'http://local');
    const path = u.pathname;
    if (path !== '/api/bmkg' && path !== '/api/bmkg-fdrs' && !path.startsWith('/api/sipongi/')) return next();
    const json = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (req.method !== 'GET') return json(405, { error: 'method not allowed' });
    try {
      if (path === '/api/bmkg') {
        const lat = Number(u.searchParams.get('lat')), lon = Number(u.searchParams.get('lon'));
        if (!(lat >= -11 && lat <= 6.5 && lon >= 94 && lon <= 141.5)) return json(400, { error: 'lat/lon must be in Indonesia' });
        const near = nearestAdm4(lat, lon, loadLookup().rows);
        if (!near) return json(404, { error: 'No BMKG forecast point here: the lookup covers the peat provinces of Sumatra and Kalimantan.' });
        const body = JSON.parse(await bmkgForecast(near.adm4));
        const ll = body.lokasi;
        body.distanceKm = Number.isFinite(ll?.lat) ? Math.round(kmBetween(lat, lon, ll.lat, ll.lon) * 10) / 10 : null;
        return json(200, body);
      }
      if (path === '/api/bmkg-fdrs') {
        const region = u.searchParams.get('region') ?? '', v = u.searchParams.get('var') ?? '', day = u.searchParams.get('day') ?? '00';
        if (!(FDRS_REGIONS as readonly string[]).includes(region) || !(FDRS_VARS as readonly string[]).includes(v) || !FDRS_DAYS.includes(day)) return json(400, { error: 'unknown region, var or day' });
        const name = `${region}_${v}_${day}`;
        let hit = fdrsCache.get(name);
        if (!hit || Date.now() - hit.at > FDRS_TTL) {
          const r = await fetch(`https://dataweb.bmkg.go.id/cuaca/spartan/${name}.png`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
          const type = r.headers.get('content-type') ?? '';
          if (!r.ok || !type.startsWith('image/png')) return json(502, { error: `BMKG fire danger map HTTP ${r.status}` });
          hit = { at: Date.now(), png: Buffer.from(await r.arrayBuffer()) };
          fdrsCache.set(name, hit);
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'image/png');
        res.setHeader('cache-control', 'public, max-age=3600');
        res.setHeader('x-source', `BMKG SPARTAN ${name}.png, fetched ${new Date(hit.at).toISOString()}`);
        res.end(hit.png);
        return;
      }
      // SiPongi
      const enabled = getSipongi() === 'granted';
      if (path === '/api/sipongi/status') return json(200, { enabled, note: enabled ? 'Enabled by the operator (SIPONGI_PERMISSION=granted).' : SIPONGI_DENIED });
      if (!enabled) return json(403, { error: SIPONGI_DENIED });
      if (path === '/api/sipongi/hotspots') {
        // Fixed query: all Indonesia, last 24 h, Suomi NPP, high confidence. No user input is forwarded.
        return json(200, await sipongi('opsroom/indoHotspot', 'wilayah=IN&filterperiode=false&late=24&satelit[]=NASA-SNPP&confidence[]=high', (j) => normalizeHotspots(j as { features?: Feature[] })));
      }
      if (path === '/api/sipongi/tmat') return json(200, await sipongi('tmat/konsesi', '', normalizeTmat));
      return json(404, { error: 'unknown endpoint' });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 502;
      return json(status, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

export function bmkgProxy(getSipongi: () => string | undefined): Plugin {
  const h = bmkgHandler(getSipongi);
  return {
    name: 'bmkg-proxy',
    configureServer(server) { server.middlewares.use(h); },
    configurePreviewServer(server) { server.middlewares.use(h); },
  };
}
