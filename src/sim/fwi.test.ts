import { describe, expect, it } from 'vitest';
import fixture from './fwi.fixture.json';
import { dayLengthDc, dayLengthDmc, fwiDay, fwiSeries, FWI_START } from './fwi';

const KEYS = ['ffmc', 'dmc', 'dc', 'isi', 'bui', 'fwi', 'dsr'] as const;

describe('FWI System, TypeScript port equals the Python reference (ml/forecast/fwi.py)', () => {
  for (const s of fixture.series) {
    it(`${s.name}: ${s.days.length} days`, () => {
      const out = fwiSeries(s.days, s.lat);
      expect(out).toHaveLength(s.expected.length);
      out.forEach((o, i) => {
        for (const k of KEYS) expect(o[k]).toBeCloseTo(s.expected[i][k], 9);
      });
    });
  }

  it('first cffdrs test day matches cffdrs fwi_01 (87.65, 8.545, 19.01, 10.78, 8.49, 10.04)', () => {
    const r = fwiDay(FWI_START, { tempC: 17, rh: 42, windKmh: 25, rainMm: 0, lat: 40, month: 4 });
    expect(r.ffmc).toBeCloseTo(87.65, 1);
    expect(r.dmc).toBeCloseTo(8.545, 2);
    expect(r.dc).toBeCloseTo(19.01, 1);
    expect(r.isi).toBeCloseTo(10.78, 1);
    expect(r.bui).toBeCloseTo(8.49, 1);
    expect(r.fwi).toBeCloseTo(10.04, 1);
  });

  it('uses the equatorial day-length bands over Kalimantan and Sumatra', () => {
    for (const lat of [-6, -4.5, 0, 4.5, 6]) for (let m = 1; m <= 12; m++) {
      expect(dayLengthDmc(lat, m)).toBe(9);
      expect(dayLengthDc(lat, m)).toBe(1.4);
    }
  });
});
