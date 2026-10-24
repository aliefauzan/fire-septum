import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DET1 } from './detmath';
import { sha256 } from './determinism';

// Relative error against the engine's own Math, which is itself within ~1 ulp of exact.
const rel = (a: number, b: number) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(b), 1e-300));
const grid = (lo: number, hi: number, n: number) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * (i + 0.37)) / n);

describe('deterministic math (det1)', () => {
  it('exp and log agree with Math to ~1e-15 over the ranges the model uses', () => {
    for (const x of [...grid(-40, 40, 4001), 0, 1e-12, -1e-12, 0.5, -0.5, 700, -700]) expect(rel(DET1.exp(x), Math.exp(x))).toBeLessThan(4e-16 * 8);
    for (const x of [...grid(1e-6, 50, 4001), 1, 2, 0.1, 1e-300, 5e-324, 1e300]) expect(rel(DET1.log(x), Math.log(x)) < 3e-15 || Math.abs(DET1.log(x) - Math.log(x)) < 1e-15).toBe(true);
    expect(DET1.exp(0)).toBe(1);
    expect(DET1.log(1)).toBe(0);
    expect(DET1.exp(1000)).toBe(Infinity);
    expect(DET1.log(0)).toBe(-Infinity);
    expect(Number.isNaN(DET1.log(-1))).toBe(true);
  });

  it('sin, cos, atan, atan2 agree with Math to ~1e-15 absolute', () => {
    for (const x of grid(-20, 20, 8001)) {
      expect(Math.abs(DET1.sin(x) - Math.sin(x))).toBeLessThan(2e-15);
      expect(Math.abs(DET1.cos(x) - Math.cos(x))).toBeLessThan(2e-15);
      expect(Math.abs(DET1.atan(x) - Math.atan(x))).toBeLessThan(1e-15);
    }
    for (const y of grid(-3, 3, 61)) for (const x of grid(-3, 3, 61)) expect(Math.abs(DET1.atan2(y, x) - Math.atan2(y, x))).toBeLessThan(2e-15);
    expect(DET1.atan2(0, -1)).toBe(Math.PI);
    expect(DET1.atan2(1, 0)).toBe(Math.PI / 2);
    expect(DET1.atan2(-1, 0)).toBe(-Math.PI / 2);
    expect(DET1.atan2(0, 1)).toBe(0);
  });

  it('pow and hypot', () => {
    for (const x of grid(0.01, 5e4, 2001)) expect(rel(DET1.pow(x, 0.46), Math.pow(x, 0.46))).toBeLessThan(5e-15);
    expect(DET1.pow(0, 0.46)).toBe(0);
    expect(DET1.pow(-2, 3)).toBeCloseTo(-8, 12);
    expect(DET1.hypot(3, 4)).toBe(5);
  });
});

describe('plain-JS SHA-256 used by the cross-engine check', () => {
  it('matches node:crypto on empty, short and multi-block input', () => {
    for (const n of [0, 3, 55, 56, 63, 64, 65, 1000, 100_003]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
      expect(sha256(b)).toBe(createHash('sha256').update(b).digest('hex'));
    }
  });
});
