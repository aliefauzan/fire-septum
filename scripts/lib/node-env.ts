// DataEnv for Node: builds the same live and hindcast scenarios as the browser, from scripts and
// scheduled jobs (daily register, batch hindcasts).
//
//   import { nodeEnv } from './lib/node-env.ts';
//   const env = nodeEnv();
//   const { scenario } = await buildLiveScenario({ lat, lon }, env);
//
// What it does differently from the browser (src/data/env.ts):
//   tiles     PNGs decoded in pure JS (pngjs) and cached on disk under .cache/tiles/<host>/<sha1>.png.
//             Map tiles never change for a given URL, so the cache is never invalidated; delete the
//             folder to refetch.
//   public/   read from disk (public/data/osm-barriers/…), no web server needed.
//   weather   Open-Meteo called directly. Archive (historical-forecast-api) answers are cached under
//             .cache/http/; the live forecast never is.
//   FIRMS     the NASA FIRMS area API called directly, with FIRMS_MAP_KEY from the environment or
//             the repo's .env / .env.local. The key is never logged: error messages have it removed.
//             Requests for days that ended more than two days ago are cached under .cache/firms/.
//   Overpass  public mirrors called directly with a User-Agent, cached under .cache/osm/ with the
//             same file names as the dev server's /api/osm, so the two share hits.
//
// Everything is plain fetch + node:fs, so it runs on Node ≥ 20 (GitHub Actions included).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import type { DataEnv, DecodedTile } from '../../src/data/env.ts';
import { FIRMS_SOURCES, FirmsKeyMissing, parseFirmsCsv } from '../../src/data/firms.ts';
import { overpassFuelQuery } from '../../src/data/osm.ts';

export interface NodeEnvOptions {
  /** Repository root (default: the current directory). public/, .env and .cache/ are found from here. */
  root?: string;
  /** Cache folder (default <root>/.cache). Tiles go in <cacheDir>/tiles. */
  cacheDir?: string;
  /** FIRMS map key; default FIRMS_MAP_KEY from the environment, then .env.local, then .env. */
  firmsKey?: string;
  /** Use only cached tiles, archive weather, FIRMS and Overpass answers; never touch the network. */
  offline?: boolean;
  /** Per-request timeout (default 30 s) and retries on network errors, 429 and 5xx (default 2). */
  timeoutMs?: number;
  retries?: number;
  /** Progress messages (default: silent). */
  log?: (msg: string) => void;
}

const UA = 'FireSeptum/0.3 (IEEE ClimateChain hackathon prototype; Node scenario builder)';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** KEY=value lines of a dotenv file (quotes stripped, comments ignored). */
export function readDotenv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** FIRMS_MAP_KEY from the environment, .env.local or .env (in that order); undefined when unset. */
export function firmsKeyFrom(root: string): string | undefined {
  return process.env.FIRMS_MAP_KEY || readDotenv(join(root, '.env.local')).FIRMS_MAP_KEY || readDotenv(join(root, '.env')).FIRMS_MAP_KEY || undefined;
}

/** Decode a PNG to RGBA bytes (pngjs expands palette, grey and 16-bit images to 8-bit RGBA and applies no gamma). */
export function decodePng(buf: Uint8Array): DecodedTile {
  const png = PNG.sync.read(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
  return { data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength), width: png.width, height: png.height };
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function write(file: string, data: string | Uint8Array) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  } catch { /* the cache is best effort */ }
}

/** Where fetchTile caches a URL. */
export function tileCachePath(cacheDir: string, url: string): string {
  return join(cacheDir, 'tiles', new URL(url).host, `${sha1(url)}.png`);
}

