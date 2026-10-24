import { describe, expect, it } from 'vitest';
import { fuelFromCover, onPeatSoil, worldcoverItem } from '../data/landcover';
import { DEFAULT_RATES } from './doctrine';
import { GFAS_BETA, MAX_HOLD_H, coverAt, coverOf, observedEmissions, tco2ePerTdm } from './frp';
import { FUEL_INDEX, FUEL_LIST, ON_PEAT } from './fuels';
import { sketchScenario } from './scenarios';
import type { Hotspot } from './types';

const T0 = Date.parse('2026-10-18T19:06:00Z');
const at = (hoursBefore: number, x: number, y: number, frp: number, satellite = 'N'): Hotspot => ({
  lat: 0, lon: 0, x, y, frp, confidence: 'n', satellite, acquired: new Date(T0 - hoursBefore * 3.6e6).toISOString(),
});

describe('observed emissions from fire radiative power (GFAS method)', () => {
  const s = sketchScenario();
  const l = s.landscape;
  // A cell on peat soil away from the edge, so the 5 × 5 neighbourhood test has room.
  const peatCell = (() => { for (let k = 0; k < l.fuel.length; k++) { const x = k % l.w, y = Math.floor(k / l.w); if (x > 2 && y > 2 && x < l.w - 3 && y < l.h - 3 && ON_PEAT.has(FUEL_LIST[l.fuel[k]].id)) return { x, y }; } throw new Error('no peat'); })();

  it('holds each pass until the next one and converts with the peat factors', () => {
    // Pass A at −3 h (10 MW) holds 2 h; pass B at −1 h (20 MW) holds 1 h to "now": FRE = 10×7200 + 20×3600 MJ.
    const hs = [at(3, peatCell.x, peatCell.y, 10, 'N'), at(1, peatCell.x, peatCell.y, 20, 'N20')];
    const o = observedEmissions(l, hs, T0, DEFAULT_RATES)!;
    expect(o.passes).toBe(2);
    expect(o.detections).toBe(2);
    expect(o.freMJ).toBeCloseTo(144_000, 0);
    expect(o.peatShare).toBe(1);
    const dm = (144_000 * GFAS_BETA.peat) / 1000;
    expect(o.dryMatterT).toBeCloseTo(dm, 3);
    // Same peat emission factors as the forecast: (464 × 44/12 + 21 × 27) g/kg ≈ 2.268 t CO2e per t.
    expect(tco2ePerTdm('peat', DEFAULT_RATES)).toBeCloseTo(2.268, 2);
    expect(o.tco2e).toBeCloseTo(dm * tco2ePerTdm('peat', DEFAULT_RATES), 1);
  });

  it('caps a lone pass at 12 h and sums pixels of the same pass', () => {
    const hs = [at(30, peatCell.x, peatCell.y, 5, 'N'), at(30, peatCell.x, peatCell.y, 7, 'N')];
    const o = observedEmissions(l, hs, T0, DEFAULT_RATES)!;
    expect(o.passes).toBe(1);
    expect(o.freMJ).toBeCloseTo(12 * MAX_HOLD_H * 3600, 0);
  });

  it('ignores detections outside the window or the box, and is null without any', () => {
    expect(observedEmissions(l, [at(60, peatCell.x, peatCell.y, 10)], T0, DEFAULT_RATES)).toBeNull();
    expect(observedEmissions(l, [at(1, -5, -5, 10)], T0, DEFAULT_RATES)).toBeNull();
    expect(observedEmissions(l, [], T0, DEFAULT_RATES)).toBeNull();
  });

  it('counts a pixel centred on a canal or road as the fuel around it', () => {
    const l2 = { ...l, fuel: Uint8Array.from(l.fuel) };
    const k = peatCell.y * l2.w + peatCell.x;
    l2.fuel[k] = FUEL_INDEX.water;
    expect(coverAt(l2, peatCell.x, peatCell.y)).toBe(coverAt(l, peatCell.x, peatCell.y));
    const o = observedEmissions(l2, [at(1, peatCell.x, peatCell.y, 10)], T0, DEFAULT_RATES)!;
    expect(o.peatShare).toBe(1);
  });

  it('maps fuels to GFAS covers by soil, not vegetation', () => {
    expect(coverOf('peat')).toBe('peat');
    expect(coverOf('shrub')).toBe('peat');
    expect(coverOf('plantation')).toBe('tropicalForest');
    expect(coverOf('agri')).toBe('agriculture');
    expect(coverOf('grass')).toBe('savanna');
    expect(tco2ePerTdm('savanna', DEFAULT_RATES)).toBeCloseTo((1613 + 2.3 * 27) / 1000, 4);
  });
});

describe('real fuel map: WorldCover class + peat mask', () => {
  it('names the 3° WorldCover item by its south-west corner', () => {
    expect(worldcoverItem(-2.4, 114.0)).toBe('ESA_WorldCover_10m_2021_v200_S03E114');
    expect(worldcoverItem(-2.4, 111.9)).toBe('ESA_WorldCover_10m_2021_v200_S03E111');
    expect(worldcoverItem(1.2, 101.5)).toBe('ESA_WorldCover_10m_2021_v200_N00E099');
  });

  it('puts every burnable cover on peat soil into a peat fuel, and none off peat', () => {
    for (const cls of [10, 20, 30, 40, 60, 90]) {
      expect(ON_PEAT.has(fuelFromCover(cls, true)!)).toBe(true);
      expect(ON_PEAT.has(fuelFromCover(cls, false)!)).toBe(false);
    }
    expect(fuelFromCover(10, true)).toBe('peat');
    expect(fuelFromCover(10, false)).toBe('plantation');
    expect(fuelFromCover(80, true)).toBe('water');
    expect(fuelFromCover(50, false)).toBe('settlement');
    expect(fuelFromCover(0, true)).toBeNull();
  });

  it('bends zone and OpenStreetMap fuels to the peat mask', () => {
    expect(onPeatSoil('peat', false)).toBe('plantation');
    expect(onPeatSoil('shrub', false)).toBe('grass');
    expect(onPeatSoil('grass', true)).toBe('shrub');
    expect(onPeatSoil('water', true)).toBe('water');
  });
});
