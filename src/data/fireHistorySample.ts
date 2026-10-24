// Fire history on the scenario grid: for each 100 m cell, how many earlier calendar years NASA
// FIRMS saw fire there (src/data/fireHistory.ts, public/data/fire-history/). Only the island files
// that overlap the box are fetched (Kalimantan is ~7 MB), once per data environment.
import type { DataEnv } from './env';
import { fireHistoryFrom, parseFireHistoryGrid, type FireHistoryGrid, type FireHistoryIndex, type GeoBox } from './fireHistory';

const BASE = 'data/fire-history/';

const cache = new Map<string, Promise<unknown>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = make();
    // A failed load (offline, missing file) may succeed later: do not keep it.
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export interface FireHistorySample {
  /** Earlier fire years per cell, row-major from the north-west corner. */
  years: Uint8Array;
  /** Islands whose files were read. */
  islands: string[];
  /** First and last year in the archive, and the year counted up to (exclusive). */
  archive: [number, number];
  beforeYear: number;
}

const overlaps = (b: [number, number, number, number], box: GeoBox) => b[0] < box.east && b[2] > box.west && b[1] < box.north && b[3] > box.south;

/**
 * Count, for every cell of a w × h grid over `box`, the distinct years before `year` with a
 * FIRMS fire detection on that cell. Null when the environment cannot read binary files, the
 * archive is not shipped, or the box lies outside every island in it.
 */
export async function sampleFireHistory(box: GeoBox, w: number, h: number, year: number, env: DataEnv): Promise<FireHistorySample | null> {
  const fetchBuffer = env.fetchBuffer?.bind(env);
  if (!fetchBuffer) return null;
  const index = await once(`${env.name}:index`, async () => {
    const buf = await fetchBuffer(`${BASE}index.json`);
    if (!buf) return null;
    const ix = JSON.parse(new TextDecoder().decode(buf)) as FireHistoryIndex;
    if (ix.kind !== 'fireseptum.fire-history') throw new Error(`unexpected fire history index kind ${String(ix.kind)}`);
    return ix;
  });
  if (!index) return null;
  const metas = Object.values(index.islands).filter((m) => overlaps(m.bbox, box));
  if (metas.length === 0) return null;
  const grids = await Promise.all(metas.map((m) => once(`${env.name}:${m.file}`, async (): Promise<FireHistoryGrid> => {
    const buf = await fetchBuffer(`${BASE}${m.file}`);
    if (!buf) throw new Error(`fire history ${m.file} is missing`);
    return parseFireHistoryGrid(m, buf, index.cellDeg, index.bit0Year);
  })));
  const fh = fireHistoryFrom(index, grids);
  return { years: fh.sampleGrid(box, w, h, year), islands: metas.map((m) => m.name), archive: index.years, beforeYear: year };
}
