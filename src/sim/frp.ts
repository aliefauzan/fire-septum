// What the satellites have already seen burn, as an emission estimate from observations rather
// than from the spread model. Fire radiative power (FRP, MW) of each VIIRS pass is held until the
// next pass (at most MAX_HOLD_H) to give fire radiative energy (MJ), converted to dry matter with
// the GFAS land-cover factors (Kaiser et al. 2012, Table 2) and then to CO2e with the IPCC
// emission factors: peat from the 2013 Wetlands Supplement (the same editable rates as the
// forecast), other covers from the 2006 Guidelines Vol. 4, Table 2.5. Smouldering peat radiates
// little of its heat to the sky, so on peat this is a floor.
import { CO2_PER_C, normalDraw, quantilesOf, type Quantiles } from './carbon';
import { DET1 } from './detmath';
import { DEFAULT_RATES, type Rates } from './doctrine';
import { ON_PEAT, fuelOf } from './fuels';
import type { FuelId, Hotspot, Landscape, Scenario } from './types';

export type Cover = 'peat' | 'tropicalForest' | 'savanna' | 'agriculture';

/** GFAS β, kg dry matter per MJ of fire radiative energy (Kaiser et al. 2012, Table 2). */
export const GFAS_BETA: Record<Cover, number> = { peat: 5.87, tropicalForest: 0.96, savanna: 0.78, agriculture: 0.29 };

/** IPCC 2006 Vol. 4, Table 2.5: g per kg dry matter burnt. */
export const IPCC_FIRE_EF: Record<Exclude<Cover, 'peat'>, { co2: number; ch4: number }> = {
  tropicalForest: { co2: 1580, ch4: 6.8 },
  savanna: { co2: 1613, ch4: 2.3 },
  agriculture: { co2: 1515, ch4: 2.7 },
};

/** IPCC 2006 Vol. 4, Table 2.5: the ± values (standard deviations) of the factors above. Agricultural CH4 has none. */
export const IPCC_FIRE_EF_SD: Record<Exclude<Cover, 'peat'>, { co2: number; ch4: number }> = {
  tropicalForest: { co2: 90, ch4: 2.0 },
  savanna: { co2: 95, ch4: 0.9 },
  agriculture: { co2: 177, ch4: 0 },
};

/**
 * How this method compared with GFED (docs/emissions-crosscheck.md, data/validation/emissions-crosscheck.json,
 * run 24 Oct 2026, VIIRS S-NPP only, 12 h holds): context for reading the number, not a correction.
 */
export const GFED_CROSSCHECK = {
  /** Pooled top-5 cells per season, dry matter, this method / GFED4.1s: 2023, 2019, 2015. */
  gfed4Pooled: [1.01, 1.2, 3.03] as const,
  /** Geometric mean and range of the 15 per-cell ratios. */
  gfed4CellGeoMean: 1.57,
  gfed4CellRange: [0.62, 3.95] as const,
  /** All Indonesia, whole year, CO2, this method / GFED5.1 region EQAS (2015, 2019, 2023). */
  gfed5Year: [1.47, 1.56] as const,
  doc: 'docs/emissions-crosscheck.md',
};

/** A pass holds until the next one for at most this long: each VIIRS platform revisits within about 12 h. */
export const MAX_HOLD_H = 12;
export const OBS_WINDOW_H = 48;

/**
 * Cover under a detection. A VIIRS pixel is ~375 m, so one that lands on a road, canal or
 * settlement cell is counted as the most common burnable fuel around it.
 */
export function coverAt(l: Landscape, x: number, y: number): Cover {
  const cx = Math.min(l.w - 1, Math.max(0, Math.round(x))), cy = Math.min(l.h - 1, Math.max(0, Math.round(y)));
  const own = fuelOf(l.fuel[cy * l.w + cx]);
  if (own.burnable) return coverOf(own.id);
  const count = new Map<FuelId, number>();
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= l.w || ny >= l.h) continue;
    const f = fuelOf(l.fuel[ny * l.w + nx]);
    if (f.burnable) count.set(f.id, (count.get(f.id) ?? 0) + 1);
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return coverOf(top ? top[0] : own.id);
}

export function coverOf(fuel: FuelId): Cover {
  if (ON_PEAT.has(fuel)) return 'peat';
  if (fuel === 'plantation') return 'tropicalForest';
  if (fuel === 'agri') return 'agriculture';
  return 'savanna';
}

/** t CO2e per t dry matter. Peat uses the editable rates so it matches the forecast number. */
export function tco2ePerTdm(c: Cover, r: Rates): number {
  if (c === 'peat') return (r.peatCo2cGkg * CO2_PER_C + r.peatCh4Gkg * r.ch4Gwp100) / 1000;
  const e = IPCC_FIRE_EF[c];
  return (e.co2 + e.ch4 * r.ch4Gwp100) / 1000;
}

export interface ObservedEmissions {
  tco2e: number;
  /** Fire radiative energy, MJ. */
  freMJ: number;
  dryMatterT: number;
  detections: number;
  passes: number;
  windowH: number;
  /** Share of the energy seen on peat soil, 0..1. */
  peatShare: number;
  /** Monte Carlo over the GFAS conversion (and holding rule) and the emission factors. Always set by observedEmissions. */
  range?: Quantiles;
}

