// Mapped fuel breaks (partial FireState.brk from ditches and tracks) and drained peat near canals.
import { describe, expect, it } from 'vitest';
import { DEFAULT_RATES } from './doctrine';
import { sha256 } from './determinism';
import { runEnsemble, seedsFor } from './ensemble';
import { FUEL_INDEX } from './fuels';
import { buildZoneIndex, emptyState, gridZones, igniteDisc } from './landscape';
import { DEFAULT_PARAMS, runOnce } from './model';
import { PRESETS } from './scenarios';
import type { FireState, Landscape, Scenario, SimParams } from './types';

const P: SimParams = { ...DEFAULT_PARAMS, runs: 24, spotting: false };
const SIZE = 41;

/** Uniform fuel, fire along the west edge, wind from the west, a north–south line at x = 20. */
function strip(fuel: 'shrub' | 'plantation' = 'shrub'): Scenario {
  const zones = gridZones(SIZE, SIZE, 1, 1, [fuel]);
  const l: Landscape = {
    w: SIZE, h: SIZE, cellM: 100,
    fuel: new Uint8Array(SIZE * SIZE).fill(FUEL_INDEX[fuel]),
    elev: new Float32Array(SIZE * SIZE), zoneOf: buildZoneIndex(SIZE, SIZE, zones), zones,
  };
  const init = emptyState(l);
  for (let y = 0; y < SIZE; y++) igniteDisc(l, init, 2, y, 0.5, P.dtH);
  const weather = Array.from({ length: 25 }, (_, t) => ({ t, windKmh: 15, windFromDeg: 270, tempC: 32, rh: 50, precipMm: 0 }));
  return { id: 's', title: 's', description: '', provenance: { kind: 'synthetic', weather: '', hotspots: '', fuel: '' }, landscape: l, weather, init, horizonH: 24 };
}

const withBreak = (s: Scenario, strength: number): Scenario => {
  const init: FireState = { ...s.init, brk: s.init.brk.slice() };
  for (let y = 0; y < SIZE; y++) init.brk[y * SIZE + 20] = strength;
  return { ...s, init };
};

/** Mean cells east of the line (x > 20) that ignite, per run. */
const eastBurned = (s: Scenario, params: SimParams = P) => {
  const e = runEnsemble(s, [], params);
  let n = 0;
  for (const r of e.runs) for (let y = 0; y < SIZE; y++) for (let x = 21; x < SIZE; x++) if (r.ign[y * SIZE + x] > 0) n++;
  return n / e.runs.length;
};

describe('partial fuel breaks (mapped ditches and tracks)', () => {
  it('a ditch-strength break slows spread across it, less than a finished control line', () => {
    const s = strip();
    const open = eastBurned(s);
    const ditch = eastBurned(withBreak(s, DEFAULT_RATES.brkNarrowWater!));
    const track = eastBurned(withBreak(s, DEFAULT_RATES.brkTrack!));
    const line = eastBurned(withBreak(s, 1));
    expect(open).toBeGreaterThan(50);
    expect(ditch).toBeLessThan(open * 0.9);
    expect(track).toBeLessThan(open);
    expect(ditch).toBeLessThan(track); // the stronger break holds more
    expect(line).toBeLessThan(ditch);
    expect(ditch).toBeGreaterThan(line); // a ditch is not a control line: fire still gets across
  });
});

describe('drained peat near a canal', () => {
  /** Distance in metres to a canal along x = 20 (the canal itself is not in the fuel map here). */
  const canalDist = () => {
    const d = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) d[y * SIZE + x] = Math.abs(x - 20) * 100;
    return d;
  };

  it('raises spread on peat soil near drainage, not on mineral-soil fuel', () => {
    const peat = strip('shrub');
    const drained: Scenario = { ...peat, landscape: { ...peat.landscape, drainM: canalDist() } };
    expect(eastBurned(drained)).toBeGreaterThan(eastBurned(peat) * 1.05);

    const plant = strip('plantation'); // off peat: drainage does not change it
    const plantDrained: Scenario = { ...plant, landscape: { ...plant.landscape, drainM: canalDist() } };
    const a = runOnce(plant, [], P, 5), b = runOnce(plantDrained, [], P, 5);
    expect(Array.from(b.ign)).toEqual(Array.from(a.ign));
  });

  it('far from drainage (5 km cap) the effect vanishes; k = 0 switches it off exactly', () => {
    const s = strip();
    const far: Scenario = { ...s, landscape: { ...s.landscape, drainM: new Float32Array(SIZE * SIZE).fill(5000) } };
    expect(Array.from(runOnce(far, [], P, 3).ign)).toEqual(Array.from(runOnce(s, [], P, 3).ign));
    const near: Scenario = { ...s, landscape: { ...s.landscape, drainM: new Float32Array(SIZE * SIZE) } };
    const off = { ...P, rates: { ...P.rates, drainK: 0 } };
    expect(Array.from(runOnce(near, [], off, 3).ign)).toEqual(Array.from(runOnce(s, [], P, 3).ign));
  });

  it('a landscape without drainM runs bit for bit as before the drainage term existed', () => {
    // Digest of 8 'det1' runs of the first synthetic preset, computed with the model of commit
    // 8b737da (before drainage and partial breaks). Records without drainM must keep it.
    const s = PRESETS[0].make();
    expect(s.landscape.drainM).toBeUndefined();
    const parts: Uint8Array[] = [];
    for (const seed of seedsFor(8)) {
      const r = runOnce(s, [], DEFAULT_PARAMS, seed);
      for (const a of [r.ign, r.out, r.ext]) parts.push(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    }
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    expect(sha256(all)).toBe('66336c8315381cd1422f399e65b741be5af0927617d578c38dd4cc8ef345e22f');
  });
});
