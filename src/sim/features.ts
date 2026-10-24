// Per-block features for the statistical forecaster (src/sim/gbm.ts, ml/gbm/). ONE implementation
// for training and live use: scripts/ml/extract.ts calls computeBoxFeatures on every historical
// box, and gbmForecast calls it on the live or sealed scenario, so a feature can never mean one
// thing in training and another in the app.
//
// The unit is the 400 m block of the 6.4 km box (16 × 16 blocks of 4 × 4 cells of 100 m), the
// unit every forecast is scored on (src/sim/hindcast.ts scoreBlocks). Rows are blocks, row-major
// from the north-west block; columns are FEATURE_NAMES in order.
//
// Missing values are NaN, in training and in inference alike: no fire of that age in the box, no
// canal layer (drainM), no fire-history layer, no FWI value, no wind direction. The trees route
// NaN down a learned branch (HistGradientBoosting's missing-go-left flag), so no imputation exists
// that could differ between the two.
//
// Determinism: only + − × ÷, comparisons, Math.sqrt / floor / abs / min / max (IEEE 754 exact),
// and DET1 sin / cos for the wind vector, so every engine computes the same bits.
import { DET1 } from './detmath';
import { FUEL_INDEX } from './fuels';
import { blockFireMask } from './hindcast';
import { Cell, type FireState, type Hotspot, type Landscape } from './types';

/** Block edge in cells (400 m at 100 m cells), as the scorer. */
export const FEATURE_BLOCK = 4;
/** Detections at most this old count as active fire at t0 (the live scenario's burning cells). */
export const ACTIVE_H = 24;
/** Older fire: detections between ACTIVE_H and this many hours before t0 (the live app reads 48 h of FIRMS). */
export const OLDER_H = 48;
/** Only blocks within this distance of fire at t0 are candidates (scoreBlocks' reach). */
export const REACH_KM = 3;

/** The FWI System values that enter the model, as read from src/data/fwiArchive.ts. */
export interface FwiFeatureValues {
  ffmc: number; dmc: number; dc: number; isi: number; bui: number; fwi: number;
  daysSinceRain: number; rain24: number; rh: number; windKmh: number; tempC: number;
}

/**
 * Every feature, in column order, with its definition. "Within r km" means the distance from the
 * block centre to the detection's pixel centre is ≤ r. Detection ages are measured back from t0.
 */
