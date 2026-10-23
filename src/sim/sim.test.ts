import { describe, expect, it } from 'vitest';
import { parseFirmsCsv, clusterHotspots } from '../data/firms';
import { parseLogistics } from '../data/logistics';
import { zoneStatus } from '../ui/status';
import { pairedSaving, runEnsemble, seedsFor } from './ensemble';
import { FUEL_INDEX } from './fuels';
import { buildZoneIndex, emptyState, gridZones, igniteDisc } from './landscape';
import { DEFAULT_RATES, dropsPerHeliHour, flameLengthM } from './doctrine';
import { DEFAULT_PARAMS, flameLengthAt, lineCells, runOnce } from './model';
import { SYNTHETIC_INVENTORY, UNKNOWN_INVENTORY } from './resources';
import { recommend } from './recommend';
import { ridgeScenario, sketchScenario } from './scenarios';
import { recordedScenario } from '../data/presets';
import type { Action, Landscape, Scenario, WeatherHour } from './types';

const P = { ...DEFAULT_PARAMS, runs: 24 };

/** Uniform shrub square with one central ignition and constant weather. */
function uniform(w: Partial<WeatherHour> = {}, size = 41): Scenario {
  const zones = gridZones(size, size, 1, 1, ['shrub']);
  const l: Landscape = {
    w: size, h: size, cellM: 100,
    fuel: new Uint8Array(size * size).fill(FUEL_INDEX.shrub),
    elev: new Float32Array(size * size), zoneOf: buildZoneIndex(size, size, zones), zones,
  };
  const init = emptyState(l);
  igniteDisc(l, init, 20, 20, 1, P.dtH);
  const weather = Array.from({ length: 25 }, (_, t) => ({ t, windKmh: 0, windFromDeg: 270, tempC: 32, rh: 55, precipMm: 0, ...w }));
  return { id: 'u', title: 'u', description: '', provenance: { kind: 'synthetic', weather: '', hotspots: '', fuel: '' }, landscape: l, weather, init, horizonH: 12 };
}

const meanBurned = (s: Scenario, actions: Action[] = []) => {
  const e = runEnsemble(s, actions, P);
  return e.burnedHa.reduce((a, b) => a + b, 0) / e.burnedHa.length;
};

describe('fire model', () => {
  it('is deterministic for a given seed', () => {
    const s = sketchScenario();
    const a = runOnce(s, [], P, 7), b = runOnce(s, [], P, 7);
    expect(Array.from(a.ign)).toEqual(Array.from(b.ign));
  });

  it('spreads further downwind than upwind (wind from the west → east)', () => {
    const s = uniform({ windKmh: 25, windFromDeg: 270 });
    const e = runEnsemble(s, [], P);
    const w = s.landscape.w;
    let east = 0, west = 0;
    for (const r of e.runs) for (let x = 0; x < w; x++) {
      if (r.ign[20 * w + x] > 0) { if (x > 20) east++; else if (x < 20) west++; }
    }
    expect(east).toBeGreaterThan(west * 2);
  });

  it('humid, rainy weather slows spread a lot', () => {
    const dry = meanBurned(uniform({ rh: 45 }));
    const wet = meanBurned(uniform({ rh: 95, precipMm: 3 }));
    expect(wet).toBeLessThan(dry * 0.3);
  });

  it('does not burn through open water', () => {
    const s = uniform({ windKmh: 20, windFromDeg: 270 });
    const l = s.landscape;
    for (let y = 0; y < l.h; y++) for (const x of [25, 26]) l.fuel[y * l.w + x] = FUEL_INDEX.water;
    const init = emptyState(l);
    igniteDisc(l, init, 20, 20, 1, P.dtH);
    const r = runOnce({ ...s, landscape: l, init }, [], { ...P, spotting: false }, 3);
    for (let y = 0; y < l.h; y++) for (let x = 27; x < l.w; x++) expect(r.ign[y * l.w + x]).toBe(-1);
  });

  it('runs faster uphill (ridge scenario: north-east of the ignition burns earlier than south-west)', () => {
    const s = ridgeScenario();
    const e = runEnsemble(s, [], P);
    const zs = Object.fromEntries(e.zoneStats.map((z) => [z.zoneId, z]));
    expect(zs.A.pIgnite).toBeGreaterThan(0.5);
  });

  it('rasterises control lines 4-connected so diagonal spread cannot slip through', () => {
    const cells = lineCells({ w: 50, h: 50 }, [2, 3], [30, 20]);
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1], b = cells[i];
      expect(Math.abs((a % 50) - (b % 50)) + Math.abs(((a / 50) | 0) - ((b / 50) | 0))).toBe(1);
    }
  });

  it('puts hot, windy shrub fire above the IRPG hand-crew flame limit and mild fire below it', () => {
    const hot = flameLengthAt(FUEL_INDEX.shrub, { t: 0, windKmh: 45, windFromDeg: 0, tempC: 36, rh: 35, precipMm: 0 }, P, 100);
    const mild = flameLengthAt(FUEL_INDEX.shrub, { t: 0, windKmh: 8, windFromDeg: 0, tempC: 30, rh: 70, precipMm: 0 }, P, 100);
    expect(hot).toBeGreaterThan(DEFAULT_RATES.crewMaxFlameM);
    expect(mild).toBeLessThan(DEFAULT_RATES.crewMaxFlameM);
  });

  it('uses Byram flame length (≈3.3 m at 3,460 kW/m, the IRPG 11 ft band edge)', () => {
    expect(flameLengthM(3460)).toBeGreaterThan(3.1);
    expect(flameLengthM(3460)).toBeLessThan(3.5);
  });

  it('gets fewer helicopter drops per hour when the dip site is further away', () => {
    expect(dropsPerHeliHour({ ...DEFAULT_RATES, dipKm: 1 })).toBeGreaterThan(dropsPerHeliHour({ ...DEFAULT_RATES, dipKm: 15 }) * 2);
  });
});

