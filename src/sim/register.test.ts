import { describe, expect, it } from 'vitest';
import type { HindcastScore } from './hindcast';
import { FIRMS_LATENCY_H, cellOf, dueAt, observedInWindow, summarize, type RegisterEntry } from './register';
import type { Landscape } from './types';

const l = { w: 64, h: 64, cellM: 100, geo: { north: 1, south: 0, west: 100, east: 101 } } as Landscape;
const det = (acquired: string, lat = 0.5, lon = 100.5) => ({ lat, lon, frp: 1, confidence: 'n', acquired, satellite: 'N' });
const e = { issuedAt: '2026-10-21T00:00:00.000Z', windowH: 24 };

describe('forecast register', () => {
  it('places detections on the forecast grid', () => {
    expect(cellOf(l, 1, 100)).toEqual({ x: -0.5, y: -0.5 });
    expect(cellOf(l, 0.5, 100.5)).toEqual({ x: 31.5, y: 31.5 });
  });

  it('scores only detections after the forecast was sealed and inside the window and the box', () => {
    const obs = observedInWindow(l, e, [
      det('2026-10-20T23:59:00Z'), // before sealing: known, not a forecast target
      det('2026-10-21T06:00:00Z'),
      det('2026-10-22T00:00:00Z'), // last instant of the window counts
      det('2026-10-22T00:01:00Z'),
      det('2026-10-21T06:00:00Z', 5, 100.5), // outside the box
    ]);
    expect(obs.map((o) => o.acquired)).toEqual(['2026-10-21T06:00:00Z', '2026-10-22T00:00:00Z']);
  });

  it('waits for FIRMS latency before a forecast is due', () => {
    expect(dueAt(e)).toBe(Date.parse(e.issuedAt) + (24 + FIRMS_LATENCY_H) * 3.6e6);
  });

  it('pools scores from hits, misses and false alarms, ignoring unscored forecasts', () => {
    const sc = (hits: number, misses: number, falseAlarms: number, dCsi: number) => ({
      scoredAt: '', reproduced: true, detections: 0,
      result: { hits, misses, falseAlarms, predicted: hits + falseAlarms, distance: { csi: dCsi } } as unknown as HindcastScore,
    });
    const entries = [{ score: sc(2, 1, 1, 0.5) }, { score: sc(0, 0, 4, 0) }, {}] as RegisterEntry[];
    const s = summarize(entries);
    expect(s).toMatchObject({ issued: 3, scored: 2, hits: 2, observed: 3, predicted: 7 });
    expect(s.csi).toBeCloseTo(2 / 8);
    expect(s.distanceCsi).toBeCloseTo((0.5 * 4) / 8);
  });
});
