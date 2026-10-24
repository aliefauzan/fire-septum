// Fire barriers and peat drainage from a dated OpenStreetMap snapshot (Geofabrik extracts),
// tiled at 0.25° under public/data/osm-barriers/ by ml/osm/snapshot_barriers.py. Replaces the
// per-box Overpass query in osm.ts, which was usually overloaded, so every scenario gets its
// rivers, canals and roads. Pure TypeScript, no DOM: the caller injects the JSON fetcher
// (browser: fetch('/' + path), Node: read from public/).
//
// Canals matter twice on peat: they stop fire (water cells) and they drain the peat around them
// (lower water table, drier fuel). rasterizeBarriers therefore also returns the distance to the
// nearest canal/ditch/drain and the drainage-line density around each cell.
import type { FuelId } from '../sim/types';

export interface BarrierGeo { north: number; south: number; west: number; east: number }
export interface LatLon { lat: number; lon: number }

export interface BarrierFeature {
  /** One of BarrierIndex.kinds: canal, ditch, drain, river, stream, road_major, road_minor, track, water, built. */
  kind: string;
  /** True for closed area rings (water, built), false for lines. */
  closed: boolean;
  pts: LatLon[];
}

export interface BarrierIndex {
  v: 1;
  kind: 'fireseptum.osm-barriers';
  tileDeg: number;
  quant: number;
  generatedAt: string;
  sources: { region: string; url: string; osmTimestamp: string | null }[];
  simplifyM: number;
  kinds: string[];
  tiles: Record<string, { bytes: number; lines: number; areas: number }>;
}

/** One tile file: bbox, lines and closed area rings as [kindIndex, x0, y0, dx1, dy1, ...]. */
export interface BarrierTile { b: [number, number, number, number]; l: number[][]; a: number[][] }

export type JsonFetcher = (path: string) => Promise<unknown | null>;

export const BARRIER_DIR = 'data/osm-barriers';
export const DRAINAGE_KINDS: ReadonlySet<string> = new Set(['canal', 'ditch', 'drain']);
/** drainDistM is capped here: beyond ~5 km a canal no longer lowers the peat water table. */
export const DRAIN_CAP_M = 5000;
/** Radius of the drainage-density window. */
export const DENSITY_RADIUS_M = 1000;

const TILE_DEG = 0.25;
const M_PER_DEG = 111_320;

/** The 0.25° tiles (keyed by south-west corner, e.g. "-3.00_112.25") that a box touches. */
export function barrierTileKeys(geo: BarrierGeo, tileDeg = TILE_DEG): string[] {
  const eps = 1e-9;
  const ix0 = Math.floor(geo.west / tileDeg + eps), ix1 = Math.max(ix0, Math.ceil(geo.east / tileDeg - eps) - 1);
  const iy0 = Math.floor(geo.south / tileDeg + eps), iy1 = Math.max(iy0, Math.ceil(geo.north / tileDeg - eps) - 1);
  const keys: string[] = [];
  for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) keys.push(`${(iy * tileDeg).toFixed(2)}_${(ix * tileDeg).toFixed(2)}`);
  return keys;
}

/** Decode one tile's delta-encoded integer coordinates. */
export function decodeBarrierTile(tile: BarrierTile, kinds: string[], quant = 1e5): BarrierFeature[] {
  const out: BarrierFeature[] = [];
  const dec = (arr: number[], closed: boolean) => {
    if (arr.length < 5) return;
    let x = arr[1], y = arr[2];
    const pts: LatLon[] = [{ lat: y / quant, lon: x / quant }];
    for (let i = 3; i + 1 < arr.length; i += 2) {
      x += arr[i]; y += arr[i + 1];
      pts.push({ lat: y / quant, lon: x / quant });
    }
    out.push({ kind: kinds[arr[0]] ?? 'unknown', closed, pts });
  };
  for (const a of tile.l ?? []) dec(a, false);
  for (const a of tile.a ?? []) dec(a, true);
  return out;
}

// ---- loading -------------------------------------------------------------------------------