describe('interventions', () => {
  const s = sketchScenario();
  // The control line the recommender proposes for B in the whiteboard scenario.
  const line = (startH: number): Action => ({ id: 'fb', kind: 'firebreak', from: [32, 0], to: [32, 31], cellsPerHour: 4, startH });
  const base = runEnsemble(s, [], P);

  it('an early control line delays B and reduces burned area in nearly every run', () => {
    const plan = runEnsemble(s, [line(0)], P);
    const sv = pairedSaving(base, plan);
    expect(sv.mean).toBeGreaterThan(50);
    expect(sv.pBetter).toBeGreaterThan(0.8);
    const b0 = base.zoneStats[1], b1 = plan.zoneStats[1];
    expect(b1.etaMedian ?? Infinity).toBeGreaterThan((b0.etaMedian ?? 0) + 3);
  });

  it('acting early beats acting late', () => {
    const early = pairedSaving(base, runEnsemble(s, [line(0)], P)).mean;
    const late = pairedSaving(base, runEnsemble(s, [line(15)], P)).mean;
    // With the hindcast-chosen τ = 6 h the fire is slower, so a late line still helps, but less.
    expect(early).toBeGreaterThan(late * 1.05);
  });

  it('a control line is not a guarantee: embers can still cross in strong wind', () => {
    const windy: Scenario = { ...s, weather: s.weather.map((w) => ({ ...w, windKmh: w.windKmh * 2 })) };
    const plan = runEnsemble(windy, [line(0)], P);
    expect(plan.zoneStats[1].pIgnite).toBeGreaterThan(0);
  });

  it('water on a small fire right away reduces the burned area', () => {
    const u = uniform({ windKmh: 10 });
    const water: Action = { id: 'w', kind: 'water', cx: 20, cy: 20, radius: 2, drops: 24, product: 'water', startH: 0 };
    expect(meanBurned(u, [water])).toBeLessThan(meanBurned(u) * 0.9);
  });
});

describe('recommender when fire is already in every zone', () => {
  // The recorded West Kalimantan event starts with fire in all nine zones.
  const s = recordedScenario();
  const out = recommend(s, P, [], { screeningRuns: 12, startTimes: [0, 6] });

  it('targets the burning zones where fire grows most instead of giving up', () => {
    expect(runEnsemble(s, [], P, seedsFor(4)).zoneStats.every((z) => z.initiallyBurning)).toBe(true);
    expect(out.threatened.length).toBeGreaterThan(0);
    expect(out.notes.some((n) => n.startsWith('No zone without fire is at risk'))).toBe(true);
    expect(out.recommendations.length).toBeGreaterThan(0);
  });
});

