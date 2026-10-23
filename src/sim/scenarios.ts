// Synthetic, clearly labelled demo scenarios. None of these numbers are observations.
import { FUEL_INDEX } from './fuels';
import { buildZoneIndex, burnDisc, emptyState, gridZones, igniteDisc } from './landscape';
import { DEFAULT_PARAMS } from './model';
import { fbm } from './rng';
import type { FuelId, Landscape, Scenario, WeatherHour, Zone } from './types';

export const GRID = 64;
export const CELL_M = 100;

export interface SyntheticWeatherOpts {
  hours: number;
  startLocalHour: number;
  windKmh: number;
  windFromDeg: number;
  /** Optional wind shift: from this hour the wind turns to `shiftToDeg`. */
  shiftAtH?: number;
  shiftToDeg?: number;
  rhMean?: number;
  rainAtH?: number;
}

/** Diurnal cycle typical of a Kalimantan dry-season day: hot, drier afternoons; humid nights. */
export function syntheticWeather(o: SyntheticWeatherOpts): WeatherHour[] {
  const out: WeatherHour[] = [];
  const rhMean = o.rhMean ?? 68;
  for (let t = 0; t <= o.hours; t++) {
    const local = (o.startLocalHour + t) % 24;
    const day = Math.sin(((local - 8) / 24) * 2 * Math.PI); // peaks ~14:00
    let from = o.windFromDeg;
    if (o.shiftAtH !== undefined && o.shiftToDeg !== undefined) {
      const f = Math.min(1, Math.max(0, (t - o.shiftAtH) / 3));
      from = o.windFromDeg + f * (o.shiftToDeg - o.windFromDeg);
    }
    // Fixed synthetic date (14 Oct 2026, peak of the smoke week in the idea brief), local time.
    const d = new Date(Date.UTC(2026, 9, 14, o.startLocalHour + t));
    out.push({
      t,
      time: d.toISOString().slice(0, 16),
      windKmh: Math.max(2, o.windKmh * (1 + 0.35 * day)),
      windFromDeg: (from + 360) % 360,
      tempC: 30 + 4 * day,
      rh: Math.min(98, Math.max(30, rhMean - 18 * day)),
      precipMm: o.rainAtH !== undefined && t >= o.rainAtH && t < o.rainAtH + 3 ? 4 : 0,
    });
  }
  return out;
}

function paintFuel(w: number, h: number, zones: Zone[], seed: number, canal: boolean): Uint8Array {
  const fuel = new Uint8Array(w * h);
  const zoneOf = buildZoneIndex(w, h, zones);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const z = zones[zoneOf[k]];
      let id: FuelId = z.fuel;
      const n = fbm(x / 9, y / 9, seed);
      // Patchiness: fern/grass openings inside shrub and peat, dry grassy bunds in farmland.
      if ((id === 'shrub' || id === 'peat') && n > 0.66) id = 'grass';
      if (id === 'agri' && n > 0.8) id = 'grass';
      fuel[k] = FUEL_INDEX[id];
    }
  }
  if (canal) {
    // A drainage canal running north–south through the east half (common in Kalimantan peat).
    for (let y = 0; y < h; y++) {
      const x = Math.round(w * 0.82 + 2 * Math.sin(y / 7));
      if (x >= 0 && x < w) fuel[y * w + x] = FUEL_INDEX.water;
    }
  }
  return fuel;
}

function flatElev(w: number, h: number, seed: number, relief: number): Float32Array {
  const e = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) e[y * w + x] = 15 + relief * fbm(x / 20, y / 20, seed + 50);
  return e;
}

function ridgeElev(w: number, h: number, seed: number): Float32Array {
  const e = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // A ridge rising toward the north-east, steepest across zone B.
      const r = Math.max(0, (x + (h - y)) / (w + h) - 0.35);
      e[y * w + x] = 40 + 420 * r * r + 25 * fbm(x / 10, y / 10, seed);
    }
  return e;
}

