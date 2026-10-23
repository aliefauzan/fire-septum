import { compileActions, runOnce } from './model';
import type { Action, EnsembleResult, Scenario, SimParams, ZoneStats } from './types';

export const quantile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

export const seedsFor = (runs: number, base = 1) => Array.from({ length: runs }, (_, i) => base + i);

/** Cells that must newly burn before a zone counts as "ignited" (filters single stray embers). */
export const zoneThreshold = (zoneCells: number) => Math.max(3, Math.ceil(zoneCells * 0.01));

export function runEnsemble(
  scn: Scenario,
  actions: Action[],
  params: SimParams,
  seeds: number[] = seedsFor(params.runs),
): EnsembleResult {
  const compiled = compileActions(scn.landscape, actions);
  const runs = seeds.map((seed) => {
    const r = runOnce(scn, compiled, params, seed, { antecedentRainMm: scn.antecedentRainMm });
    return { ign: r.ign, out: r.out, ext: r.ext };
  });
  return summarise(scn, runs, seeds);
}

export function summarise(scn: Scenario, runs: EnsembleResult['runs'], seeds: number[]): EnsembleResult {
  const l = scn.landscape;
  const cellHa = (l.cellM * l.cellM) / 1e4;
  const n = l.w * l.h;
  const burnedHa = runs.map((r) => {
    let c = 0;
    for (let k = 0; k < n; k++) if (r.ign[k] > 0) c++;
    return c * cellHa;
  });

  const zoneStats: ZoneStats[] = l.zones.map((z, zi) => {
    const cells: number[] = [];
    for (let k = 0; k < n; k++) if (l.zoneOf[k] === zi) cells.push(k);
    const thr = zoneThreshold(cells.length);
    const initiallyBurning = cells.some((k) => runs[0]?.ign[k] === 0);
    const etas: number[] = [];
    const burned: number[] = [];
    for (const r of runs) {
      const times: number[] = [];
      for (const k of cells) if (r.ign[k] > 0) times.push(r.ign[k]);
      burned.push(times.length * cellHa);
      if (times.length >= thr) {
        times.sort((a, b) => a - b);
        etas.push(times[thr - 1]);
      }
    }
    etas.sort((a, b) => a - b);
    const bs = [...burned].sort((a, b) => a - b);
    return {
      zoneId: z.id,
      initiallyBurning,
      pIgnite: runs.length ? etas.length / runs.length : 0,
      etaMedian: etas.length ? quantile(etas, 0.5) : null,
      etaP10: etas.length ? quantile(etas, 0.1) : null,
      etaP90: etas.length ? quantile(etas, 0.9) : null,
      burnedHaMean: bs.reduce((a, b) => a + b, 0) / Math.max(1, bs.length),
      burnedHaP10: quantile(bs, 0.1) || 0,
      burnedHaP90: quantile(bs, 0.9) || 0,
    };
  });

  return { runs, burnedHa, zoneStats, horizonH: scn.horizonH, cellHa, seeds };
}

/** Paired (same-seed) difference baseline − plan in burned hectares. */
export function pairedSaving(base: EnsembleResult, plan: EnsembleResult) {
  const d = base.burnedHa.map((b, i) => b - (plan.burnedHa[i] ?? b)).sort((a, b) => a - b);
  return {
    mean: d.reduce((a, b) => a + b, 0) / Math.max(1, d.length),
    p10: quantile(d, 0.1),
    p90: quantile(d, 0.9),
    /** Share of runs where the plan burned less than the baseline. */
    pBetter: d.filter((x) => x > 0.01).length / Math.max(1, d.length),
  };
}

/** Value-weighted expected burned hectares (zone weight × burned ha). */
export function weightedLoss(scn: Scenario, e: EnsembleResult): number {
  return scn.landscape.zones.reduce((acc, z, i) => acc + z.weight * e.zoneStats[i].burnedHaMean, 0);
}

/** Fraction of runs where cell k has ignited by hour t (0..1), for every cell. */
export function burnProbabilityAt(e: EnsembleResult, t: number, n: number): Float32Array {
  const p = new Float32Array(n);
  const R = e.runs.length || 1;
  for (const r of e.runs) for (let k = 0; k < n; k++) if (r.ign[k] !== -1 && r.ign[k] <= t) p[k] += 1;
  for (let k = 0; k < n; k++) p[k] /= R;
  return p;
}
