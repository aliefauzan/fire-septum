// Counter-based randomness. Every random draw is a pure function of
// (seed, step, cell, slot), so the baseline and the intervention scenario see the
// SAME random numbers for the same event ("common random numbers"). An
// intervention can then only change outcomes through its physical effect, which
// makes paired comparisons far less noisy than independent ensembles.

import type { MathLib } from './detmath';

export function hash4(a: number, b: number, c: number, d: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ b, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16) ^ c, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15) ^ d, 0x165667b1);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Sequential PRNG (mulberry32) for scenario generation and weather perturbation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number, m: Pick<MathLib, 'sqrt' | 'log' | 'cos'> = Math): number {
  const u = Math.max(1e-12, rand());
  const v = rand();
  return m.sqrt(-2 * m.log(u)) * m.cos(2 * Math.PI * v);
}

/** Smooth value noise in [0,1] for synthetic terrain and fuel texture. */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const r = (i: number, j: number) => hash4(seed, i, j, 7);
  const a = r(xi, yi), b = r(xi + 1, yi), c = r(xi, yi + 1), d = r(xi + 1, yi + 1);
  const u = s(xf), v = s(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, seed + o * 101);
    norm += amp;
    x *= 2.03; y *= 2.03; amp *= 0.5;
  }
  return sum / norm;
}
