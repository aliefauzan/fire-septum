import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FUEL_INDEX } from './fuels';
import { FEATURE_NAMES } from './features';
import { validateForecast } from './forecast';
import { gbmBoxForecast, gbmForecast, gbmForecastAll, gbmPredictRow, isotonic, parseGbmModel, type Lead } from './gbm';
import { emptyState, igniteDisc } from './landscape';
import type { Landscape } from './types';

const ROOT = join(__dirname, '..', '..');
const text = readFileSync(join(ROOT, 'public', 'data', 'forecaster', 'gbm-v1.json'), 'utf8');
const model = parseGbmModel(JSON.parse(text));
const fixture = JSON.parse(readFileSync(join(__dirname, 'gbm.fixture.json'), 'utf8')) as {
  modelSha256: string; features: string[]; rows: (number | null)[][];
  leads: Record<string, { raw: number[]; p: number[]; calibrated: number[] }>;
};

describe('GBM forecaster: parity with scikit-learn', () => {
  it('fixture belongs to the shipped model', () => {
    expect(createHash('sha256').update(text.trimEnd()).digest('hex')).toBe(fixture.modelSha256);
    expect(fixture.features).toEqual(model.features);
    expect(fixture.rows.length).toBeGreaterThanOrEqual(200);
  });

  for (const lead of [1, 2, 3] as Lead[]) {
    it(`lead ${lead}: raw score, probability and isotonic value to 1e-12`, () => {
      const ref = fixture.leads[String(lead)];
      let worst = 0;
      fixture.rows.forEach((r, i) => {
        const row = r.map((v) => (v === null ? NaN : v));
        const got = gbmPredictRow(model, lead, row);
        worst = Math.max(worst, Math.abs(got.raw - ref.raw[i]), Math.abs(got.p - ref.p[i]), Math.abs(got.calibrated - ref.calibrated[i]));
      });
      expect(worst).toBeLessThanOrEqual(1e-12);
    });
  }

  it('isotonic clips and interpolates', () => {
    const iso = { x: [0.1, 0.2, 0.4], y: [0, 0.5, 0.9] };
    expect(isotonic(iso, 0)).toBe(0);
    expect(isotonic(iso, 1)).toBe(0.9);
    expect(isotonic(iso, 0.15)).toBeCloseTo(0.25, 15);
    expect(isotonic(iso, 0.3)).toBeCloseTo(0.7, 15);
  });
});

describe('gbmForecast', () => {
  const w = 64, h = 64;
  const l = { w, h, cellM: 100, fuel: new Uint8Array(w * h).fill(FUEL_INDEX.shrub), elev: new Float32Array(w * h).fill(8), zoneOf: new Uint8Array(w * h), zones: [] } as unknown as Landscape;
  const init = emptyState(l);
  igniteDisc(l, init, 31, 31, 1.9, 0.5);
  const t0 = '2026-10-20T16:00:00Z';
  const hotspots = [{ x: 31, y: 31, acquired: '2026-10-20T06:00:00Z', frp: 10, lat: 0, lon: 0, confidence: 'n', satellite: 'N' }];
  const scn = { landscape: l, init, hotspots };

  it('gives 256 probabilities, zero on fire at t0, higher next to the fire', () => {
    const f = gbmForecast(scn, null, { model, t0 });
    expect(f.lead).toBe(1);
    expect(f.probabilities).toHaveLength(256);
    for (let b = 0; b < 256; b++) if (f.fireAtT0[b]) expect(f.probabilities[b]).toBe(0);
    const near = f.probabilities[7 * 16 + 9], far = f.probabilities[0];
    expect(near).toBeGreaterThan(far);
    expect(Array.from(f.probabilities).every((p) => p >= 0 && p <= 1)).toBe(true);
  });

  it('is deterministic and agrees between single and multi-lead calls', () => {
    const all = gbmForecastAll(scn, null, { model, t0 });
    expect(all.map((x) => x.lead)).toEqual([1, 2, 3]);
    expect(Array.from(gbmForecast(scn, null, { model, t0, lead: 2 }).probabilities)).toEqual(Array.from(all[1].probabilities));
  });

  it('needs t0', () => {
    expect(() => gbmForecast(scn, null, { model })).toThrow(/t0/);
  });

  it('makes a valid forecast-v1 document', () => {
    const f = gbmForecast(scn, null, { model, t0 });
    expect(validateForecast(gbmBoxForecast(model, { lat: -2.9, lon: 112.1 }, t0, f.probabilities))).toEqual([]);
  });

  it('only uses features that features.ts computes', () => {
    expect(model.features.every((f) => FEATURE_NAMES.includes(f))).toBe(true);
  });
});