function makeLandscape(zones: Zone[], seed: number, opts: { canal?: boolean; ridge?: boolean } = {}): Landscape {
  const w = GRID, h = GRID;
  return {
    w, h, cellM: CELL_M,
    fuel: paintFuel(w, h, zones, seed, !!opts.canal),
    elev: opts.ridge ? ridgeElev(w, h, seed) : flatElev(w, h, seed, 6),
    zoneOf: buildZoneIndex(w, h, zones),
    zones,
  };
}

function sketchZones(): Zone[] {
  const zones = gridZones(GRID, GRID, 2, 2, ['shrub', 'shrub', 'shrub', 'agri']);
  zones[0].name = 'Zone A · degraded peat';
  zones[1].name = 'Zone B · peat + village edge';
  zones[1].asset = 'Village edge and peat conservation plot';
  zones[1].weight = 1.5;
  zones[2].name = 'Zone C · degraded peat';
  zones[3].name = 'Zone D · rice fields';
  zones[3].asset = 'Wet rice fields';
  return zones;
}

/** The whiteboard sketch: A and C burning, B at risk, D currently unaffected. */
export function sketchScenario(): Scenario {
  const zones = sketchZones();
  const l = makeLandscape(zones, 11);
  const init = emptyState(l);
  const dt = DEFAULT_PARAMS.dtH;
  // Burn scars on the west edge (where the fire came from), active fronts further east.
  burnDisc(l, init, 6, 14, 7);
  burnDisc(l, init, 6, 46, 7);
  igniteDisc(l, init, 15, 15, 3, dt);
  igniteDisc(l, init, 13, 46, 3, dt);
  return {
    id: 'sketch',
    title: 'Whiteboard: A & C burning, B at risk',
    description: 'Zones A and C are burning. A south-westerly wind pushes the fire toward B (village edge). D is wet farmland.',
    provenance: { kind: 'synthetic', weather: 'Synthetic diurnal cycle', hotspots: 'Hand-placed ignitions', fuel: 'Synthetic fuel map' },
    landscape: l,
    weather: syntheticWeather({ hours: 48, startLocalHour: 10, windKmh: 14, windFromDeg: 240 }),
    init,
    horizonH: 48,
  };
}

/** Same map, but the wind veers from south-west to north-west after 18 h and threatens D. */
export function windShiftScenario(): Scenario {
  const s = sketchScenario();
  return {
    ...s,
    id: 'windshift',
    title: 'Wind shift at +18 h',
    description: 'Same fire as the whiteboard, but a forecast wind shift turns the head south-east toward D in the evening.',
    weather: syntheticWeather({ hours: 48, startLocalHour: 10, windKmh: 14, windFromDeg: 240, shiftAtH: 18, shiftToDeg: 320 }),
  };
}

/** Hilly terrain: shows the slope term (fire runs faster uphill toward B). */
export function ridgeScenario(): Scenario {
  const zones = gridZones(GRID, GRID, 2, 2, ['plantation', 'shrub', 'shrub', 'plantation']);
  zones[1].asset = 'Ridge-top telecom mast and village';
  zones[1].weight = 1.5;
  const l = makeLandscape(zones, 23, { ridge: true });
  const init = emptyState(l);
  igniteDisc(l, init, 20, 40, 3, DEFAULT_PARAMS.dtH);
  return {
    id: 'ridge',
    title: 'Upslope run toward a ridge',
    description: 'Single ignition in C below a ridge. Light wind, so slope does most of the work.',
    provenance: { kind: 'synthetic', weather: 'Synthetic diurnal cycle', hotspots: 'Hand-placed ignition', fuel: 'Synthetic fuel map, synthetic terrain' },
    landscape: l,
    weather: syntheticWeather({ hours: 48, startLocalHour: 11, windKmh: 7, windFromDeg: 200 }),
    init,
    horizonH: 48,
  };
}

export const PRESETS = [
  { id: 'sketch', title: 'Whiteboard: A & C burning, B at risk', make: sketchScenario },
  { id: 'windshift', title: 'Wind shift at +18 h', make: windShiftScenario },
  { id: 'ridge', title: 'Upslope run toward a ridge', make: ridgeScenario },
];
