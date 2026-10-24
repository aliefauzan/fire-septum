// Hindcast scoring: how well did a forecast made at t0 match what satellites saw next?
//
// VIIRS pixels are ~375 m, so the grid is compared in blocks of 4 × 4 cells (400 m).
// Only NEW fire counts: blocks already burning or burned at t0 are left out, since any
// forecast "predicts" fire that is already there. A block is observed if a detection in
// (t0, t0 + window] falls in it, and forecast if it ignites in at least half the runs.
//
// New detections far from any fire at t0 are fresh ignitions (often people clearing
// land), which no spread model can predict; they are counted but not scored.
//
// The model is compared with a distance-only forecast that marks the same number of
// blocks, picked by closeness to the fire. That shows whether wind, slope and fuel add
// anything beyond "fire grows outward".
import { Cell, type EnsembleResult, type FireState, type Hotspot, type Landscape } from './types';

export interface HindcastScore {
  /** Block edge in cells. */
  block: number;
  /** Blocks that could get new fire (not burning or burned at t0, within reach). */
  candidates: number;
  observed: number;
  predicted: number;
  hits: number;
  misses: number;
  falseAlarms: number;
  /** Probability of detection, false alarm ratio, critical success index. */
  pod: number;
  far: number;
  csi: number;
  /** Brier score of the per-block probabilities, and its skill against the observed base rate. */
  brier: number;
  brierSkill: number;
  /** Same metrics for the distance-only forecast of equal size. */
  distance: { csi: number; pod: number; far: number };
  /** New detections farther than `reachKm` from any fire at t0 (not scored). */
  newFires: number;
  reachKm: number;
}

/** Block grid of a cell grid: blocks of `block` × `block` cells, row-major from the north-west corner. */
export interface BlockGrid {
  /** Cell grid size and cell edge (m). */
  w: number;
  h: number;
  cellM: number;
  /** Block edge in cells. */
  block: number;
}

const blocksOf = (g: BlockGrid) => {
  const bw = Math.ceil(g.w / g.block), bh = Math.ceil(g.h / g.block);
  return { bw, bh, nb: bw * bh, blockOf: (x: number, y: number) => Math.floor(y / g.block) * bw + Math.floor(x / g.block) };
};

/** Blocks with any cell burning, burned or extinguished at t0 (1) — the "fire at t0" mask. */
export function blockFireMask(l: Landscape, init: FireState, block = 4): Uint8Array {
  const { nb, blockOf } = blocksOf({ w: l.w, h: l.h, cellM: l.cellM, block });
  const fireAtT0 = new Uint8Array(nb);
  for (let k = 0; k < init.state.length; k++) {
    const s = init.state[k];
    if (s === Cell.Burning || s === Cell.Burned || s === Cell.Extinguished) fireAtT0[blockOf(k % l.w, Math.floor(k / l.w))] = 1;
  }
  return fireAtT0;
}

/** Share of runs in which each block gets new fire by `at` (hours). */
export function ensembleBlockProbabilities(l: Landscape, e: EnsembleResult, at: number, block = 4): Float32Array {
  const { nb, blockOf } = blocksOf({ w: l.w, h: l.h, cellM: l.cellM, block });
  const p = new Float32Array(nb);
  const hit = new Uint8Array(nb);
  for (const r of e.runs) {
    hit.fill(0);
    for (let k = 0; k < r.ign.length; k++) if (r.ign[k] > 0 && r.ign[k] <= at) hit[blockOf(k % l.w, Math.floor(k / l.w))] = 1;
    for (let b = 0; b < nb; b++) p[b] += hit[b];
  }
  for (let b = 0; b < nb; b++) p[b] /= Math.max(1, e.runs.length);
  return p;
}

/** Distance (km) from each block centre to the nearest block on fire at t0 (Infinity when there is none). */
export function blockDistanceKm(g: BlockGrid, fireAtT0: ArrayLike<number>): Float32Array {
  const { bw, nb } = blocksOf(g);
  const blockKm = (g.block * g.cellM) / 1000;
  const dist = new Float32Array(nb).fill(Infinity);
  const fireBlocks: number[] = [];
  for (let b = 0; b < nb; b++) if (fireAtT0[b]) fireBlocks.push(b);
  for (let b = 0; b < nb; b++) {
    const bx = b % bw, by = Math.floor(b / bw);
    for (const f of fireBlocks) dist[b] = Math.min(dist[b], Math.hypot(bx - (f % bw), by - Math.floor(f / bw)) * blockKm);
  }
  return dist;
}

