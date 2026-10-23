import type { Rates } from './doctrine';

// Core data types for the SekatApi wildfire decision-support simulator.
// Grid convention: cell index k = y * w + x, x grows east, y grows south.

export type FuelId = 'grass' | 'shrub' | 'peat' | 'plantation' | 'agri' | 'water' | 'settlement';

export interface FuelType {
  id: FuelId;
  label: string;
  /** Alexandridis et al. (2008) vegetation-type term p_veg. */
  pveg: number;
  /** Alexandridis et al. (2008) vegetation-density term p_den. */
  pden: number;
  /** Hours a cell keeps burning (flaming + smouldering) before burning out. */
  burnHours: number;
  burnable: boolean;
  color: string;
}

export interface Zone {
  id: string; // 'A', 'B', ...
  name: string;
  x0: number; y0: number; x1: number; y1: number; // cell rect, [x0, x1) × [y0, y1)
  fuel: FuelId;
  /** What is at stake in the zone, shown in explanations. */
  asset?: string;
  /** Relative value used when ranking interventions (1 = plain land). */
  weight: number;
}

export interface Landscape {
  w: number;
  h: number;
  cellM: number; // cell edge length in metres
  fuel: Uint8Array; // index into FUEL_LIST
  elev: Float32Array; // metres
  zoneOf: Uint8Array; // index into zones (255 = none)
  zones: Zone[];
  /** Geographic anchor (cell 0,0 north-west corner) when the scenario is real. */
  geo?: { north: number; west: number; south: number; east: number };
}

export interface WeatherHour {
  /** Hours from simulation start. */
  t: number;
  /** ISO local time label from the data source, if any. */
  time?: string;
  windKmh: number;
  /** Meteorological convention: direction the wind blows FROM, degrees clockwise from north. */
  windFromDeg: number;
  tempC: number;
  rh: number; // %
  precipMm: number; // mm in that hour
}

export const Cell = {
  Fuel: 0,
  Burning: 1,
  Burned: 2,
  NonFuel: 3,
  Extinguished: 4,
} as const;

export interface FireState {
  state: Uint8Array; // Cell enum
  /** Remaining burn steps for burning cells. */
  remaining: Uint16Array;
  /** Wetness 0..1 from water / retardant. */
  wet: Float32Array;
  /** Fuel-break strength 0..1 (completed control line). */
  brk: Float32Array;
}

export type Action = FirebreakAction | WaterAction | CrewAction | InjectAction | WetAction | SeedingAction | DryIceAction;

interface ActionBase {
  id: string;
  /** Hour (from now) the action starts. */
  startH: number;
  /** Who suggested it: user-drawn or recommender. */
  source?: 'user' | 'recommended';
  label?: string;
}

export interface FirebreakAction extends ActionBase {
  kind: 'firebreak';
  /** Ordered endpoints in cell coords; the line is rasterised 4-connected. */
  from: [number, number];
  to: [number, number];
  /** Cells of line completed per hour. */
  cellsPerHour: number;
  /** Who builds it: one dozer (with a crew) or hand crews. */
  method?: 'dozer' | 'hand';
  /** Hand crews building the line when method is 'hand'. */
  crews?: number;
}

export interface WaterAction extends ActionBase {
  kind: 'water';
  cx: number;
  cy: number;
  radius: number; // cells
  /** Number of aerial bucket drops (bucket size is a rate setting). */
  drops: number;
  /** Helicopters assigned; defaults to enough to finish in about 2 h. */
  helicopters?: number;
  product: 'water' | 'retardant';
}

export interface CrewAction extends ActionBase {
  kind: 'crew';
  cx: number;
  cy: number;
  radius: number; // cells
  durationH: number;
  /** Number of hand crews (regu). */
  crews: number;
}

/** Peat-fire crews pushing lances into the smouldering layer (suntik gambut). Works only on burning peat. */
export interface InjectAction extends ActionBase {
  kind: 'inject';
  cx: number;
  cy: number;
  radius: number; // cells
  durationH: number;
  crews: number;
  /** Plain water, or water with ~1% wetting agent / foam. */
  additive: 'water' | 'foam';
}

