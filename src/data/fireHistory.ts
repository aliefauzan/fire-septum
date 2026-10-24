// Fire history per 0.005° cell (~550 m): the calendar years 2001–2025 in which NASA FIRMS saw
// vegetation fire on that cell (VIIRS S-NPP within 187 m, MODIS within 500 m of a detection).
// Built offline by ml/forecast/fire_history.py into public/data/fire-history/. Used to pick the
// Konecny et al. (2016) burn-depth class: first, second, third or fourth+ fire on the same ground.
//
// File format (<island>.bin): sorted pairs of little-endian uint32 (cellIndex, yearMask),
// cellIndex = row * width + col from the north-west corner of the island bbox, bit i = 2001 + i.

export interface FireHistoryIslandMeta {
  name: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  width: number;
  height: number;
  file: string;
  cells: number;
  bytes: number;
}

export interface FireHistoryIndex {
  v: number;
  kind: 'fireseptum.fire-history';
  cellDeg: number;
  years: [number, number];
  bit0Year: number;
  islands: Record<string, FireHistoryIslandMeta>;
}

export interface FireHistoryGrid {
  meta: FireHistoryIslandMeta;
  cellDeg: number;
  bit0Year: number;
  /** Sorted cell indices with at least one fire year. */
  cells: Uint32Array;
  /** Year bitmask for each entry of `cells`. */
  masks: Uint32Array;
}

export interface GeoBox { north: number; south: number; west: number; east: number }

export interface FireHistory {
  index: FireHistoryIndex;
  grids: FireHistoryGrid[];
  /** Year bitmask at a point (bit 0 = bit0Year), 0 outside every island or where no fire was seen. */
  maskAt(lat: number, lon: number): number;
  /** Number of distinct calendar years before `year` with fire on the cell containing (lat, lon). */
  fireYearsBefore(lat: number, lon: number, year: number): number;
  /** fireYearsBefore for every cell centre of a w × h grid over `box`, row-major from the north-west corner. */
  sampleGrid(box: GeoBox, w: number, h: number, year: number): Uint8Array;
}

/** Bits set in a 32-bit integer. */
export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function parseFireHistoryGrid(meta: FireHistoryIslandMeta, buf: ArrayBuffer, cellDeg: number, bit0Year: number): FireHistoryGrid {
  if (buf.byteLength % 8 !== 0) throw new Error(`fire history ${meta.file}: ${buf.byteLength} bytes is not a whole number of pairs`);
  const n = buf.byteLength / 8;
  const dv = new DataView(buf);
  const cells = new Uint32Array(n), masks = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    cells[i] = dv.getUint32(i * 8, true);
    masks[i] = dv.getUint32(i * 8 + 4, true);
  }
  return { meta, cellDeg, bit0Year, cells, masks };
}

/** Cell index of (lat, lon) in a grid, or -1 outside its bbox. */
export function cellIndexOf(g: FireHistoryGrid, lat: number, lon: number): number {
  const [west, , , north] = g.meta.bbox;
  const row = Math.floor((north - lat) / g.cellDeg), col = Math.floor((lon - west) / g.cellDeg);
  if (row < 0 || col < 0 || row >= g.meta.height || col >= g.meta.width) return -1;
  return row * g.meta.width + col;
}

export function gridMaskAt(g: FireHistoryGrid, lat: number, lon: number): number {
  const k = cellIndexOf(g, lat, lon);
  if (k < 0) return 0;
  let lo = 0, hi = g.cells.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1, v = g.cells[mid];
    if (v === k) return g.masks[mid];
    if (v < k) lo = mid + 1; else hi = mid - 1;
  }
  return 0;
}

/** Mask of the years strictly before `year`, given bit 0 = bit0Year. */
export function yearsBeforeMask(year: number, bit0Year: number): number {
  const n = year - bit0Year;
  if (n <= 0) return 0;
  return n >= 32 ? 0xffffffff : ((1 << n) - 1) >>> 0;
}

export function fireHistoryFrom(index: FireHistoryIndex, grids: FireHistoryGrid[]): FireHistory {
  const maskAt = (lat: number, lon: number) => {
    for (const g of grids) if (cellIndexOf(g, lat, lon) >= 0) return gridMaskAt(g, lat, lon);
    return 0;
  };
  const fireYearsBefore = (lat: number, lon: number, year: number) => popcount((maskAt(lat, lon) & yearsBeforeMask(year, index.bit0Year)) >>> 0);
  const sampleGrid = (box: GeoBox, w: number, h: number, year: number) => {
    const out = new Uint8Array(w * h);
    const dLat = (box.north - box.south) / h, dLon = (box.east - box.west) / w;
    for (let y = 0; y < h; y++) {
      const lat = box.north - (y + 0.5) * dLat;
      for (let x = 0; x < w; x++) out[y * w + x] = fireYearsBefore(lat, box.west + (x + 0.5) * dLon, year);
    }
    return out;
  };
  return { index, grids, maskAt, fireYearsBefore, sampleGrid };
}

/**
 * Load the index and every island file. `fetchBuffer` is injected so this runs in the browser
 * (`(u) => fetch(u).then((r) => r.arrayBuffer())`) and in Node (`node:fs` readFile).
 */
export async function loadFireHistory(fetchBuffer: (url: string) => Promise<ArrayBuffer>, base = '/data/fire-history/'): Promise<FireHistory> {
  const index = JSON.parse(new TextDecoder().decode(await fetchBuffer(`${base}index.json`))) as FireHistoryIndex;
  if (index.kind !== 'fireseptum.fire-history') throw new Error(`unexpected fire history index kind ${String(index.kind)}`);
  const grids = await Promise.all(Object.values(index.islands).map(async (m) => parseFireHistoryGrid(m, await fetchBuffer(`${base}${m.file}`), index.cellDeg, index.bit0Year)));
  return fireHistoryFrom(index, grids);
}