const indexCache = new WeakMap<JsonFetcher, Promise<BarrierIndex | null>>();
const tileCache = new WeakMap<JsonFetcher, Map<string, Promise<BarrierTile | null>>>();
const TILE_CACHE_MAX = 64;

function getIndex(fetchJson: JsonFetcher): Promise<BarrierIndex | null> {
  let p = indexCache.get(fetchJson);
  if (!p) {
    p = fetchJson(`${BARRIER_DIR}/index.json`).then((j) => {
      const ix = j as BarrierIndex | null;
      return ix && ix.kind === 'fireseptum.osm-barriers' && Array.isArray(ix.kinds) ? ix : null;
    });
    p.catch(() => indexCache.delete(fetchJson));
    indexCache.set(fetchJson, p);
  }
  return p;
}

function getTile(fetchJson: JsonFetcher, key: string): Promise<BarrierTile | null> {
  let m = tileCache.get(fetchJson);
  if (!m) tileCache.set(fetchJson, (m = new Map()));
  let p = m.get(key);
  if (!p) {
    p = fetchJson(`${BARRIER_DIR}/${key}.json`) as Promise<BarrierTile | null>;
    p.catch(() => m!.delete(key));
    m.set(key, p);
    if (m.size > TILE_CACHE_MAX) m.delete(m.keys().next().value!);
  }
  return p;
}

/** The box grown by `m` metres on every side. */
export function expandGeo(geo: BarrierGeo, m: number): BarrierGeo {
  const dLat = m / M_PER_DEG;
  const dLon = m / (M_PER_DEG * Math.cos((((geo.north + geo.south) / 2) * Math.PI) / 180));
  return { north: geo.north + dLat, south: geo.south - dLat, west: geo.west - dLon, east: geo.east + dLon };
}

/**
 * Barrier and drainage features around `geo`. Loads the tiles under the box grown by `marginM`
 * (default DRAIN_CAP_M, so canals just outside the box still count for drainDistM), clips each
 * tile's features to that tile's exact bbox (tiles overlap by ~200 m; clipping removes the
 * duplicates) and to the grown box. Throws when the snapshot index itself is missing; a tile not
 * listed in the index simply has no mapped features.
 */
export async function loadBarriers(geo: BarrierGeo, fetchJson: JsonFetcher, marginM = DRAIN_CAP_M): Promise<BarrierFeature[]> {
  const index = await getIndex(fetchJson);
  if (!index) throw new Error(`OSM barrier snapshot missing (${BARRIER_DIR}/index.json)`);
  const big = expandGeo(geo, marginM);
  const keys = barrierTileKeys(big, index.tileDeg).filter((k) => index.tiles[k]);
  const tiles = await Promise.all(keys.map((k) => getTile(fetchJson, k)));
  const out: BarrierFeature[] = [];
  for (const tile of tiles) {
    if (!tile) continue;
    const [w, s, e, n] = tile.b;
    const box = { west: Math.max(w, big.west), south: Math.max(s, big.south), east: Math.min(e, big.east), north: Math.min(n, big.north) };
    if (box.west >= box.east || box.south >= box.north) continue;
    for (const f of decodeBarrierTile(tile, index.kinds, index.quant)) {
      if (f.closed) {
        const ring = clipRing(f.pts, box);
        if (ring.length >= 3) out.push({ kind: f.kind, closed: true, pts: ring });
      } else {
        for (const pts of clipLine(f.pts, box)) out.push({ kind: f.kind, closed: false, pts });
      }
    }
  }
  return out;
}

// ---- clipping ------------------------------------------------------------------------------

/** Liang–Barsky clip of one segment; returns the [t0, t1] parameter range inside, or null. */
function clipSeg(a: LatLon, b: LatLon, g: BarrierGeo): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = b.lon - a.lon, dy = b.lat - a.lat;
  const p = [-dx, dx, -dy, dy];
  const q = [a.lon - g.west, g.east - a.lon, a.lat - g.south, g.north - a.lat];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [t0, t1];
}

