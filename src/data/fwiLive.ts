// The FWI System at t0 for the statistical forecaster, outside the ERA5 archive years (live use,
// and any day data/fwi/ does not cover).
//
// Same rule as ml/forecast/era5.py, so the values mean what the trees were trained on: weather at
// 05 UTC (local noon in WIB), rain24 = rain in the 24 h ending at 05 UTC (hours stamped D-1 06:00
// .. D 05:00), the codes run from 1 January at FFMC 85, DMC 6, DC 15, daysSinceRain counts days
// since rain24 ≥ 1 mm (from 1 January if there was none).
//
// Source: Open-Meteo's historical forecast API (keyless), one call per box from 31 December of the
// year before to the FWI date. It is not ERA5 (training used the ERA5 reanalysis), so its codes
// can differ a little; the source is reported with the values.
import { fwiDay, FWI_START, type FwiCodes } from '../sim/fwi';
import { FWI_HOUR_UTC, fwiDateAt, type FwiFeatureValues } from '../sim/features';
import { browserEnv, type DataEnv } from './env';

export interface LiveFwi {
  values: FwiFeatureValues;
  /** The FWI date used (YYYY-MM-DD, 05 UTC). Earlier than fwiDateAt(t0) when the source has no later day. */
  date: string;
  source: string;
}

const hh = String(FWI_HOUR_UTC).padStart(2, '0');

export async function fetchFwiAt(lat: number, lon: number, t0: string, getJson: DataEnv['getJson'] = browserEnv.getJson): Promise<LiveFwi> {
  const date = fwiDateAt(t0);
  const year = Number(date.slice(0, 4));
  const url =
    `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
    `&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m` +
    `&wind_speed_unit=kmh&timezone=UTC&start_date=${year - 1}-12-31&end_date=${date}`;
  const j = (await getJson(url)) as { hourly: Record<string, (number | string | null)[]> };
  return fwiFromHourly(j.hourly, lat, date, `Open-Meteo historical forecast, ${lat.toFixed(2)}, ${lon.toFixed(2)}`);
}

/** Run the daily system over hourly UTC series (exported for tests). */
export function fwiFromHourly(h: Record<string, (number | string | null)[]>, lat: number, date: string, source: string): LiveFwi {
  const times = h.time as string[];
  const ix = new Map(times.map((t, i) => [t, i]));
  const num = (k: string, i: number) => { const v = h[k][i]; return typeof v === 'number' ? v : NaN; };
  let prev: FwiCodes = FWI_START;
  let since = 0, last: LiveFwi | null = null;
  const start = Date.parse(`${date.slice(0, 4)}-01-01T00:00:00Z`), end = Date.parse(`${date}T00:00:00Z`);
  for (let d = start; d <= end; d += 864e5) {
    const day = new Date(d).toISOString().slice(0, 10);
    const i = ix.get(`${day}T${hh}:00`);
    if (i === undefined || i < 23) break;
    let rain = 0;
    for (let k = i - 23; k <= i; k++) rain += num('precipitation', k);
    const tempC = num('temperature_2m', i), rh = num('relative_humidity_2m', i), windKmh = num('wind_speed_10m', i);
    if (![rain, tempC, rh, windKmh].every(Number.isFinite)) break;
    const r = fwiDay(prev, { tempC, rh, windKmh, rainMm: rain, lat, month: Number(day.slice(5, 7)) });
    prev = r;
    since = rain >= 1 ? 0 : since + 1;
    last = { values: { ffmc: r.ffmc, dmc: r.dmc, dc: r.dc, isi: r.isi, bui: r.bui, fwi: r.fwi, daysSinceRain: since, rain24: rain, rh, windKmh, tempC }, date: day, source };
  }
  if (!last) throw new Error(`no ${hh}:00 UTC weather for ${date}`);
  return last;
}
