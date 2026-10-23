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

export function scoreHindcast(
  l: Landscape, init: FireState, e: EnsembleResult, observed: Pick<Hotspot, 'x' | 'y'>[], at: number,
  opts: { block?: number; reachKm?: number } = {},
): HindcastScore {
  const B = opts.block ?? 4;
  const reachKm = opts.reachKm ?? 3;
  const bw = Math.ceil(l.w / B), bh = Math.ceil(l.h / B), nb = bw * bh;
  const blockOf = (x: number, y: number) => Math.floor(y / B) * bw + Math.floor(x / B);

  const fireAtT0 = new Uint8Array(nb);
  for (let k = 0; k < init.state.length; k++) {
    const s = init.state[k];
    if (s === Cell.Burning || s === Cell.Burned || s === Cell.Extinguished) fireAtT0[blockOf(k % l.w, Math.floor(k / l.w))] = 1;
  }

  // Distance (km) from each block to the nearest block on fire at t0.
  const blockKm = (B * l.cellM) / 1000;
  const dist = new Float32Array(nb).fill(Infinity);
  const fireBlocks: number[] = [];
  for (let b = 0; b < nb; b++) if (fireAtT0[b]) fireBlocks.push(b);
  for (let b = 0; b < nb; b++) {
    const bx = b % bw, by = Math.floor(b / bw);
    for (const f of fireBlocks) dist[b] = Math.min(dist[b], Math.hypot(bx - (f % bw), by - Math.floor(f / bw)) * blockKm);
  }

  const obs = new Uint8Array(nb);
  let newFires = 0;
  const seen = new Set<number>();
  for (const h of observed) {
    const x = Math.round(h.x), y = Math.round(h.y);
    if (x < 0 || y < 0 || x >= l.w || y >= l.h) continue;
    const b = blockOf(x, y);
    if (fireAtT0[b] || seen.has(b)) continue;
    seen.add(b);
    if (dist[b] > reachKm) newFires++;
    else obs[b] = 1;
  }

  // Share of runs in which each block gets new fire by `at`.
  const p = new Float32Array(nb);
  const hit = new Uint8Array(nb);
  for (const r of e.runs) {
    hit.fill(0);
    for (let k = 0; k < r.ign.length; k++) if (r.ign[k] > 0 && r.ign[k] <= at) hit[blockOf(k % l.w, Math.floor(k / l.w))] = 1;
    for (let b = 0; b < nb; b++) p[b] += hit[b];
  }
  for (let b = 0; b < nb; b++) p[b] /= Math.max(1, e.runs.length);

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

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