export function nodeEnv(o: NodeEnvOptions = {}): DataEnv {
  // Node's fetch gives each address family only 250 ms to connect before trying the next one. The
  // FIRMS server is often slower than that from Asia, and with no IPv6 route every request then
  // fails with ETIMEDOUT although curl connects fine. Allow 3 s per attempt.
  setDefaultAutoSelectFamilyAttemptTimeout(3000);
  const root = o.root ?? process.cwd();
  const cacheDir = o.cacheDir ?? join(root, '.cache');
  const timeoutMs = o.timeoutMs ?? 30_000, retries = o.retries ?? 2;
  const log = o.log ?? (() => {});
  const key = o.firmsKey ?? firmsKeyFrom(root);
  const hide = (s: string) => (key ? s.split(key).join('<FIRMS_MAP_KEY>') : s);

  /** fetch with timeout and retries on network errors, 429 and 5xx. Other HTTP errors return as-is. */
  async function get(url: string, init: RequestInit = {}): Promise<Response> {
    if (o.offline) throw new Error(`offline: ${hide(url)} is not cached`);
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await sleep(1000 * 2 ** attempt);
      try {
        const r = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
        if (r.status !== 429 && r.status < 500) return r;
        last = new Error(`HTTP ${r.status}`);
      } catch (e) {
        last = e;
      }
    }
    throw new Error(hide(`${new URL(url).host}: ${last instanceof Error ? last.message : String(last)}`));
  }

  return {
    name: o.offline ? 'node (offline)' : 'node',

    async fetchTile(url) {
      const file = tileCachePath(cacheDir, url);
      if (existsSync(file)) return decodePng(readFileSync(file));
      const r = await get(url);
      if (!r.ok) throw new Error(`tile HTTP ${r.status} from ${new URL(url).host}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      const tile = decodePng(buf); // decode before caching, so a broken body is never stored
      write(file, buf);
      return tile;
    },

    async fetchJson(path) {
      const file = join(root, 'public', path);
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    },

    async getJson(url) {
      // Archived weather does not change; the live forecast does.
      const cacheable = new URL(url).host.startsWith('historical-forecast-api.');
      const file = join(cacheDir, 'http', `${sha1(url)}.json`);
      if (cacheable && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
      const r = await get(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
      const text = await r.text();
      const j = JSON.parse(text);
      if (cacheable) write(file, text);
      return j;
    },

    async firms(bbox, days, date) {
      const area = bbox.map((v) => v.toFixed(4)).join(',');
      const file = join(cacheDir, 'firms', `${area}_${days}_${date ?? 'latest'}.json`);
      // Cache only windows that ended more than two days ago: NRT files are complete by then.
      const endMs = date ? Date.parse(date) + days * 864e5 : Infinity;
      const cacheable = endMs < Date.now() - 2 * 864e5;
      if (cacheable && existsSync(file)) {
        const c = JSON.parse(readFileSync(file, 'utf8')) as { sources: string[]; csv: string[] };
        return { hotspots: c.csv.flatMap((t) => parseFirmsCsv(t)), sources: c.sources, fetchedAt: new Date().toISOString() };
      }
      if (!key) throw new FirmsKeyMissing();
      const csv = await Promise.all(FIRMS_SOURCES.map(async (s) => {
        const r = await get(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${s}/${area}/${days}${date ? `/${date}` : ''}`);
        const t = await r.text();
        if (r.ok && t.startsWith('latitude')) return t;
        // FIRMS answers a bad key or a bad request with a short text message and HTTP 200 or 400.
        throw new Error(hide(`FIRMS ${s}: HTTP ${r.status} ${t.slice(0, 120).replace(/\s+/g, ' ')}`));
      }));
      if (cacheable) write(file, JSON.stringify({ sources: FIRMS_SOURCES, csv }));
      log(`FIRMS ${area} ${days} d${date ? ` from ${date}` : ''}: ${csv.reduce((n, t) => n + t.trim().split('\n').length - 1, 0)} detections`);
      return { hotspots: csv.flatMap((t) => parseFirmsCsv(t)), sources: FIRMS_SOURCES, fetchedAt: new Date().toISOString() };
    },

    async overpass(bb) {
      // Same file name as server/firmsProxy.ts diskKey(), so dev-server and Node hits are shared.
      const file = join(cacheDir, 'osm', `${bb.replace(/[^0-9.,-]/g, '')}.json`);
      if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
      if (o.offline) throw new Error('offline: Overpass answer not cached');
      for (const url of OVERPASS) {
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ data: overpassFuelQuery(bb) }),
            signal: AbortSignal.timeout(Math.min(timeoutMs, 20_000)),
          });
          const t = await r.text();
          if (r.ok && t.trimStart().startsWith('{')) { write(file, t); return JSON.parse(t); }
        } catch { /* next mirror */ }
      }
      throw new Error('all Overpass mirrors failed');
    },
  };
}