export const FEATURE_DOCS = [
  ['d_active_km', 'Distance (km) from the block centre to the nearest detection of the last 24 h (active fire). NaN when there is none in the box.'],
  ['d_older_km', 'Distance (km) to the nearest detection 24–48 h old. NaN when there is none.'],
  ['d_fire_km', 'Distance (km) from the block centre to the nearest block on fire at t0 (the scorer\'s fire mask, which also holds older scars). NaN when no block is on fire.'],
  ['n_active_1km', 'Detections of the last 24 h within 1 km.'],
  ['n_active_3km', 'Detections of the last 24 h within 3 km.'],
  ['n_older_3km', 'Detections 24–48 h old within 3 km.'],
  ['frp_active_3km', 'Sum of fire radiative power (MW) of the detections of the last 24 h within 3 km.'],
  ['n_active_box', 'Detections of the last 24 h in the whole box.'],
  ['n_older_box', 'Detections 24–48 h old in the whole box.'],
  ['frp_active_box', 'Sum of FRP (MW) of the detections of the last 24 h in the box.'],
  ['growth_ratio', 'n_active_box / (n_older_box + 1): is the fire in the box growing or dying down.'],
  ['fire_duration_h', 'Hours between the oldest and the newest detection (≤ 48 h old) within 3 km: how long this fire has been seen. NaN when none is within 3 km.'],
  ['spread_align', 'Cosine between the bearing from the nearest active detection to the block and the shift of the fire\'s centroid from the 24–48 h detections to the last 24 h ones (the direction the fire has been moving). NaN when either set is empty or the shift is under half a cell.'],
  ['wind_align', 'Cosine between the bearing from the nearest active detection to the block and the direction the wind blows TO at t0. NaN when the wind direction is not given (always, in the historical training data: the ERA5 archive has no wind direction).'],
  ['peat_frac', 'Share of the block\'s cells on peat soil (fuel peat swamp forest or degraded peat shrub, GFW peat map).'],
  ['peat_frac_nbr', 'Share of peat-soil cells in the 5 × 5 blocks (2 km) around the block.'],
  ['f_grass', 'Share of cells with fuel grass / fern (WorldCover grass, shrub or bare off peat).'],
  ['f_shrub', 'Share of cells with fuel degraded peat shrub.'],
  ['f_peatforest', 'Share of cells with fuel peat swamp forest.'],
  ['f_plantation', 'Share of cells with fuel plantation (tree cover off peat).'],
  ['f_agri', 'Share of cells with fuel wet farmland (cropland, wetland, mangrove off peat).'],
  ['f_water', 'Share of water cells (WorldCover water, OSM rivers and canals, sea level).'],
  ['f_built', 'Share of settlement / major-road cells.'],
  ['nonburn_nbr', 'Share of non-burnable cells (water + settlement) in the 5 × 5 blocks around the block.'],
  ['brk_frac', 'Share of cells carrying a partial fuel break (OSM ditches, drains, streams, minor roads, tracks).'],
  ['drain_min_m', 'Minimum over the block\'s cells of the distance (m) to the nearest canal, ditch or drain (OSM snapshot). NaN without the canal layer.'],
  ['drain_mean_m', 'Mean of the same distance over the block. NaN without the canal layer.'],
  ['canal_density', 'Share of cells in the 5 × 5 blocks around the block that lie within 50 m of a canal, ditch or drain. NaN without the canal layer.'],
  ['fire_years_mean', 'Mean over the block\'s cells of the number of earlier calendar years with a FIRMS detection (years before t0\'s year only). NaN without the fire-history layer.'],
  ['fire_years_max', 'Maximum of the same count over the block. NaN without the fire-history layer.'],
  ['elev_mean', 'Mean elevation (m) of the block (AWS Terrain Tiles).'],
  ['elev_rel', 'Block mean elevation minus the median block elevation of the box (m): peat domes and river valleys.'],
  ['slope_pct', 'Slope (%) from the block-mean elevations of the neighbouring blocks (central differences, one-sided at the edge).'],
  ['ffmc', 'Fine Fuel Moisture Code at t0 (FWI System, ERA5, nearest 0.5° point, the latest 05 UTC value at or before t0).'],
  ['dmc', 'Duff Moisture Code at t0.'],
  ['dc', 'Drought Code at t0: deep, slow drying. The key peat drought signal.'],
  ['isi', 'Initial Spread Index at t0.'],
  ['bui', 'Buildup Index at t0.'],
  ['fwi', 'Fire Weather Index at t0.'],
  ['days_since_rain', 'Days since the last day with ≥ 2 mm of rain (ERA5).'],
  ['rain24', 'Rain (mm) in the 24 h ending at the FWI hour.'],
  ['rh', 'Relative humidity (%) at the FWI hour.'],
  ['wind_kmh', '10 m wind speed (km/h) at the FWI hour.'],
  ['temp_c', '2 m air temperature (°C) at the FWI hour.'],
  ['doy', 'UTC day of year of t0 (1–366).'],
] as const;

export type FeatureName = (typeof FEATURE_DOCS)[number][0];
export const FEATURE_NAMES: readonly FeatureName[] = FEATURE_DOCS.map((d) => d[0]);
export const NF = FEATURE_NAMES.length;
const IX = Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, i])) as Record<FeatureName, number>;
export const featureIndex = (n: FeatureName) => IX[n];

/** FWI feature columns and the archive variable each one copies. */
export const FWI_FEATURES: readonly [FeatureName, keyof FwiFeatureValues][] = [
  ['ffmc', 'ffmc'], ['dmc', 'dmc'], ['dc', 'dc'], ['isi', 'isi'], ['bui', 'bui'], ['fwi', 'fwi'],
  ['days_since_rain', 'daysSinceRain'], ['rain24', 'rain24'], ['rh', 'rh'], ['wind_kmh', 'windKmh'], ['temp_c', 'tempC'],
];

/** UTC hour of the daily FWI value (local noon in WIB; ml/forecast/era5.py HOUR_UTC). */
export const FWI_HOUR_UTC = 5;

