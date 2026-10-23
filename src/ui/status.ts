import { zoneThreshold } from '../sim/ensemble';
import type { EnsembleResult, Landscape, ZoneStats } from '../sim/types';

export type ZoneStatus = 'burning' | 'likely' | 'at-risk' | 'lower-risk' | 'not-reached';

export const STATUS_LABEL: Record<ZoneStatus, string> = {
  burning: 'Burning',
  likely: 'Likely to ignite',
  'at-risk': 'At risk',
  'lower-risk': 'Lower risk',
  'not-reached': 'Not reached',
};

/** Never returns "safe": the best a forecast can say is that no simulated run reached the zone. */
export function zoneStatus(z: ZoneStats): ZoneStatus {
  if (z.initiallyBurning) return 'burning';
  if (z.pIgnite >= 0.6) return 'likely';
  if (z.pIgnite >= 0.2) return 'at-risk';
  if (z.pIgnite > 0) return 'lower-risk';
  return 'not-reached';
}

/** Protected = materially lower risk or materially later arrival than the no-action baseline. */
export function isProtected(base: ZoneStats, plan: ZoneStats): boolean {
  if (base.initiallyBurning) return false;
  const dp = base.pIgnite - plan.pIgnite;
  const delay = base.etaMedian !== null && (plan.etaMedian === null || plan.etaMedian - base.etaMedian >= 3);
  return dp >= 0.15 || (base.pIgnite >= 0.2 && delay);
}

/** Fraction of runs in which zone zi has ignited (≥ threshold new cells) by hour t. */
export function zoneProbAt(e: EnsembleResult, l: Landscape, zi: number, t: number): number {
  const cells: number[] = [];
  for (let k = 0; k < l.zoneOf.length; k++) if (l.zoneOf[k] === zi) cells.push(k);
  const thr = zoneThreshold(cells.length);
  let hit = 0;
  for (const r of e.runs) {
    let c = 0;
    for (const k of cells) if (r.ign[k] > 0 && r.ign[k] <= t) { if (++c >= thr) break; }
    if (c >= thr) hit++;
  }
  return hit / Math.max(1, e.runs.length);
}

export const fmtPct = (p: number) => `${Math.round(p * 100)}%`;
export const fmtHour = (h: number | null) => (h === null ? '—' : `+${Number.isInteger(h) ? h : h.toFixed(1)} h`);
export const fmtHa = (ha: number) => Math.round(ha).toLocaleString('en-US');
