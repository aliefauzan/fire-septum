// Greenhouse-gas emissions from the simulated burn, IPCC Tier 1 for fires on peat.
//
// 2013 IPCC Wetlands Supplement, Eq. 2.8:  L = A · (M_B · C_f) · G_ef · 10⁻³
// with A = newly burned peat area (ha), M_B·C_f = peat burnt per ha and G_ef per gas
// (see RATE_INFO in doctrine.ts). Only peat-soil cells count. Burning vegetation above
// mineral soil is left out, as are CO, N2O and particulates, so the totals are a
// floor rather than a full inventory.
import { quantile } from './ensemble';
import { ON_PEAT, fuelOf } from './fuels';
import type { Rates } from './doctrine';
import type { EnsembleResult, Landscape } from './types';

/** Mass ratio of CO2 to carbon. */
export const CO2_PER_C = 44 / 12;

/** IPCC 95% confidence interval of peat burnt per ha (Table 2.6), as multipliers on the 353 t mean. */
export const PEAT_BURNT_CI: [number, number] = [170 / 353, 536 / 353];

/** Tonnes CO2-equivalent per hectare of burned peat: CO2 plus CH4 × GWP-100. */
export function tco2ePerHa(r: Pick<Rates, 'peatBurntTdmHa' | 'peatCo2cGkg' | 'peatCh4Gkg' | 'ch4Gwp100'>): number {
  const gPerKg = r.peatCo2cGkg * CO2_PER_C + r.peatCh4Gkg * r.ch4Gwp100;
  return (r.peatBurntTdmHa * gPerKg) / 1000;
}

/** 1 where the cell is on peat soil. */
export function peatMask(l: Landscape): Uint8Array {
  const m = new Uint8Array(l.w * l.h);
  for (let k = 0; k < m.length; k++) m[k] = ON_PEAT.has(fuelOf(l.fuel[k]).id) ? 1 : 0;
  return m;
}

/** Newly burned peat hectares by hour `at`, one value per run (same order as e.runs). */
export function peatHaPerRun(l: Landscape, e: EnsembleResult, at: number): number[] {
  const peat = peatMask(l);
  return e.runs.map((r) => {
    let c = 0;
    for (let k = 0; k < peat.length; k++) if (peat[k] && r.ign[k] > 0 && r.ign[k] <= at) c++;
    return c * e.cellHa;
  });
}

export interface Spread { mean: number; p10: number; p90: number }

const spread = (xs: number[]): Spread => {
  const s = [...xs].sort((a, b) => a - b);
  return { mean: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length), p10: quantile(s, 0.1) || 0, p90: quantile(s, 0.9) || 0 };
};

export interface Emissions {
  /** t CO2e per hectare of burned peat with the current factors. */
  perHa: number;
  /** t CO2e if nothing is done. */
  base: Spread;
  /** t CO2e with the plan, and the paired (same-seed) reduction. Null without a plan. */
  plan: Spread | null;
  avoided: Spread | null;
  /** Multipliers for the IPCC 95% range of peat burnt per ha (burn depth). */
  factorRange: [number, number];
}

/** Emissions by hour `at`. The 10–90% ranges come from the fire spread; `factorRange` from the emission factors. */
export function emissions(l: Landscape, base: EnsembleResult, plan: EnsembleResult | null, rates: Rates, at: number): Emissions {
  const perHa = tco2ePerHa(rates);
  const b = peatHaPerRun(l, base, at).map((ha) => ha * perHa);
  const p = plan ? peatHaPerRun(l, plan, at).map((ha) => ha * perHa) : null;
  return {
    perHa,
    base: spread(b),
    plan: p ? spread(p) : null,
    avoided: p ? spread(b.map((x, i) => x - (p[i] ?? x))) : null,
    factorRange: PEAT_BURNT_CI,
  };
}

/** Round to 2 significant figures for display: the factors do not support more. */
export function fmtTonnes(t: number): string {
  if (Math.abs(t) < 1) return '0';
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(t))) - 1));
  return (Math.round(t / mag) * mag).toLocaleString('en-US');
}
