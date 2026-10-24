// Canadian Forest Fire Weather Index (FWI) System, daily. Indonesia's Fire Danger Rating
// System (BMKG) is built on it.
//
// Port of ml/forecast/fwi.py, which follows Van Wagner (1987, Forestry Technical Report 35) as
// implemented in the R package cffdrs (Wang et al. 2017, Fire Technology 53:1285): the same
// equations, constants and latitude bands, checked against cffdrs' reference outputs in pytest
// and against the Python numbers in fwi.test.ts (shared fixture fwi.fixture.json).
//
// Day length (cffdrs lat.adjust = TRUE): DMC effective day length is 9 h every month for
// -10 < lat <= 10, and the DC day-length factor is 1.4 every month for -20 < lat <= 20 (the
// annual mean of the northern factors, 1.39, rounded as cffdrs does). All of Kalimantan and
// Sumatra lies in both equatorial bands. Start-up values: FFMC 85, DMC 6, DC 15.

export const FFMC_COEFFICIENT = (250 * 59.5) / 101;

const LE_N30 = [6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0];
const LE_N10 = [7.9, 8.4, 8.9, 9.5, 9.9, 10.2, 10.1, 9.7, 9.1, 8.6, 8.1, 7.8];
const LE_S10 = [10.1, 9.6, 9.1, 8.5, 8.1, 7.8, 7.9, 8.3, 8.9, 9.4, 9.9, 10.2];
const LE_S30 = [11.5, 10.5, 9.2, 7.9, 6.8, 6.2, 6.5, 7.4, 8.7, 10.0, 11.2, 11.8];
const LF_N20 = [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6];
const LF_S20 = [6.4, 5.0, 2.4, 0.4, -1.6, -1.6, -1.6, -1.6, -1.6, 0.9, 3.8, 5.8];

export interface FwiCodes { ffmc: number; dmc: number; dc: number }
export interface FwiWeather {
  /** Air temperature at local noon, °C. */
  tempC: number;
  /** Relative humidity at local noon, %. */
  rh: number;
  /** 10 m wind speed at local noon, km/h. */
  windKmh: number;
  /** Rain in the 24 h ending at local noon, mm. */
  rainMm: number;
  lat: number;
  /** 1–12. */
  month: number;
}
export interface FwiDay extends FwiCodes { isi: number; bui: number; fwi: number; dsr: number }

export const FWI_START: FwiCodes = { ffmc: 85, dmc: 6, dc: 15 };

export function dayLengthDmc(lat: number, month: number): number {
  const m = month - 1;
  if (lat > 30) return LE_N30[m];
  if (lat > 10) return LE_N10[m];
  if (lat > -10) return 9;
  if (lat > -30) return LE_S10[m];
  return LE_S30[m];
}

export function dayLengthDc(lat: number, month: number): number {
  const m = month - 1;
  if (lat > 20) return LF_N20[m];
  if (lat > -20) return 1.4;
  return LF_S20[m];
}

export function ffmcNext(ffmcYda: number, temp: number, rh: number, ws: number, prec: number): number {
  let wmo = (FFMC_COEFFICIENT * (101 - ffmcYda)) / (59.5 + ffmcYda);
  if (prec > 0.5) {
    const ra = prec - 0.5;
    let add = 42.5 * ra * Math.exp(-100 / (251 - wmo)) * (1 - Math.exp(-6.93 / ra));
    if (wmo > 150) add += 0.0015 * (wmo - 150) ** 2 * Math.sqrt(ra);
    wmo = Math.min(wmo + add, 250);
  }
  const tail = 0.18 * (21.1 - temp) * (1 - Math.exp(-0.115 * rh));
  const ed = 0.942 * rh ** 0.679 + 11 * Math.exp((rh - 100) / 10) + tail;
  const ew = 0.618 * rh ** 0.753 + 10 * Math.exp((rh - 100) / 10) + tail;
  let wm: number;
  if (wmo > ed) {
    const ko = 0.424 * (1 - (rh / 100) ** 1.7) + 0.0694 * Math.sqrt(ws) * (1 - (rh / 100) ** 8);
    wm = ed + (wmo - ed) / 10 ** (ko * 0.581 * Math.exp(0.0365 * temp));
  } else if (wmo < ed && wmo < ew) {
    const k1 = 0.424 * (1 - ((100 - rh) / 100) ** 1.7) + 0.0694 * Math.sqrt(ws) * (1 - ((100 - rh) / 100) ** 8);
    wm = ew - (ew - wmo) / 10 ** (k1 * 0.581 * Math.exp(0.0365 * temp));
  } else wm = wmo;
  return Math.min(Math.max((59.5 * (250 - wm)) / (FFMC_COEFFICIENT + wm), 0), 101);
}