/** Soaking unburned peat ahead of the fire with pumps fed by bored wells or canals (pembasahan, sumur bor). */
export interface WetAction extends ActionBase {
  kind: 'wet';
  cx: number;
  cy: number;
  radius: number; // cells
  durationH: number;
  crews: number;
}

/** Cloud seeding with NaCl (OMC / TMC by BMKG–BNPB). Adds rain over the whole map in runs where seeding works. */
export interface SeedingAction extends ActionBase {
  kind: 'seeding';
  sorties: number;
}

/** Dry-ice (CO2 pellet) sorties that break the haze inversion so helicopters can fly. Adds no rain. */
export interface DryIceAction extends ActionBase {
  kind: 'dryice';
  sorties: number;
}

/** BMKG's qualitative forecast of clouds that seeding could work on. */
export type CloudPotential = 'low' | 'medium' | 'high';

export interface Scenario {
  id: string;
  title: string;
  description: string;
  /** 'synthetic' or a description of the real data used. */
  provenance: DataProvenance;
  landscape: Landscape;
  weather: WeatherHour[];
  init: FireState;
  horizonH: number;
  /** Rain in the 72 h before the start (mm); wets fuel (Köse et al. 2008 antecedent-rain idea). */
  antecedentRainMm?: number;
  /** Real hotspots used as ignitions, for map display. */
  hotspots?: Hotspot[];
  /** Thick haze grounds helicopters (as in Central Kalimantan, Oct 2026) unless dry ice clears it. */
  haze?: boolean;
  /** Cloud potential for seeding; unset counts as 'medium'. */
  cloudPotential?: CloudPotential;
  /** Set when the scenario replays a past day: what the satellites saw after the start. */
  hindcast?: Hindcast;
}

export interface Hindcast {
  /** Start of the forecast: the last satellite pass of day D (ISO UTC). */
  t0: string;
  /** Hours after t0 the observations cover. */
  windowH: number;
  /** Detections in (t0, t0 + windowH]. */
  observed: Hotspot[];
}

export interface Hotspot {
  lat: number;
  lon: number;
  x: number; // cell coords
  y: number;
  frp: number; // fire radiative power, MW
  confidence: string;
  acquired: string; // ISO date-time UTC
  satellite: string;
}

export interface DataProvenance {
  kind: 'synthetic' | 'live' | 'mixed';
  weather: string;
  hotspots: string;
  fuel: string;
  fetchedAt?: string;
}

export interface SimParams {
  dtH: number; // step length in hours
  runs: number;
  /** Weather perturbation for ensemble members. */
  windDirSdDeg: number;
  windSpeedSdFrac: number;
  rhSd: number;
  spotting: boolean;
  /** Characteristic hours for p_burn to act once (rescales the per-step probability to dtH). */
  tauH: number;
  /** Production rates, tactic thresholds and logistics (see doctrine.ts for sources). */
  rates: Rates;
}

/** Result of one stochastic run: per-cell ignition and end time in hours (-1 = never). */
export interface RunResult {
  ign: Float32Array;
  out: Float32Array;
  /** Cells extinguished by suppression rather than burning out. */
  ext: Uint8Array;
}

export interface ZoneStats {
  zoneId: string;
  initiallyBurning: boolean;
  /** Fraction of runs where the zone ignited (≥ threshold cells) within the horizon. */
  pIgnite: number;
  /** Median / 10th / 90th percentile ignition hour over runs that ignited. */
  etaMedian: number | null;
  etaP10: number | null;
  etaP90: number | null;
  /** Mean burned hectares in the zone at the horizon. */
  burnedHaMean: number;
  burnedHaP10: number;
  burnedHaP90: number;
}

export interface EnsembleResult {
  runs: RunResult[];
  /** Total burned ha at horizon for each run (same order as runs). */
  burnedHa: number[];
  zoneStats: ZoneStats[];
  horizonH: number;
  cellHa: number;
  seeds: number[];
}
