// NASA FIRMS detections from the yearly country archive files instead of the area API, for batch
// work on past fire seasons (scripts/ml/extract.ts). Same answer shape as DataEnv.firms.
//
// Files: .cache/firms-archive/viirs-snpp_<YEAR>_Indonesia.csv, downloaded keyless by
// ml/forecast/firms_archive.py (standard processing, the same columns as the area API plus
// `type`). Only type 0 (presumed vegetation fire) is kept, as in the published event rule
// (docs/forecast-split.md). VIIRS S-NPP only: NOAA-20 has no yearly country file.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FirmsResult, RawHotspot } from '../../src/data/firms.ts';

export const ARCHIVE_SOURCE = 'VIIRS_SNPP_SP (yearly country archive, type 0)';

export interface FirmsArchive {
  firms(bbox: [number, number, number, number], days: number, date?: string): Promise<FirmsResult>;
}

/** Detections of one year, bucketed by UTC date. */
type Year = Map<string, RawHotspot[]>;

export function firmsArchive(dir: string): FirmsArchive {
  const years = new Map<number, Year>();
  const load = (y: number): Year => {
    let m = years.get(y);
    if (m) return m;
    m = new Map();
    const file = join(dir, `viirs-snpp_${y}_Indonesia.csv`);
    if (!existsSync(file)) throw new Error(`FIRMS archive file missing: ${file}`);
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const head = lines[0].split(',');
    const c = (n: string) => {
      const i = head.indexOf(n);
      if (i < 0) throw new Error(`${file}: no column ${n}`);
      return i;
    };
    const iLat = c('latitude'), iLon = c('longitude'), iFrp = c('frp'), iConf = c('confidence'), iDate = c('acq_date'), iTime = c('acq_time'), iSat = c('satellite'), iType = c('type');
    for (let k = 1; k < lines.length; k++) {
      const line = lines[k];
      if (!line) continue;
      const v = line.split(',');
      if (v[iType] !== '0') continue;
      const t = v[iTime].padStart(4, '0');
      const date = v[iDate];
      const h: RawHotspot = {
        lat: Number(v[iLat]), lon: Number(v[iLon]), frp: Number(v[iFrp]), confidence: v[iConf],
        acquired: `${date}T${t.slice(0, 2)}:${t.slice(2)}:00Z`, satellite: v[iSat],
      };
      if (!Number.isFinite(h.lat) || !Number.isFinite(h.lon)) continue;
      (m.get(date) ?? m.set(date, []).get(date)!).push(h);
    }
    years.set(y, m);
    return m;
  };
  return {
    async firms(bbox, days, date) {
      if (!date) throw new Error('the FIRMS archive needs a start date');
      const [w, s, e, n] = bbox;
      const out: RawHotspot[] = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(Date.parse(`${date}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10);
        for (const h of load(Number(d.slice(0, 4))).get(d) ?? []) if (h.lon >= w && h.lon <= e && h.lat >= s && h.lat <= n) out.push(h);
      }
      return { hotspots: out, sources: [ARCHIVE_SOURCE], fetchedAt: new Date().toISOString() };
    },
  };
}
