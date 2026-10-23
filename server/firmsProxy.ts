// Vite dev/preview middleware: GET /api/firms?bbox=w,s,e,n&days=1..5[&date=YYYY-MM-DD]
// Forwards to the NASA FIRMS area API with the server-side MAP_KEY.
// Inputs are strictly validated so the endpoint cannot be used as an open proxy.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const SOURCES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'];
const cache = new Map<string, { at: number; body: string }>();
const TTL_MS = 10 * 60 * 1000; // FIRMS NRT updates every few hours; don't hammer it

export function firmsHandler(getKey: () => string | undefined) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/firms')) return next();
    const u = new URL(req.url, 'http://local');
    const bbox = (u.searchParams.get('bbox') ?? '').split(',').map(Number);
    const days = Number(u.searchParams.get('days') ?? '1');
    // Optional start date for past days (hindcasts): FIRMS returns [date, date + days − 1].
    const date = u.searchParams.get('date') ?? '';
    const valid =
      (date === '' || (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)))) &&
      bbox.length === 4 && bbox.every(Number.isFinite) &&
      bbox[0] >= -180 && bbox[2] <= 180 && bbox[1] >= -90 && bbox[3] <= 90 &&
      bbox[0] < bbox[2] && bbox[1] < bbox[3] && Number.isInteger(days) && days >= 1 && days <= 5;
    if (!valid) { res.statusCode = 400; res.end('bad bbox/days'); return; }
    const key = getKey();
    if (!key) { res.statusCode = 503; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: 'FIRMS_MAP_KEY not set' })); return; }
    const area = bbox.map((v) => v.toFixed(4)).join(',');
    const ck = `${area}|${days}|${date}`;
    const hit = cache.get(ck);
    res.setHeader('content-type', 'application/json');
    if (hit && Date.now() - hit.at < TTL_MS) { res.end(hit.body); return; }
    try {
      const csv = await Promise.all(
        SOURCES.map(async (s) => {
          const r = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${s}/${area}/${days}${date ? `/${date}` : ''}`);
          const t = await r.text();
          return r.ok && t.startsWith('latitude') ? t : '';
        }),
      );
      const body = JSON.stringify({ sources: SOURCES, csv });
      cache.set(ck, { at: Date.now(), body });
      res.end(body);
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: String(e) }));
    }
  };
}

// GET /api/osm?bbox=s,w,n,e — fixed Overpass query (water, roads, land use) for a
// small box. Overpass asks clients to identify themselves, which browsers cannot
// do, so we call it server-side with a User-Agent and try a few public mirrors.
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const OSM_DIR = join(process.cwd(), '.cache', 'osm');
const osmCache = new Map<string, string>();
const diskKey = (bb: string) => join(OSM_DIR, `${bb.replace(/[^0-9.,-]/g, '')}.json`);

/** Run an Overpass query with memory + disk cache, trying each public mirror once. */
async function overpass(q: string, key: string, timeoutMs: number, deadlineMs = Infinity): Promise<string | null> {
  const until = Date.now() + deadlineMs;
  const hit = osmCache.get(key) ?? (existsSync(diskKey(key)) ? readFileSync(diskKey(key), 'utf8') : undefined);
  if (hit) { osmCache.set(key, hit); return hit; }
  for (const url of OVERPASS) {
    const left = until - Date.now();
    if (left < 2000) break;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'SekatApi/0.1 (IEEE ClimateChain hackathon prototype)', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(Math.min(timeoutMs, left)),
      });
      const t = await r.text();
      if (r.ok && t.trimStart().startsWith('{')) {
        osmCache.set(key, t);
        try { mkdirSync(OSM_DIR, { recursive: true }); writeFileSync(diskKey(key), t); } catch { /* cache is best effort */ }
        return t;
      }
    } catch { /* try next mirror */ }
  }
  return null;
}

const SNAPSHOT = 'data/osm-facilities.json';
type SnapEl = { id: string; lat: number; lon: number; tags: Record<string, string> };

/** Bases within radiusKm from data/osm-facilities.json, in Overpass response shape. */
function snapshotNear(lat: number, lon: number, radiusKm: number) {
  if (!existsSync(SNAPSHOT)) return null;
  const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as { fetchedAt: string; elements: SnapEl[] };
  const kmPerDeg = 111.32;
  const elements = snap.elements
    .filter((e) => Math.hypot((e.lat - lat) * kmPerDeg, (e.lon - lon) * kmPerDeg * Math.cos((lat * Math.PI) / 180)) <= radiusKm)
    .map((e) => ({ type: e.id.split('/')[0], id: Number(e.id.split('/')[1]), lat: e.lat, lon: e.lon, tags: e.tags }));
  return { origin: 'snapshot', snapshotAt: snap.fetchedAt, elements };
}

export function osmHandler() {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const u = new URL(req.url ?? '/', 'http://local');
    res.setHeader('content-type', 'application/json');
    if (u.pathname === '/api/osm') {
      const b = (u.searchParams.get('bbox') ?? '').split(',').map(Number);
      const ok = b.length === 4 && b.every(Number.isFinite) && b[0] < b[2] && b[1] < b[3] && b[2] - b[0] < 0.2 && b[3] - b[1] < 0.2;
      if (!ok) { res.statusCode = 400; res.end('bad bbox (max 0.2°)'); return; }
      const bb = b.map((v) => v.toFixed(5)).join(',');
      const q = `[out:json][timeout:25];(
        way["natural"~"^(water|wetland|wood|scrub|grassland)$"](${bb});
        relation["natural"="water"](${bb});
        way["waterway"~"^(river|canal|stream|ditch|drain)$"](${bb});
        way["landuse"~"^(residential|industrial|commercial|retail|farmland|meadow|paddy|plantation|orchard|forest|grass|reservoir|basin)$"](${bb});
        way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bb});
      );out geom;`;
      const t = await overpass(q, bb, 12_000);
      if (t) res.end(t); else { res.statusCode = 502; res.end(JSON.stringify({ error: 'all Overpass mirrors failed' })); }
      return;
    }
    if (u.pathname === '/api/osm-resources') {
      // Suppression logistics around a fire: bases within 80 km, water and roads within 15 km.
      const lat = Number(u.searchParams.get('lat')), lon = Number(u.searchParams.get('lon'));
      if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) { res.statusCode = 400; res.end('bad lat/lon'); return; }
      const c = `${lat.toFixed(3)},${lon.toFixed(3)}`;
      const q = `[out:json][timeout:60];(
        nwr["amenity"="fire_station"](around:80000,${c});
        nwr["aeroway"~"^(helipad|heliport|aerodrome|airstrip)$"](around:80000,${c});
        nwr["office"]["name"~"[Mm]anggala|[Dd]aops|BPBD|BNPB"](around:80000,${c});
      )->.bases;
      (
        way["waterway"~"^(river|canal)$"](around:15000,${c});
        way["natural"="water"](around:15000,${c});
        way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|track|service)$"](around:15000,${c});
      )->.near;
      .bases out tags center;
      .near out geom;`;
      const t = await overpass(q, `res-${c}`, 15_000, 25_000);
      if (t) { res.end(t.replace(/^\s*\{/, `{"origin":"live",`)); return; }
      // Overpass overloaded: fall back to the dated OSM snapshot of bases (no water/roads).
      const snap = snapshotNear(lat, lon, 80);
      if (snap) { res.end(JSON.stringify(snap)); return; }
      res.statusCode = 502; res.end(JSON.stringify({ error: 'all Overpass mirrors failed and no snapshot (run node scripts/snapshot-facilities.mjs)' }));
      return;
    }
    next();
  };
}

export function firmsProxy(getKey: () => string | undefined): Plugin {
  return {
    name: 'data-proxy',
    configureServer(server) { server.middlewares.use(firmsHandler(getKey)); server.middlewares.use(osmHandler()); },
    configurePreviewServer(server) { server.middlewares.use(firmsHandler(getKey)); server.middlewares.use(osmHandler()); },
  };
}