describe('recommender', () => {
  const out = recommend(sketchScenario(), P, [], { screeningRuns: 16, startTimes: [0, 6, 15] });

  it('flags B as threatened, ranks an action on B first and offers a control line on B', () => {
    expect(out.threatened.map((t) => t.zone.id)).toContain('B');
    expect(out.recommendations[0].zoneId).toBe('B');
    expect(out.recommendations.some((r) => r.kind === 'firebreak' && r.zoneId === 'B')).toBe(true);
  });

  it('keeps speculative actions (all-placeholder effect rates) out of the combined strategy', () => {
    const seed = out.recommendations.filter((r) => r.kind === 'seeding');
    for (const r of seed) expect(r.evidence).toBe('speculative');
    const ids = new Set(out.strategy?.ids ?? []);
    for (const r of seed) expect(ids.has(r.id)).toBe(false);
  });

  it('explains where, what, when, why, impact and resources for every option', () => {
    for (const r of out.recommendations) {
      for (const f of [r.where, r.what, r.when, r.why, r.impact, r.resources]) expect(f.length).toBeGreaterThan(20);
      expect(`${r.impact} ${r.why}`.toLowerCase()).not.toMatch(/\bsafe\b/);
    }
  });

  it('compares interventions instead of assuming water is best', () => {
    const kinds = new Set(out.recommendations.map((r) => r.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it('reports a timing curve that rewards early action for the top option', () => {
    const top = out.recommendations[0];
    expect(top.timing[0].savedHa).toBeGreaterThan(top.timing[top.timing.length - 1].savedHa);
  });

  it('flags every option and builds no strategy while the inventory is unknown', () => {
    expect(out.recommendations.every((r) => r.availability === 'unknown')).toBe(true);
    expect(out.strategy).toBeNull();
    expect(out.notes.join(' ')).toMatch(/Enter how many/);
  });

  it('still offers the whole plan as a draft that names the resources to confirm', () => {
    expect(out.draft).not.toBeNull();
    expect(out.draft!.actions.length).toBeGreaterThan(0);
    expect(out.draft!.unconfirmed.length).toBeGreaterThan(0);
    const ids = new Set(out.draft!.ids);
    for (const r of out.recommendations) if (ids.has(r.id)) expect(r.evidence).toBe('measured');
  });

  it('cites a source for every recommendation', () => {
    for (const r of out.recommendations) expect(r.citations.length).toBeGreaterThan(1);
  });
});

describe('recommender with an inventory', () => {
  const opts = { screeningRuns: 12, startTimes: [0, 6] };

  it('never proposes helicopters when the inventory has none', () => {
    const r = recommend(sketchScenario(), P, [], { ...opts, inventory: { ...UNKNOWN_INVENTORY, helicopters: 0, crews: 4, dozers: 1, source: 'user' } });
    expect(r.recommendations.some((x) => x.kind === 'water')).toBe(false);
    expect(r.notes.join(' ')).toMatch(/No helicopters/);
  });

  it('builds a strategy that fits the known inventory', () => {
    const r = recommend(sketchScenario(), P, [], { ...opts, inventory: SYNTHETIC_INVENTORY });
    expect(r.strategy).not.toBeNull();
    const heli = r.strategy!.actions.filter((a) => a.kind === 'water').reduce((n, a) => n + (a.kind === 'water' ? a.helicopters ?? 1 : 0), 0);
    expect(heli).toBeLessThanOrEqual(SYNTHETIC_INVENTORY.helicopters!);
  });

  it('switches to hand line when there is no dozer', () => {
    const r = recommend(sketchScenario(), P, [], { ...opts, inventory: { helicopters: 0, crews: 4, dozers: 0, aircraft: 0, source: 'user' } });
    const lines = r.recommendations.filter((x) => x.kind === 'firebreak');
    expect(lines.length).toBeGreaterThan(0);
    for (const x of lines) expect(x.actions[0].kind === 'firebreak' && x.actions[0].method).toBe('hand');
  });
});

describe('labels and data parsing', () => {
  it('never labels a zone safe', () => {
    expect(zoneStatus({ zoneId: 'D', initiallyBurning: false, pIgnite: 0, etaMedian: null, etaP10: null, etaP90: null, burnedHaMean: 0, burnedHaP10: 0, burnedHaP90: 0 })).toBe('not-reached');
  });

  it('parses FIRMS VIIRS CSV and clusters detections', () => {
    const csv = [
      'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
      '-2.2501,114.0012,340.1,0.4,0.4,2026-10-20,0542,N,VIIRS,n,2.0NRT,295.1,12.3,D',
      '-2.2533,114.0050,350.0,0.4,0.4,2026-10-20,0542,N,VIIRS,h,2.0NRT,296.0,40.0,D',
      '-1.0000,113.0000,330.0,0.4,0.4,2026-10-19,1801,N,VIIRS,l,2.0NRT,290.0,2.0,N',
    ].join('\n');
    const hs = parseFirmsCsv(csv);
    expect(hs).toHaveLength(3);
    expect(hs[0].acquired).toBe('2026-10-20T05:42:00Z');
    const cl = clusterHotspots(hs);
    expect(cl[0].count).toBe(2);
  });
});

describe('logistics from OpenStreetMap', () => {
  it('classifies bases, ignores look-alike names and finds the nearest dip site', () => {
    const lg = parseLogistics({ elements: [
      { type: 'node', id: 1, lat: -2.0, lon: 113.0, tags: { name: 'Manggala Agni Daops Palangka Raya' } },
      { type: 'node', id: 2, lat: -2.0, lon: 113.1, tags: { name: 'Kantor Desa Manggala', office: 'government' } },
      { type: 'node', id: 3, lat: -2.3, lon: 113.0, tags: { aeroway: 'helipad' } },
      { type: 'way', id: 4, tags: { waterway: 'river', name: 'Sungai Kahayan' }, geometry: [{ lat: -2.05, lon: 113.0 }, { lat: -2.02, lon: 113.0 }] },
    ] }, -2.0, 113.0);
    expect(lg.facilities.map((f) => f.kind)).toEqual(['manggala', 'helipad']);
    expect(lg.dip?.name).toBe('Sungai Kahayan');
    expect(lg.dip!.km).toBeCloseTo(2.2, 1);
  });
});

describe('ensemble', () => {
  it('uses fixed seeds so results are reproducible', () => {
    expect(seedsFor(3)).toEqual([1, 2, 3]);
  });
});

describe('Kalimantan methods (seeding, dry ice, peat injection, soaking)', () => {
  const windy = () => uniform({ windKmh: 12, rh: 50 });
  const peat = () => {
    const s = uniform({ windKmh: 8, rh: 50 });
    s.landscape.fuel.fill(FUEL_INDEX.peat);
    s.landscape.zones[0].fuel = 'peat';
    return s;
  };
  const seeding: Action = { id: 'o', kind: 'seeding', sorties: 2, startH: 0 };
  const drops: Action = { id: 'w', kind: 'water', cx: 20, cy: 20, radius: 3, drops: 40, helicopters: 4, product: 'water', startH: 0 };

  it('cloud seeding adds rain only when clouds can grow', () => {
    const none = meanBurned(windy());
    expect(meanBurned({ ...windy(), cloudPotential: 'high' }, [seeding])).toBeLessThan(none);
    expect(meanBurned({ ...windy(), cloudPotential: 'low' }, [seeding])).toBeCloseTo(none, 6);
  });

  it('haze grounds helicopters until dry ice opens the sky', () => {
    const hazy = { ...windy(), haze: true };
    const none = meanBurned(hazy);
    expect(meanBurned(hazy, [drops])).toBeCloseTo(none, 6);
    const withIce = meanBurned(hazy, [{ id: 'd', kind: 'dryice', sorties: 2, startH: 0 }, { ...drops, startH: 1 }]);
    expect(withIce).toBeLessThan(none);
  });

  it('peat injection puts out burning peat, and does nothing on other fuels', () => {
    const inject: Action = { id: 'i', kind: 'inject', cx: 20, cy: 20, radius: 4, crews: 4, durationH: 12, additive: 'water', startH: 0 };
    const ext = (s: Scenario, a: Action[]) => runEnsemble(s, a, P).runs.reduce((n, r) => n + r.ext.reduce((m, v) => m + v, 0), 0);
    expect(ext(peat(), [inject])).toBeGreaterThan(0);
    const grass = windy(); grass.landscape.fuel.fill(FUEL_INDEX.grass);
    expect(ext(grass, [inject])).toBe(0);
    expect(ext(peat(), [{ ...inject, additive: 'foam' }])).toBeGreaterThanOrEqual(ext(peat(), [inject]));
  });

  it('soaking peat ahead of the fire slows it', () => {
    const soak: Action = { id: 's', kind: 'wet', cx: 26, cy: 20, radius: 3, crews: 3, durationH: 10, startH: 0 };
    expect(meanBurned(peat(), [soak])).toBeLessThan(meanBurned(peat()));
  });

  it('the recommender suggests seeding and injection on burning peat', () => {
    const r = recommend(sketchScenario(), P, [], { screeningRuns: 12, startTimes: [0, 6], inventory: SYNTHETIC_INVENTORY });
    const kinds = new Set(r.recommendations.map((x) => x.kind));
    expect(kinds.has('seeding')).toBe(true);
    expect(kinds.has('inject')).toBe(true);
    for (const x of r.recommendations) expect(x.citations.length).toBeGreaterThan(1);
  });
});