const OBS_SEED = 0x0b5e7f2b;

/**
 * Monte Carlo of the satellite number: one log-normal multiplier on every β per draw (SD of ln =
 * gfasBetaLnSd, centred on the point value: the cross-check spread is in ratio space), peat
 * emission factors as in the forecast (carbon.ts), other covers with the IPCC 2006 SDs. Normals
 * clamped at 0. Deterministic: counter-based draws with a fixed seed.
 */
export function observedRange(fre: Record<Cover, number>, r: Rates, n = 2000): Quantiles {
  const lnSd = r.gfasBetaLnSd ?? DEFAULT_RATES.gfasBetaLnSd!;
  const co2Sd = r.peatCo2cRelSd ?? DEFAULT_RATES.peatCo2cRelSd!;
  const ch4Sd = r.peatCh4RelSd ?? DEFAULT_RATES.peatCh4RelSd!;
  const covers = Object.keys(fre) as Cover[];
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const beta = DET1.exp(lnSd * normalDraw(OBS_SEED, i, 0));
    let t = 0;
    covers.forEach((c, j) => {
      if (fre[c] <= 0) return;
      const dm = (fre[c] * GFAS_BETA[c] * beta) / 1000;
      let co2: number, ch4: number;
      if (c === 'peat') {
        co2 = Math.max(0, r.peatCo2cGkg * (1 + co2Sd * normalDraw(OBS_SEED, i, 1))) * CO2_PER_C;
        ch4 = Math.max(0, r.peatCh4Gkg * (1 + ch4Sd * normalDraw(OBS_SEED, i, 2)));
      } else {
        const e = IPCC_FIRE_EF[c], sd = IPCC_FIRE_EF_SD[c];
        co2 = Math.max(0, e.co2 + sd.co2 * normalDraw(OBS_SEED, i, 3 + 2 * j));
        ch4 = Math.max(0, e.ch4 + sd.ch4 * normalDraw(OBS_SEED, i, 4 + 2 * j));
      }
      t += (dm * (co2 + ch4 * r.ch4Gwp100)) / 1000;
    });
    xs[i] = t;
  }
  return quantilesOf(xs);
}

/** The moment a scenario's observations end: the hindcast start, else when the data was fetched. */
export function scenarioNow(scn: Scenario): number {
  if (scn.hindcast) return Date.parse(scn.hindcast.t0);
  if (scn.provenance.fetchedAt) return Date.parse(scn.provenance.fetchedAt);
  const last = (scn.hotspots ?? []).map((h) => Date.parse(h.acquired)).filter(isFinite);
  return last.length ? Math.max(...last) : Date.now();
}

/** Emissions seen by satellite in the `windowH` hours before `nowMs`, or null without detections. */
export function observedEmissions(l: Landscape, hotspots: Hotspot[], nowMs: number, rates: Rates, windowH = OBS_WINDOW_H): ObservedEmissions | null {
  const since = nowMs - windowH * 3.6e6;
  const inBox = (h: Hotspot) => h.x >= -0.5 && h.y >= -0.5 && h.x < l.w - 0.5 && h.y < l.h - 0.5;
  const used = hotspots.filter((h) => isFinite(h.frp) && h.frp > 0 && inBox(h)).map((h) => ({ h, t: Date.parse(h.acquired) })).filter(({ t }) => t > since && t <= nowMs);
  if (used.length === 0) return null;

  // One pass = one satellite within a 10-minute bin; FRP sums over its pixels.
  const passes = new Map<string, { t: number; mw: Record<Cover, number> }>();
  for (const { h, t } of used) {
    const key = `${h.satellite}:${Math.floor(t / 6e5)}`;
    let p = passes.get(key);
    if (!p) { p = { t, mw: { peat: 0, tropicalForest: 0, savanna: 0, agriculture: 0 } }; passes.set(key, p); }
    p.t = Math.min(p.t, t);
    p.mw[coverAt(l, h.x, h.y)] += h.frp;
  }
  const seq = [...passes.values()].sort((a, b) => a.t - b.t);
  const fre: Record<Cover, number> = { peat: 0, tropicalForest: 0, savanna: 0, agriculture: 0 };
  for (let i = 0; i < seq.length; i++) {
    const next = i + 1 < seq.length ? seq[i + 1].t : nowMs;
    const holdS = Math.max(0, Math.min(MAX_HOLD_H * 3.6e6, next - seq[i].t)) / 1000;
    for (const c of Object.keys(fre) as Cover[]) fre[c] += seq[i].mw[c] * holdS; // MW × s = MJ
  }
  let freMJ = 0, dm = 0, tco2e = 0;
  for (const c of Object.keys(fre) as Cover[]) {
    const t = (fre[c] * GFAS_BETA[c]) / 1000;
    freMJ += fre[c]; dm += t; tco2e += t * tco2ePerTdm(c, rates);
  }
  return { tco2e, freMJ, dryMatterT: dm, detections: used.length, passes: seq.length, windowH, peatShare: freMJ > 0 ? fre.peat / freMJ : 0, range: observedRange(fre, rates) };
}
