// Daily Canadian FWI System values from ERA5 at the validation and training points, built by
// ml/forecast/era5.py into data/fwi/era5-<year>.json.gz. Values are looked up by nearest point.
//
// The reader is injected so this works in Node (node:fs readFile) and in the browser (fetch).
// It may return gzip bytes (decompressed here with DecompressionStream) or plain JSON bytes.

export const FWI_ARCHIVE_VARS = ['ffmc', 'dmc', 'dc', 'isi', 'bui', 'fwi', 'daysSinceRain', 'rain24', 'rh', 'windKmh', 'tempC'] as const;
export type FwiArchiveVar = (typeof FWI_ARCHIVE_VARS)[number];
export type FwiValues = Record<FwiArchiveVar, number> & { pointLat: number; pointLon: number; distKm: number };

export interface FwiArchiveYear {
  v: number;
  kind: 'fireseptum.fwi-archive';
  year: number;
  gridDeg: number;
  hourUtc: number;
  source: string;
  method: string;
  points: { lat: number; lon: number }[];
  /** YYYY-MM-DD, consecutive from 1 January. */
  dates: string[];
  /** vars[name][pointIndex][dayIndex] */
  vars: Record<FwiArchiveVar, number[][]>;
}

export interface FwiArchive {
  years: Map<number, FwiArchiveYear>;
  /** Values at the nearest archive point on `date` (YYYY-MM-DD), or null if the date is not covered. */
  at(lat: number, lon: number, date: string): FwiValues | null;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function parseFwiArchiveYear(buf: ArrayBuffer | Uint8Array): Promise<FwiArchiveYear> {
  let bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
  const doc = JSON.parse(new TextDecoder().decode(bytes)) as FwiArchiveYear;
  if (doc.kind !== 'fireseptum.fwi-archive') throw new Error(`unexpected FWI archive kind ${String(doc.kind)}`);
  return doc;
}

/** Great-circle distance in km (haversine). */
function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function fwiArchiveFrom(docs: FwiArchiveYear[]): FwiArchive {
  const years = new Map(docs.map((d) => [d.year, d]));
  const at = (lat: number, lon: number, date: string): FwiValues | null => {
    const doc = years.get(Number(date.slice(0, 4)));
    if (!doc || doc.points.length === 0) return null;
    const di = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${doc.dates[0]}T00:00:00Z`)) / 864e5);
    if (!(di >= 0 && di < doc.dates.length)) return null;
    let best = 0, bestD = Infinity;
    doc.points.forEach((p, i) => {
      const d = distKm(lat, lon, p.lat, p.lon);
      if (d < bestD) { bestD = d; best = i; }
    });
    const out = { pointLat: doc.points[best].lat, pointLon: doc.points[best].lon, distKm: bestD } as FwiValues;
    for (const k of FWI_ARCHIVE_VARS) out[k] = doc.vars[k][best][di];
    return out;
  };
  return { years, at };
}

/** Load the given years. Default path layout: `${base}era5-<year>.json.gz`. */
export async function loadFwiArchive(read: (path: string) => Promise<ArrayBuffer | Uint8Array>, years: number[], base = 'data/fwi/'): Promise<FwiArchive> {
  const docs = await Promise.all(years.map(async (y) => parseFwiArchiveYear(await read(`${base}era5-${y}.json.gz`))));
  return fwiArchiveFrom(docs);
}