export function dmcNext(dmcYda: number, temp: number, rh: number, prec: number, lat: number, month: number): number {
  const t = Math.max(temp, -1.1);
  const rk = 1.894 * (t + 1.1) * (100 - rh) * dayLengthDmc(lat, month) * 1e-4;
  let pr = dmcYda;
  if (prec > 1.5) {
    const rw = 0.92 * prec - 1.27;
    const wmi = 20 + 280 / Math.exp(0.023 * dmcYda);
    const b = dmcYda <= 33 ? 100 / (0.5 + 0.3 * dmcYda) : dmcYda <= 65 ? 14 - 1.3 * Math.log(dmcYda) : 6.2 * Math.log(dmcYda) - 17.2;
    const wmr = wmi + (1000 * rw) / (48.77 + b * rw);
    pr = 43.43 * (5.6348 - Math.log(wmr - 20));
  }
  return Math.max(Math.max(pr, 0) + rk, 0);
}

export function dcNext(dcYda: number, temp: number, prec: number, lat: number, month: number): number {
  const t = Math.max(temp, -2.8);
  const pe = Math.max((0.36 * (t + 2.8) + dayLengthDc(lat, month)) / 2, 0);
  let dr = dcYda;
  if (prec > 2.8) {
    const rw = 0.83 * prec - 1.27;
    const smi = 800 * Math.exp(-dcYda / 400);
    dr = Math.max(dcYda - 400 * Math.log(1 + (3.937 * rw) / smi), 0);
  }
  return Math.max(dr + pe, 0);
}

export function isiOf(ffmc: number, ws: number): number {
  const fm = (FFMC_COEFFICIENT * (101 - ffmc)) / (59.5 + ffmc);
  return 0.208 * Math.exp(0.05039 * ws) * 91.9 * Math.exp(-0.1386 * fm) * (1 + fm ** 5.31 / 49_300_000);
}

export function buiOf(dmc: number, dc: number): number {
  if (dmc === 0 && dc === 0) return 0;
  const b1 = (0.8 * dc * dmc) / (dmc + 0.4 * dc);
  if (b1 < dmc) {
    const p = (dmc - b1) / dmc;
    const cc = 0.92 + (0.0114 * dmc) ** 1.7;
    return Math.max(dmc - cc * p, 0);
  }
  return b1;
}

export function fwiOf(isi: number, bui: number): number {
  const bb = bui > 80 ? 0.1 * isi * (1000 / (25 + 108.64 / Math.exp(0.023 * bui))) : 0.1 * isi * (0.626 * bui ** 0.809 + 2);
  return bb <= 1 ? bb : Math.exp(2.72 * (0.434 * Math.log(bb)) ** 0.647);
}

/** One day of the system from yesterday's codes. RH is clamped to 0–100, wind and rain to ≥ 0. */
export function fwiDay(prev: FwiCodes, w: FwiWeather): FwiDay {
  const rh = Math.min(Math.max(w.rh, 0), 100), ws = Math.max(w.windKmh, 0), prec = Math.max(w.rainMm, 0);
  const ffmc = ffmcNext(prev.ffmc, w.tempC, rh, ws, prec);
  const dmc = dmcNext(prev.dmc, w.tempC, rh, prec, w.lat, w.month);
  const dc = dcNext(prev.dc, w.tempC, prec, w.lat, w.month);
  const isi = isiOf(ffmc, ws);
  const bui = buiOf(dmc, dc);
  const fwi = fwiOf(isi, bui);
  return { ffmc, dmc, dc, isi, bui, fwi, dsr: 0.0272 * fwi ** 1.77 };
}

/** Consecutive days, run continuously from `start` (default FFMC 85, DMC 6, DC 15). */
export function fwiSeries(days: Omit<FwiWeather, 'lat'>[], lat: number, start: FwiCodes = FWI_START): FwiDay[] {
  let prev = start;
  return days.map((d) => {
    const r = fwiDay(prev, { ...d, lat });
    prev = r;
    return r;
  });
}