/**
 * Blocks with new observed fire: a detection in a block not on fire at t0 and within `reachKm` of
 * it (1), and the count of new-fire blocks beyond the reach (fresh ignitions, not scored). The
 * label rule of scoreBlocks, also used to label the forecaster's training data (scripts/ml/extract.ts).
 */
export function observedBlocks(
  g: BlockGrid, fireAtT0: ArrayLike<number>, observed: Pick<Hotspot, 'x' | 'y'>[],
  opts: { reachKm?: number; dist?: Float32Array } = {},
): { obs: Uint8Array; newFires: number } {
  const reachKm = opts.reachKm ?? 3;
  const { nb, blockOf } = blocksOf(g);
  const dist = opts.dist ?? blockDistanceKm(g, fireAtT0);
  const obs = new Uint8Array(nb);
  let newFires = 0;
  const seen = new Set<number>();
  for (const h of observed) {
    const x = Math.round(h.x), y = Math.round(h.y);
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
    const b = blockOf(x, y);
    if (fireAtT0[b] || seen.has(b)) continue;
    seen.add(b);
    if (dist[b] > reachKm) newFires++;
    else obs[b] = 1;
  }
  return { obs, newFires };
}

/**
 * The scoring core: per-block probabilities of new fire against the detections of the window.
 * Every forecast, the cellular automaton's and any submitted model's, is scored by this one
 * function (src/sim/forecast.ts scoreForecast). `observed` are detections in the window in
 * cell coordinates (cell centres at integers).
 */
export function scoreBlocks(
  g: BlockGrid, p: ArrayLike<number>, fireAtT0: ArrayLike<number>, observed: Pick<Hotspot, 'x' | 'y'>[],
  opts: { reachKm?: number } = {},
): HindcastScore {
  const B = g.block;
  const reachKm = opts.reachKm ?? 3;
  const { nb } = blocksOf(g);
  const dist = blockDistanceKm(g, fireAtT0);
  const { obs, newFires } = observedBlocks(g, fireAtT0, observed, { reachKm, dist });

  const cand: number[] = [];
  for (let b = 0; b < nb; b++) if (!fireAtT0[b] && dist[b] <= reachKm) cand.push(b);

  const confusion = (pred: (b: number) => boolean) => {
    let hits = 0, misses = 0, fa = 0;
    for (const b of cand) {
      const f = pred(b);
      if (f && obs[b]) hits++; else if (!f && obs[b]) misses++; else if (f) fa++;
    }
    return { hits, misses, fa, csi: ratio(hits, hits + misses + fa), pod: ratio(hits, hits + misses), far: ratio(fa, hits + fa) };
  };

  const m = confusion((b) => p[b] >= 0.5);
  const predicted = m.hits + m.fa;
  // Distance-only forecast with the same number of blocks (at least one).
  const nearest = new Set([...cand].sort((a, b) => dist[a] - dist[b] || a - b).slice(0, Math.max(1, predicted)));
  const d = confusion((b) => nearest.has(b));

  const observedN = m.hits + m.misses;
  const rate = observedN / Math.max(1, cand.length);
  let brier = 0;
  for (const b of cand) brier += (p[b] - obs[b]) ** 2;
  brier /= Math.max(1, cand.length);
  const ref = rate * (1 - rate);

  return {
    block: B, candidates: cand.length, observed: observedN, predicted,
    hits: m.hits, misses: m.misses, falseAlarms: m.fa, pod: m.pod, far: m.far, csi: m.csi,
    brier, brierSkill: ref > 0 ? 1 - brier / ref : 0,
    distance: { csi: d.csi, pod: d.pod, far: d.far },
    newFires, reachKm,
  };
}

/** Score an ensemble forecast made at t0 (the cellular automaton) against the detections of (t0, t0 + at]. */
export function scoreHindcast(
  l: Landscape, init: FireState, e: EnsembleResult, observed: Pick<Hotspot, 'x' | 'y'>[], at: number,
  opts: { block?: number; reachKm?: number } = {},
): HindcastScore {
  const B = opts.block ?? 4;
  return scoreBlocks({ w: l.w, h: l.h, cellM: l.cellM, block: B }, ensembleBlockProbabilities(l, e, at, B), blockFireMask(l, init, B), observed, { reachKm: opts.reachKm });
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