const lerp = (a: LatLon, b: LatLon, t: number): LatLon => (t === 0 ? a : t === 1 ? b : { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });

/** Clip a polyline to a box; returns the pieces inside. */
export function clipLine(pts: LatLon[], g: BarrierGeo): LatLon[][] {
  const out: LatLon[][] = [];
  let cur: LatLon[] = [];
  for (let i = 1; i < pts.length; i++) {
    const c = clipSeg(pts[i - 1], pts[i], g);
    if (!c) { if (cur.length > 1) out.push(cur); cur = []; continue; }
    const p0 = lerp(pts[i - 1], pts[i], c[0]), p1 = lerp(pts[i - 1], pts[i], c[1]);
    if (cur.length === 0 || c[0] > 0) { if (cur.length > 1) out.push(cur); cur = [p0]; }
    cur.push(p1);
    if (c[1] < 1) { if (cur.length > 1) out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Sutherland–Hodgman clip of a closed ring to a box (fine for point-in-polygon fills). */
export function clipRing(pts: LatLon[], g: BarrierGeo): LatLon[] {
  type Edge = { inside: (p: LatLon) => boolean; cut: (a: LatLon, b: LatLon) => LatLon };
  const at = (a: LatLon, b: LatLon, t: number) => lerp(a, b, t);
  const edges: Edge[] = [
    { inside: (p) => p.lon >= g.west, cut: (a, b) => at(a, b, (g.west - a.lon) / (b.lon - a.lon)) },
    { inside: (p) => p.lon <= g.east, cut: (a, b) => at(a, b, (g.east - a.lon) / (b.lon - a.lon)) },
    { inside: (p) => p.lat >= g.south, cut: (a, b) => at(a, b, (g.south - a.lat) / (b.lat - a.lat)) },
    { inside: (p) => p.lat <= g.north, cut: (a, b) => at(a, b, (g.north - a.lat) / (b.lat - a.lat)) },
  ];
  let ring = pts.length > 1 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lon === pts[pts.length - 1].lon ? pts.slice(0, -1) : pts.slice();
  for (const e of edges) {
    if (ring.length === 0) break;
    const next: LatLon[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length], b = ring[i];
      const ia = e.inside(a), ib = e.inside(b);
      if (ib) { if (!ia) next.push(e.cut(a, b)); next.push(b); }
      else if (ia) next.push(e.cut(a, b));
    }
    ring = next;
  }
  return ring;
}

// ---- rasterisation -------------------------------------------------------------------------

/** Fuel override and priority per kind, matching classify() in osm.ts. */
const KIND_FUEL: Record<string, { fuel: FuelId; priority: number }> = {
  canal: { fuel: 'water', priority: 5 },
  ditch: { fuel: 'water', priority: 5 },
  drain: { fuel: 'water', priority: 5 },
  river: { fuel: 'water', priority: 5 },
  stream: { fuel: 'water', priority: 5 },
  water: { fuel: 'water', priority: 5 },
  road_major: { fuel: 'settlement', priority: 4 },
  // Minor roads and tracks are bare, unvegetated strips: they act as firebreaks just like the
  // main roads, so they also rasterise to 'settlement' (non-burnable) lines.
  road_minor: { fuel: 'settlement', priority: 4 },
  track: { fuel: 'settlement', priority: 4 },
  built: { fuel: 'settlement', priority: 3 },
};

export interface BarrierRaster {
  /** Fuel override per cell (null = no OSM barrier there). */
  fuel: (FuelId | null)[];
  /** Number of features that set at least one cell. */
  features: number;
  /**
   * Metres from each cell centre to the nearest canal/ditch/drain, capped at DRAIN_CAP_M.
   * Measured between cell centres (the canal's own cells are 0), so within about half a cell.
   */
  drainDistM: Float32Array;
  /** Canal/ditch/drain length (km) per km² within DENSITY_RADIUS_M of each cell centre. */
  canalKmPerKm2: Float32Array;
}

function inside(p: LatLon, poly: LatLon[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) c = !c;
  }
  return c;
}

/** Walk a segment in cell space, 4-connected (no diagonal gaps fire could slip through). */
function walk4(ax: number, ay: number, bx: number, by: number, visit: (x: number, y: number) => void) {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1;
  let px = Math.round(ax), py = Math.round(ay);
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(ax + ((bx - ax) * s) / steps), y = Math.round(ay + ((by - ay) * s) / steps);
    if (x !== px && y !== py) visit(x, py);
    visit(x, y);
    px = x; py = y;
  }
}

