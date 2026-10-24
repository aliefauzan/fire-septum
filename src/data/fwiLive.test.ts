import { describe, expect, it } from 'vitest';
import { fwiSeries } from '../sim/fwi';
import { fwiFromHourly } from './fwiLive';

// Hourly UTC series from 31 Dec 2025 to 10 Jan 2026: rain only in the hour stamped 3 Jan 02:00.
function hourly() {
  const time: string[] = [], t: number[] = [], rh: number[] = [], p: number[] = [], w: number[] = [];
  for (let ms = Date.parse('2025-12-31T00:00:00Z'); ms <= Date.parse('2026-01-10T23:00:00Z'); ms += 3.6e6) {
    const iso = new Date(ms).toISOString().slice(0, 16);
    const h = new Date(ms).getUTCHours();
    time.push(iso); t.push(28 + h / 10); rh.push(70 - h); w.push(8 + h / 4);
    p.push(iso === '2026-01-03T02:00' ? 6 : 0);
  }
  return { time, temperature_2m: t, relative_humidity_2m: rh, precipitation: p, wind_speed_10m: w };
}

describe('live FWI (era5.py rule on Open-Meteo hours)', () => {
  it('runs the daily system from 1 January at 05 UTC with rain24 ending 05 UTC', () => {
    const h = hourly();
    const r = fwiFromHourly(h, -2.5, '2026-01-08', 'test');
    expect(r.date).toBe('2026-01-08');
    // Same inputs by hand: 05 UTC weather, rain on 3 Jan only.
    const days = Array.from({ length: 8 }, (_, i) => ({ tempC: 28.5, rh: 65, windKmh: 9.25, rainMm: i === 2 ? 6 : 0, month: 1 }));
    const want = fwiSeries(days, -2.5).at(-1)!;
    expect(r.values.dc).toBeCloseTo(want.dc, 9);
    expect(r.values.ffmc).toBeCloseTo(want.ffmc, 9);
    expect(r.values.fwi).toBeCloseTo(want.fwi, 9);
    expect(r.values.daysSinceRain).toBe(5);
    expect(r.values.rain24).toBe(0);
  });

  it('stops at the last day the source has', () => {
    const h = hourly();
    const cut = h.time.indexOf('2026-01-06T05:00');
    for (const k of ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'wind_speed_10m'] as const) for (let i = cut; i < h.time.length; i++) (h[k] as (number | null)[])[i] = null;
    expect(fwiFromHourly(h, -2.5, '2026-01-08', 'test').date).toBe('2026-01-05');
  });
});