/** The FWI date known at t0: the latest 05 UTC at or before t0 (YYYY-MM-DD). */
export function fwiDateAt(t0: string | number): string {
  const ms = typeof t0 === 'number' ? t0 : Date.parse(t0);
  return new Date(ms - FWI_HOUR_UTC * 3.6e6).toISOString().slice(0, 10);
}

/** The FWI columns of one box (NaN for anything missing). Training's FWI join and live inference both use this. */
export function fwiFeatureValues(fwi: Partial<FwiFeatureValues> | null | undefined): number[] {
  return FWI_FEATURES.map(([, k]) => {
    const v = fwi?.[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  });
}

export interface FeatureInput {
  landscape: Pick<Landscape, 'w' | 'h' | 'cellM' | 'fuel' | 'elev' | 'drainM' | 'fireYears'>;
  init: Pick<FireState, 'state' | 'brk'>;
  /** Detections known at t0, in cell coordinates (cell centres at integers), as Scenario.hotspots. */
  hotspots: Pick<Hotspot, 'x' | 'y' | 'acquired' | 'frp'>[];
  t0: string | number;
  fwi?: Partial<FwiFeatureValues> | null;
  /** Wind direction (degrees the wind blows FROM) at t0, when known. */
  windFromDeg?: number | null;
}

export interface BoxFeatures {
  /** Blocks per row and column. */
  bw: number;
  bh: number;
  /** Row-major [block][feature], NF columns in FEATURE_NAMES order. */
  x: Float64Array;
  /** Blocks on fire at t0 (blockFireMask). */
  fireAtT0: Uint8Array;
  /** Blocks the scorer scores: not on fire at t0 and within REACH_KM of a block that is. */
  candidate: Uint8Array;
}

const ln = (a: number, b: number) => Math.sqrt(a * a + b * b);

/** Features of every block of a box at t0. */
export function computeBoxFeatures(inp: FeatureInput): BoxFeatures {
  const l = inp.landscape, B = FEATURE_BLOCK;
  const w = l.w, h = l.h, kmPerCell = l.cellM / 1000;
  const bw = Math.ceil(w / B), bh = Math.ceil(h / B), nb = bw * bh;
  const t0 = typeof inp.t0 === 'number' ? inp.t0 : Date.parse(inp.t0);
  const x = new Float64Array(nb * NF).fill(NaN);
  const set = (b: number, n: FeatureName, v: number) => { x[b * NF + IX[n]] = v; };

  // Fire mask and reach, exactly as the scorer: block-grid distances in block units.
  const fireAtT0 = blockFireMask({ w, h, cellM: l.cellM } as Landscape, inp.init as FireState, B);
  const fireBlocks: number[] = [];
  for (let b = 0; b < nb; b++) if (fireAtT0[b]) fireBlocks.push(b);
  const blockKm = B * kmPerCell;
  const candidate = new Uint8Array(nb);
  const dFire = new Float64Array(nb).fill(NaN);
  for (let b = 0; b < nb; b++) {
    const bx = b % bw, by = Math.floor(b / bw);
    let best = Infinity;
    for (const f of fireBlocks) {
      const d = ln(bx - (f % bw), by - Math.floor(f / bw));
      if (d < best) best = d;
    }
    if (best < Infinity) dFire[b] = best * blockKm;
    if (!fireAtT0[b] && best * blockKm <= REACH_KM) candidate[b] = 1;
  }

  // Detections by age class.
  type D = { x: number; y: number; frp: number; ageH: number };
  const active: D[] = [], older: D[] = [];
  for (const p of inp.hotspots) {
    const ageH = (t0 - Date.parse(p.acquired)) / 3.6e6;
    if (!(ageH >= 0) || ageH > OLDER_H) continue;
    const d = { x: p.x, y: p.y, frp: Number.isFinite(p.frp) ? p.frp : 0, ageH };
    if (ageH <= ACTIVE_H) active.push(d); else older.push(d);
  }
  let frpBox = 0;
  for (const d of active) frpBox += d.frp;
  const centroid = (ds: D[]) => {
    let sx = 0, sy = 0;
    for (const d of ds) { sx += d.x; sy += d.y; }
    return { x: sx / ds.length, y: sy / ds.length };
  };
  let shift: { x: number; y: number } | null = null;
  if (active.length && older.length) {
    const a = centroid(active), o = centroid(older);
    const s = { x: a.x - o.x, y: a.y - o.y };
    if (ln(s.x, s.y) >= 0.5) shift = s;
  }
  let wind: { x: number; y: number } | null = null;
  if (typeof inp.windFromDeg === 'number' && Number.isFinite(inp.windFromDeg)) {
    // Blows TO from + 180°; bearing clockwise from north, y grows south.
    const toRad = ((inp.windFromDeg + 180) * Math.PI) / 180;
    wind = { x: DET1.sin(toRad), y: -DET1.cos(toRad) };
  }

  // Per-block cell statistics.
  const F = FUEL_INDEX;
  const peatCells = new Float64Array(nb), nonburnCells = new Float64Array(nb), cells = new Float64Array(nb);
  const canalCells = new Float64Array(nb);
  const elevSum = new Float64Array(nb);
  const fuelShare = { grass: new Float64Array(nb), shrub: new Float64Array(nb), peat: new Float64Array(nb), plantation: new Float64Array(nb), agri: new Float64Array(nb), water: new Float64Array(nb), settlement: new Float64Array(nb) };
  const brkCells = new Float64Array(nb);
  const drainMin = new Float64Array(nb).fill(Infinity), drainSum = new Float64Array(nb);
  const fyMax = new Float64Array(nb), fySum = new Float64Array(nb);
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const k = cy * w + cx, b = Math.floor(cy / B) * bw + Math.floor(cx / B);
    const f = l.fuel[k];
    cells[b]++;
    elevSum[b] += l.elev[k];
    if (f === F.peat || f === F.shrub) peatCells[b]++;
    if (f === F.water || f === F.settlement) nonburnCells[b]++;
    if (f === F.grass) fuelShare.grass[b]++;
    else if (f === F.shrub) fuelShare.shrub[b]++;
    else if (f === F.peat) fuelShare.peat[b]++;
    else if (f === F.plantation) fuelShare.plantation[b]++;
    else if (f === F.agri) fuelShare.agri[b]++;
    else if (f === F.water) fuelShare.water[b]++;
    else if (f === F.settlement) fuelShare.settlement[b]++;
    if (inp.init.brk[k] > 0 && inp.init.state[k] !== Cell.NonFuel) brkCells[b]++;
    if (l.drainM) {
      const d = l.drainM[k];
      if (d < drainMin[b]) drainMin[b] = d;
      drainSum[b] += d;
      if (d <= 50) canalCells[b]++;
    }
    if (l.fireYears) {
      const v = l.fireYears[k];
      fySum[b] += v;
      if (v > fyMax[b]) fyMax[b] = v;
    }
  }
  const elevMean = new Float64Array(nb);
  for (let b = 0; b < nb; b++) elevMean[b] = elevSum[b] / cells[b];
  const sortedElev = Array.from(elevMean).sort((a, c) => a - c);
  const medElev = nb % 2 ? sortedElev[(nb - 1) / 2] : (sortedElev[nb / 2 - 1] + sortedElev[nb / 2]) / 2;
  /** Sum of a per-block array over the (2r+1)² window, and the cell count over it. */
  const windowShare = (num: Float64Array, bx: number, by: number, r: number) => {
    let s = 0, n = 0;
    for (let yy = Math.max(0, by - r); yy <= Math.min(bh - 1, by + r); yy++) {
      for (let xx = Math.max(0, bx - r); xx <= Math.min(bw - 1, bx + r); xx++) { s += num[yy * bw + xx]; n += cells[yy * bw + xx]; }
    }
    return s / n;
  };
  const elevAt = (bx: number, by: number) => elevMean[by * bw + bx];

  for (let b = 0; b < nb; b++) {
    const bx = b % bw, by = Math.floor(b / bw);
    // Block centre in cell coordinates (cell centres at integers).
    const px = bx * B + (B - 1) / 2, py = by * B + (B - 1) / 2;

    let dA = Infinity, nearest: D | null = null, nA1 = 0, nA3 = 0, frp3 = 0;
    let oldest = -Infinity, newest = Infinity;
    for (const d of active) {
      const km = ln(d.x - px, d.y - py) * kmPerCell;
      if (km < dA) { dA = km; nearest = d; }
      if (km <= 1) nA1++;
      if (km <= 3) {
        nA3++; frp3 += d.frp;
        if (d.ageH > oldest) oldest = d.ageH;
        if (d.ageH < newest) newest = d.ageH;
      }
    }
    let dO = Infinity, nO3 = 0;
    for (const d of older) {
      const km = ln(d.x - px, d.y - py) * kmPerCell;
      if (km < dO) dO = km;
      if (km <= 3) {
        nO3++;
        if (d.ageH > oldest) oldest = d.ageH;
        if (d.ageH < newest) newest = d.ageH;
      }
    }
    if (dA < Infinity) set(b, 'd_active_km', dA);
    if (dO < Infinity) set(b, 'd_older_km', dO);
    set(b, 'd_fire_km', dFire[b]);
    set(b, 'n_active_1km', nA1);
    set(b, 'n_active_3km', nA3);
    set(b, 'n_older_3km', nO3);
    set(b, 'frp_active_3km', frp3);
    set(b, 'n_active_box', active.length);
    set(b, 'n_older_box', older.length);
    set(b, 'frp_active_box', frpBox);
    set(b, 'growth_ratio', active.length / (older.length + 1));
    if (oldest > -Infinity) set(b, 'fire_duration_h', oldest - newest);
    if (nearest) {
      const vx = px - nearest.x, vy = py - nearest.y, vl = ln(vx, vy);
      if (vl > 0) {
        if (shift) set(b, 'spread_align', (vx * shift.x + vy * shift.y) / (vl * ln(shift.x, shift.y)));
        if (wind) set(b, 'wind_align', (vx * wind.x + vy * wind.y) / vl);
      }
    }

    const c = cells[b];
    set(b, 'peat_frac', peatCells[b] / c);
    set(b, 'peat_frac_nbr', windowShare(peatCells, bx, by, 2));
    set(b, 'f_grass', fuelShare.grass[b] / c);
    set(b, 'f_shrub', fuelShare.shrub[b] / c);
    set(b, 'f_peatforest', fuelShare.peat[b] / c);
    set(b, 'f_plantation', fuelShare.plantation[b] / c);
    set(b, 'f_agri', fuelShare.agri[b] / c);
    set(b, 'f_water', fuelShare.water[b] / c);
    set(b, 'f_built', fuelShare.settlement[b] / c);
    set(b, 'nonburn_nbr', windowShare(nonburnCells, bx, by, 2));
    set(b, 'brk_frac', brkCells[b] / c);
    if (l.drainM) {
      set(b, 'drain_min_m', drainMin[b]);
      set(b, 'drain_mean_m', drainSum[b] / c);
      set(b, 'canal_density', windowShare(canalCells, bx, by, 2));
    }
    if (l.fireYears) {
      set(b, 'fire_years_mean', fySum[b] / c);
      set(b, 'fire_years_max', fyMax[b]);
    }
    set(b, 'elev_mean', elevMean[b]);
    set(b, 'elev_rel', elevMean[b] - medElev);
    const x0 = Math.max(0, bx - 1), x1 = Math.min(bw - 1, bx + 1), y0 = Math.max(0, by - 1), y1 = Math.min(bh - 1, by + 1);
    const gx = x1 > x0 ? (elevAt(x1, by) - elevAt(x0, by)) / ((x1 - x0) * blockKm * 1000) : 0;
    const gy = y1 > y0 ? (elevAt(bx, y1) - elevAt(bx, y0)) / ((y1 - y0) * blockKm * 1000) : 0;
    set(b, 'slope_pct', 100 * ln(gx, gy));
  }

  // Box-wide values: FWI at t0 and the day of year.
  const fv = fwiFeatureValues(inp.fwi);
  const d0 = new Date(t0);
  const doy = Math.floor((Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) - Date.UTC(d0.getUTCFullYear(), 0, 1)) / 864e5) + 1;
  for (let b = 0; b < nb; b++) {
    FWI_FEATURES.forEach(([n], i) => set(b, n, fv[i]));
    set(b, 'doy', doy);
  }
  return { bw, bh, x, fireAtT0, candidate };
}

/** One block's row as a plain array (tests, debugging). */
export const featureRow = (f: BoxFeatures, b: number): number[] => Array.from(f.x.subarray(b * NF, (b + 1) * NF));