/**
 * Rasterise barrier features onto a w × h grid over `geo` (cell 0,0 = north-west, y grows south).
 * Fuel uses the same mapping and 4-connected line rasterisation as osm.ts. Drainage metrics use a
 * grid extended by DRAIN_CAP_M on every side so canals outside the box are counted.
 */
export function rasterizeBarriers(geo: BarrierGeo, w: number, h: number, features: BarrierFeature[]): BarrierRaster {
  const n = w * h;
  const fuel: (FuelId | null)[] = new Array(n).fill(null);
  const prio = new Int8Array(n).fill(-1);
  const toCell = (p: LatLon) => ({
    x: ((p.lon - geo.west) / (geo.east - geo.west)) * w - 0.5,
    y: ((geo.north - p.lat) / (geo.north - geo.south)) * h - 0.5,
  });
  let hit = false;
  const set = (x: number, y: number, f: FuelId, pr: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    hit = true;
    const k = y * w + x;
    if (pr >= prio[k]) { prio[k] = pr; fuel[k] = f; }
  };

  let touched = 0;
  const sorted = features.filter((f) => KIND_FUEL[f.kind]).sort((a, b) => KIND_FUEL[a.kind].priority - KIND_FUEL[b.kind].priority);
  for (const f of sorted) {
    const c = KIND_FUEL[f.kind];
    hit = false;
    if (f.closed && f.pts.length >= 3) {
      const cells = f.pts.map(toCell);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of cells) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
      const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(w - 1, Math.ceil(maxX));
      const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const lat = geo.north - ((y + 0.5) / h) * (geo.north - geo.south);
        const lon = geo.west + ((x + 0.5) / w) * (geo.east - geo.west);
        if (inside({ lat, lon }, f.pts)) set(x, y, c.fuel, c.priority);
      }
    } else {
      for (let i = 1; i < f.pts.length; i++) {
        const a = toCell(f.pts[i - 1]), b = toCell(f.pts[i]);
        if ((a.x < -1 && b.x < -1) || (a.y < -1 && b.y < -1) || (a.x > w && b.x > w) || (a.y > h && b.y > h)) continue;
        walk4(a.x, a.y, b.x, b.y, (x, y) => set(x, y, c.fuel, c.priority));
      }
    }
    if (hit) touched++;
  }

  const { drainDistM, canalKmPerKm2 } = drainageMetrics(geo, w, h, features.filter((f) => !f.closed && DRAINAGE_KINDS.has(f.kind)));
  return { fuel, features: touched, drainDistM, canalKmPerKm2 };
}

/** Cell edge lengths in metres for a grid over `geo`. */
function cellSize(geo: BarrierGeo, w: number, h: number) {
  const cos = Math.cos((((geo.north + geo.south) / 2) * Math.PI) / 180);
  return { cx: ((geo.east - geo.west) * M_PER_DEG * cos) / w, cy: ((geo.north - geo.south) * M_PER_DEG) / h };
}

