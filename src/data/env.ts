// Where the live-data builders get their bytes from. The scenario builders (live.ts, hindcast.ts,
// terrain/peat/land-cover samplers, Open-Meteo, FIRMS, the OSM snapshot) take a DataEnv so the
// same code builds a scenario in the browser and in Node:
//
//   browserEnv  (this file)          — fetch + createImageBitmap/OffscreenCanvas, /public over HTTP,
//                                      FIRMS and Overpass through the dev server's /api proxies.
//   nodeEnv     (scripts/lib/node-env.ts) — pure-JS PNG decoding with an on-disk tile cache,
//                                      public/ read from disk, FIRMS called directly with
//                                      FIRMS_MAP_KEY from the environment or .env.
//
// Nothing in this file may import Node modules: it is bundled into the app.
import type { JsonFetcher } from './barriers';
import { fetchHotspots, type FirmsResult } from './firms';

/** A decoded map tile: RGBA bytes, row-major, 4 per pixel. ImageData satisfies it. */
export interface DecodedTile {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface DataEnv {
  /** Short label for logs. */
  name: string;
  /** Fetch and decode one PNG map tile. Rejects on HTTP errors. */
  fetchTile(url: string): Promise<DecodedTile>;
  /** A JSON file shipped under public/ (path without a leading slash); null when it is missing. */
  fetchJson: JsonFetcher;
  /** GET a JSON web API (Open-Meteo). Rejects on HTTP errors. */
  getJson(url: string): Promise<unknown>;
  /** NASA FIRMS VIIRS detections in bbox [w, s, e, n] for `days` days (from `date`, YYYY-MM-DD, if given). Rejects with FirmsKeyMissing when no key is configured. */
  firms(bbox: [number, number, number, number], days: number, date?: string): Promise<FirmsResult>;
  /** Raw Overpass JSON for the fixed fuel query over bbox "s,w,n,e" (osm.ts). Rejects when unavailable. */
  overpass(bbox: string): Promise<unknown>;
}

/** Fetch and decode one tile in the browser. fetch + createImageBitmap keeps a timeout and works in background tabs. */
export async function loadTileImage(url: string, timeoutMs = 15_000): Promise<ImageData> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`tile HTTP ${res.status}`);
  const img = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(img.width, img.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

export const browserEnv: DataEnv = {
  name: 'browser',
  fetchTile: (url) => loadTileImage(url),
  fetchJson: async (path) => {
    try {
      const r = await fetch(`/${path}`);
      // The dev server answers unknown paths with index.html, so a non-JSON body means "missing".
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
      return await r.json();
    } catch {
      return null;
    }
  },
  getJson: async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
    return r.json();
  },
  firms: (bbox, days, date) => fetchHotspots(bbox, days, date),
  overpass: async (bbox) => {
    // Proxied through the dev server (server/firmsProxy.ts) so Overpass gets a User-Agent.
    // Overpass is often overloaded: give up after 15 s rather than blocking the live scenario.
    const r = await fetch(`/api/osm?bbox=${bbox}`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Overpass proxy HTTP ${r.status}`);
    return r.json();
  },
};
