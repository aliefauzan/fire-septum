import { describe, expect, it } from 'vitest';
import type { ForecastScore } from './forecast';
import { boardRows, leaderboard, pending, pool, skillOverTime, type BoardIndex, type BoardRegisterItem, type BoardSubmissionItem } from './scoreboard';

const sc = (o: Partial<ForecastScore> & { hits: number; misses: number; falseAlarms: number; candidates: number; brier: number }): ForecastScore => ({
  block: 4, observed: o.hits + o.misses, predicted: o.hits + o.falseAlarms, pod: 0, far: 0, csi: 0, brierSkill: 0,
  distance: { csi: 0, pod: 0, far: 0 }, newFires: 0, reachKm: 3, detections: 0, ...o,
});

const reg = (hash: string, issuedAt: string, lat: number, models?: Record<string, ForecastScore>): BoardRegisterItem => ({
  hash, issuedAt, lat, lon: 112, windowH: 24, rule: 'r', receipt: {} as BoardRegisterItem['receipt'],
  ...(models ? { score: { scoredAt: issuedAt, reproduced: true, detections: 0, result: models['fire-septum-ca'], models } } : {}),
});

describe('scoreboard pooling', () => {
  const a = { 'fire-septum-ca': sc({ hits: 2, misses: 2, falseAlarms: 4, candidates: 100, brier: 0.1 }), distance: sc({ hits: 1, misses: 3, falseAlarms: 1, candidates: 100, brier: 0.05 }), climatology: sc({ hits: 0, misses: 4, falseAlarms: 0, candidates: 100, brier: 0.04 }) };
  const b = { 'fire-septum-ca': sc({ hits: 0, misses: 0, falseAlarms: 6, candidates: 50, brier: 0.2 }), distance: sc({ hits: 0, misses: 0, falseAlarms: 3, candidates: 50, brier: 0.1 }), climatology: sc({ hits: 0, misses: 0, falseAlarms: 0, candidates: 50, brier: 0.02 }) };
  const sub: BoardSubmissionItem = {
    sha256: 's1', receivedAt: '2026-10-21T10:05:00Z',
    forecast: { schema: 'fireseptum.forecast.v1', model: { id: 'gbm', name: 'g', version: '1' }, issuedAt: '2026-10-21T10:00:00Z', windowH: 24, grid: 'blocks400m', box: { lat: -3, lon: 112 }, probabilities: [] },
    // Same box and hour as the second register entry: its references must not be counted twice.
    score: { scoredAt: 'x', boxes: [{ box: { lat: -3, lon: 112 }, models: { gbm: sc({ hits: 0, misses: 0, falseAlarms: 0, candidates: 50, brier: 0.01 }), distance: b.distance, climatology: b.climatology } }] },
  };
  const ix: BoardIndex = {
    generatedAt: 'now',
    register: [reg('r1', '2026-10-20T16:00:00Z', -2, a), reg('r2', '2026-10-21T10:00:00Z', -3, b), reg('r3', '2026-10-23T10:00:00Z', -4)],
    submissions: [sub, { ...sub, sha256: 's2', score: undefined, forecast: { ...sub.forecast, issuedAt: '2026-10-24T09:00:00Z' } }],
  };
  const rows = boardRows(ix);

  it('counts every (model, box) once', () => {
    expect(rows.filter((r) => r.model === 'distance')).toHaveLength(2);
    expect(rows.filter((r) => r.model === 'gbm')).toHaveLength(1);
    expect(rows.filter((r) => r.model === 'fire-septum-ca')).toHaveLength(2);
  });

  it('pools CSI from summed counts, Brier by block, and skill against the pooled base rate', () => {
    const ca = pool('fire-septum-ca', rows.filter((r) => r.model === 'fire-septum-ca'));
    expect([ca.boxes, ca.boxesWithFire, ca.hits, ca.misses, ca.falseAlarms, ca.candidates]).toEqual([2, 1, 2, 2, 10, 150]);
    expect(ca.csi).toBeCloseTo(2 / 14, 12);
    expect(ca.pod).toBeCloseTo(0.5, 12);
    expect(ca.brier).toBeCloseTo((0.1 * 100 + 0.2 * 50) / 150, 12);
    const r = 4 / 150, ref = 4 * (1 - r) ** 2 + 146 * r ** 2;
    expect(ca.brierSkill).toBeCloseTo(1 - 20 / ref, 12);
    const board = leaderboard(rows);
    expect(board.map((s) => s.model)).toEqual(['fire-septum-ca', 'distance', 'gbm', 'climatology']);
    expect(board.find((s) => s.model === 'climatology')!.brierSkill).toBeCloseTo(1 - 5 / ref, 12);
  });

  it('accumulates skill by day and lists what is still due', () => {
    const t = skillOverTime(rows);
    expect(t['fire-septum-ca'].map((p) => [p.day, p.boxes])).toEqual([['2026-10-20', 1], ['2026-10-21', 2]]);
    expect(t['fire-septum-ca'][0].csi).toBeCloseTo(2 / 8, 12);
    expect(t.gbm.map((p) => p.day)).toEqual(['2026-10-21']);
    const p = pending(ix);
    expect(p.map((x) => [x.record, x.model])).toEqual([['r3', 'fire-septum-ca'], ['s2', 'gbm']]);
    expect(p[0].dueAt).toBe(Date.parse('2026-10-24T16:00:00Z'));
  });
});