function drainageMetrics(geo: BarrierGeo, w: number, h: number, lines: BarrierFeature[]) {
  const { cx, cy } = cellSize(geo, w, h);
  // Extended grid: DRAIN_CAP_M of margin on every side.
  const mx = Math.ceil(DRAIN_CAP_M / cx), my = Math.ceil(DRAIN_CAP_M / cy);
  const W = w + 2 * mx, H = h + 2 * my, N = W * H;
  const toCell = (p: LatLon) => ({
    x: ((p.lon - geo.west) / (geo.east - geo.west)) * w - 0.5 + mx,
    y: ((geo.north - p.lat) / (geo.north - geo.south)) * h - 0.5 + my,
  });

  // 1. Drainage cells and drainage length (m) per extended cell, by fine sampling of each segment.
  const isDrain = new Uint8Array(N);
  const lenM = new Float32Array(N);
  for (const f of lines) {
    for (let i = 1; i < f.pts.length; i++) {
      const a = toCell(f.pts[i - 1]), b = toCell(f.pts[i]);
      if ((a.x < -1 && b.x < -1) || (a.y < -1 && b.y < -1) || (a.x > W && b.x > W) || (a.y > H && b.y > H)) continue;
      walk4(a.x, a.y, b.x, b.y, (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) isDrain[y * W + x] = 1; });
      const segM = Math.hypot((b.x - a.x) * cx, (b.y - a.y) * cy);
      const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4));
      for (let s = 0; s < k; s++) {
        const t = (s + 0.5) / k;
        const x = Math.round(a.x + (b.x - a.x) * t), y = Math.round(a.y + (b.y - a.y) * t);
        if (x >= 0 && y >= 0 && x < W && y < H) lenM[y * W + x] += segM / k;
      }
    }
  }

  // 2. Two-pass vector distance transform (8SSED): each cell keeps the offset to its nearest
  //    drainage cell, so distances are Euclidean in metres even with non-square cells.
  const BIG = 1 << 20;
  const ox = new Int32Array(N).fill(BIG), oy = new Int32Array(N).fill(BIG);
  for (let k = 0; k < N; k++) if (isDrain[k]) { ox[k] = 0; oy[k] = 0; }
  const d2 = (dx: number, dy: number) => (dx * cx) ** 2 + (dy * cy) ** 2;
  const relax = (k: number, j: number, ddx: number, ddy: number) => {
    if (ox[j] === BIG) return;
    const nx = ox[j] + ddx, ny = oy[j] + ddy;
    if (ox[k] === BIG || d2(nx, ny) < d2(ox[k], oy[k])) { ox[k] = nx; oy[k] = ny; }
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      if (x > 0) relax(k, k - 1, 1, 0);
      if (y > 0) {
        relax(k, k - W, 0, 1);
        if (x > 0) relax(k, k - W - 1, 1, 1);
        if (x < W - 1) relax(k, k - W + 1, -1, 1);
      }
    }
    for (let x = W - 2; x >= 0; x--) relax(y * W + x, y * W + x + 1, -1, 0);
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const k = y * W + x;
      if (x < W - 1) relax(k, k + 1, -1, 0);
      if (y < H - 1) {
        relax(k, k + W, 0, -1);
        if (x < W - 1) relax(k, k + W + 1, -1, -1);
        if (x > 0) relax(k, k + W - 1, 1, -1);
      }
    }
    for (let x = 1; x < W; x++) relax(y * W + x, y * W + x - 1, 1, 0);
  }

  // 3. Per-cell outputs on the inner grid.
  const drainDistM = new Float32Array(w * h);
  const canalKmPerKm2 = new Float32Array(w * h);
  const rx = Math.ceil(DENSITY_RADIUS_M / cx), ry = Math.ceil(DENSITY_RADIUS_M / cy);
  const kernel: number[] = [];
  for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) if (d2(dx, dy) <= DENSITY_RADIUS_M ** 2) kernel.push(dy * W + dx);
  const windowKm2 = (kernel.length * cx * cy) / 1e6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const K = (y + my) * W + (x + mx);
      drainDistM[y * w + x] = ox[K] === BIG ? DRAIN_CAP_M : Math.min(DRAIN_CAP_M, Math.sqrt(d2(ox[K], oy[K])));
      let m = 0;
      for (const o of kernel) m += lenM[K + o];
      canalKmPerKm2[y * w + x] = m / 1000 / windowKm2;
    }
  }
  return { drainDistM, canalKmPerKm2 };
}
