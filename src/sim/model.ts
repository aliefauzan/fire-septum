// Stochastic cellular-automaton fire spread.
//
// Spread probability follows Alexandridis, Vakalis, Siettos & Bafas (2008),
// "A cellular automata model for forest fire spread prediction: The case of the
// wildfire that swept through Spetses Island in 1990", Applied Mathematics and
// Computation 204(1):191–201:
//
//   p_burn = p_h (1 + p_veg)(1 + p_den) p_w p_s
//   p_w    = exp(c1 V) · exp(c2 V (cos θ − 1))      V wind speed [m/s]
//   p_s    = exp(a θ_s)                             θ_s slope angle [deg]
//
// with p_h = 0.58, c1 = 0.045, c2 = 0.131, a = 0.078 (their calibrated values).
//
// Our additions (heuristic, documented in README, not from the paper):
//   * a fuel-dryness multiplier from relative humidity, temperature and rain,
//   * multi-hour burning (peat smoulders) and wind-driven spotting,
//   * suppression effects: wetting (water/retardant), control lines, crews,
//   * mapped fuel breaks (ditches, tracks: partial FireState.brk) and drier peat near drainage.

import { DEFAULT_RATES, chainsToCells, dropsPerHeliHour, flameLengthM, perFuel, type Rates } from './doctrine';
import { NATIVE, mathLib, type MathLib } from './detmath';
import { FUEL_LIST, ON_PEAT } from './fuels';
import { cloneState } from './landscape';
import { gaussian, hash4, mulberry32 } from './rng';
import {
  Cell,
  type Action,
  type FireState,
  type Landscape,
  type RunResult,
  type Scenario,
  type SimParams,
  type WeatherHour,
} from './types';

export const PH = 0.58;
export const C1 = 0.045;
export const C2 = 0.131;
export const A_SLOPE = 0.078;

export const DEFAULT_PARAMS: SimParams = {
  dtH: 0.5,
  runs: 40,
  windDirSdDeg: 15,
  windSpeedSdFrac: 0.2,
  rhSd: 5,
  spotting: true,
  // Chosen by hindcast against NASA FIRMS (docs/hindcast.md): picked on Kalimantan events,
  // it also beat τ = 3 h on held-out Sumatra. τ = 3 h spread about 6× too much new fire.
  tauH: 6,
  rates: DEFAULT_RATES,
  // Engine-independent maths, so a record re-runs bit-for-bit in Chromium, Firefox and Safari.
  math: 'det1',
};

/** Hectares one bucket drop knocks down: bucket litres ÷ litres needed per hectare. */
export const dropHa = (r: Rates) => r.bucketL / Math.max(100, r.coverageLPerHa);

// 8-neighbourhood, bearing measured clockwise from north (y grows south).
const OFFSETS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
const neighFor = (m: MathLib) => OFFSETS.map(([dx, dy]) => ({ dx, dy, dist: m.hypot(dx, dy), bearing: m.atan2(dx, -dy) }));
const NEIGH = neighFor(NATIVE);
const NEIGH_BY_LIB = new Map<MathLib, typeof NEIGH>([[NATIVE, NEIGH]]);
const neighOf = (m: MathLib) => NEIGH_BY_LIB.get(m) ?? NEIGH_BY_LIB.set(m, neighFor(m)).get(m)!;

/** Fuel dryness multiplier (heuristic). ~1.6 at RH 40 %, ~1 at RH 55 %, ~0.3 at RH 90 %. */
export function dryness(w: WeatherHour, antecedentRainMm = 0, m: MathLib = NATIVE): number {
  const rhF = Math.min(1.6, Math.max(0.25, m.exp(-0.035 * (w.rh - 55))));
  const rainF = m.exp(-0.6 * w.precipMm) * m.exp(-0.02 * antecedentRainMm);
  const tempF = Math.max(0.5, 1 + 0.015 * (w.tempC - 30));
  return rhF * rainF * tempF;
}

/** Wind term p_w of Alexandridis et al. for a spread direction differing by θ (radians) from the wind. */
export function windFactor(windMs: number, theta: number, m: MathLib = NATIVE): number {
  return m.exp(C1 * windMs) * m.exp(C2 * windMs * (m.cos(theta) - 1));
}

export function weatherAt(weather: WeatherHour[], tH: number): WeatherHour {
  if (weather.length === 0) return { t: tH, windKmh: 10, windFromDeg: 270, tempC: 32, rh: 60, precipMm: 0 };
  const i = Math.min(weather.length - 1, Math.max(0, Math.floor(tH)));
  return weather[i];
}

/**
 * Estimated flame length (m) at a head fire in this fuel and weather.
 * Byram intensity I = H·w·R with R the model's own head spread rate
 * (cell size × head-fire hazard / τ), then L = 0.0775·I^0.46. Because R comes
 * from this simplified model, treat the result as a class, not a measurement.
 */
export function flameLengthAt(fuelIdx: number, w: WeatherHour, params: Pick<SimParams, 'tauH' | 'rates'>, cellM: number, antecedentRainMm = 0, m: MathLib = NATIVE): number {
  const f = FUEL_LIST[fuelIdx];
  if (!f.burnable) return 0;
  const pHead = PH * (1 + f.pveg) * (1 + f.pden) * m.exp(C1 * (w.windKmh / 3.6)) * dryness(w, antecedentRainMm, m);
  const rosMs = (cellM * pHead) / (params.tauH * 3600);
  return flameLengthM(params.rates.heatKJkg * perFuel(params.rates.fuelLoadKgM2, f.id) * rosMs, m);
}

/** 4-connected line (Bresenham with diagonal steps split) so diagonal spread cannot slip through. */
export function lineCells(l: Pick<Landscape, 'w' | 'h'>, from: [number, number], to: [number, number]): number[] {
  let x = Math.round(from[0]), y = Math.round(from[1]);
  const x1 = Math.round(to[0]), y1 = Math.round(to[1]);
  const dx = Math.abs(x1 - x), dy = Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
  let err = dx - dy;
  const out: number[] = [];
  const push = (px: number, py: number) => {
    if (px >= 0 && py >= 0 && px < l.w && py < l.h) out.push(py * l.w + px);
  };
  push(x, y);
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    const stepX = e2 > -dy, stepY = e2 < dx;
    if (stepX) { err -= dy; x += sx; }
    if (stepX && stepY) push(x, y); // corner cell closes the diagonal gap
    if (stepY) { err += dx; y += sy; }
    push(x, y);
  }
  return out;
}

interface CompiledAction {
  a: Action;
  cells?: number[]; // firebreak line or disc cells
  endH: number;
}

export function actionDurationH(a: Action, rates: Rates = DEFAULT_RATES): number {
  if (a.kind === 'firebreak') {
    const len = Math.abs(a.to[0] - a.from[0]) + Math.abs(a.to[1] - a.from[1]) + 1;
    return len / Math.max(0.1, a.cellsPerHour);
  }
  if (a.kind === 'water') return a.drops / (heliCount(a, rates) * dropsPerHeliHour(rates));
  if (a.kind === 'seeding') return rates.seedLagH + rates.seedRainH;
  if (a.kind === 'dryice') return rates.dryIceLagH + rates.dryIceClearH * Math.max(1, a.sorties);
  return a.durationH;
}

/** Hours of rain added by seeding (in runs where it works) and its rate, from the sorties flown. */
export function seedingRain(a: { sorties: number }, rates: Rates = DEFAULT_RATES) {
  // One sortie (~800 kg NaCl) gives the base rain; more sorties give more, with diminishing returns.
  return { hours: rates.seedRainH, mmH: rates.seedRainMmH * Math.min(2, Math.sqrt(Math.max(1, a.sorties))) };
}

/** Share of runs in which seeding produces rain, from BMKG's cloud potential. */
export const seedChance = (c: Scenario['cloudPotential'], rates: Rates = DEFAULT_RATES) =>
  c === 'high' ? rates.seedChanceHigh : c === 'low' ? 0 : rates.seedChanceMedium;

/** Helicopters needed so the drops finish in about 2 h at the current dip distance. */
export const helicoptersFor = (drops: number, rates: Rates = DEFAULT_RATES) =>
  Math.max(1, Math.ceil(drops / (2 * dropsPerHeliHour(rates))));
export const heliCount = (a: { drops: number; helicopters?: number }, rates: Rates = DEFAULT_RATES) =>
  Math.max(1, a.helicopters ?? helicoptersFor(a.drops, rates));

/** Control-line production (cells/h) along a line, from per-fuel chain rates. */
export function lineCellsPerHour(l: Landscape, from: [number, number], to: [number, number], rates: Rates, method: 'dozer' | 'hand', crews = 1): number {
  const cells = lineCells(l, from, to);
  let hours = 0;
  for (const k of cells) {
    const f = FUEL_LIST[l.fuel[k]];
    if (!f.burnable) continue; // roads, water: nothing to cut
    const ch = method === 'dozer' ? perFuel(rates.dozerChPerH, f.id) : perFuel(rates.crewChPerH, f.id) * Math.max(1, crews);
    hours += 1 / Math.max(0.05, chainsToCells(ch, l.cellM));
  }
  return hours > 0 ? cells.length / hours : 50;
}

function discCells(l: Landscape, cx: number, cy: number, r: number): number[] {
  const out: number[] = [];
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(l.h - 1, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(l.w - 1, Math.ceil(cx + r)); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) out.push(y * l.w + x);
  return out;
}

export function compileActions(l: Landscape, actions: Action[], rates: Rates = DEFAULT_RATES): CompiledAction[] {
  return actions.map((a) => {
    if (a.kind === 'firebreak') return { a, cells: lineCells(l, a.from, a.to), endH: a.startH + actionDurationH(a, rates) };
    if (a.kind === 'water') return { a, cells: discCells(l, a.cx, a.cy, a.radius), endH: a.startH + actionDurationH(a, rates) };
    if (a.kind === 'seeding' || a.kind === 'dryice') return { a, endH: a.startH + actionDurationH(a, rates) };
    // Nearest cells first, so crews work outward from where they are sent.
    const cells = discCells(l, a.cx, a.cy, a.radius).sort((p, q) => {
      const d = (k: number) => ((k % l.w) - a.cx) ** 2 + (((k / l.w) | 0) - a.cy) ** 2;
      return d(p) - d(q);
    });
    return { a, cells, endH: a.startH + a.durationH };
  });
}

export interface RunOptions {
  /** Stop early and return the state at this hour (used by "advance clock"). */
  stopAtH?: number;
  /** Disable weather perturbation (deterministic "central" member). */
  central?: boolean;
  antecedentRainMm?: number;
}

export interface RunOutput extends RunResult {
  final: FireState;
}

/**
 * One stochastic realisation. Randomness comes only from the counter-based hash
 * (seed, step, cell, slot), so the same seed with and without an intervention
 * shares every random draw that the intervention does not physically change.
 */
export function runOnce(
  scn: Pick<Scenario, 'landscape' | 'weather' | 'init' | 'horizonH' | 'haze' | 'cloudPotential'>,
  actions: Action[] | CompiledAction[],
  params: SimParams,
  seed: number,
  opts: RunOptions = {},
): RunOutput {
  const l = scn.landscape;
  const n = l.w * l.h;
  const M = mathLib(params.math);
  const NB = neighOf(M);
  const s = cloneState(scn.init);
  const ign = new Float32Array(n).fill(-1);
  const out = new Float32Array(n).fill(-1);
  const ext = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (s.state[k] === Cell.Burning) ign[k] = 0;
    else if (s.state[k] === Cell.Burned) { ign[k] = -2; out[k] = -2; }
  }

  const compiled: CompiledAction[] =
    actions.length && 'a' in (actions[0] as CompiledAction) ? (actions as CompiledAction[]) : compileActions(l, actions as Action[], params.rates);

  // Per-run weather perturbation (constant offsets per member).
  const rnd = mulberry32(seed * 7919 + 13);
  const dirOff = opts.central ? 0 : gaussian(rnd, M) * params.windDirSdDeg;
  const spdMul = opts.central ? 1 : Math.max(0.3, 1 + gaussian(rnd, M) * params.windSpeedSdFrac);
  const rhOff = opts.central ? 0 : gaussian(rnd, M) * params.rhSd;

  const dt = params.dtH;
  const dtOverTau = dt / params.tauH;
  const endH = Math.min(scn.horizonH, opts.stopAtH ?? Infinity);
  const steps = Math.round(endH / dt);
  const burnSteps = FUEL_LIST.map((f) => Math.max(1, Math.round(f.burnHours / dt)));
  const R = params.rates;
  const DROP_HA = dropHa(R);
  // Hours one crew needs to knock down one cell of fire edge, by fuel.
  const crewHoursPerCell = FUEL_LIST.map((f) => (f.burnable ? 1 / Math.max(0.05, chainsToCells(perFuel(R.crewChPerH, f.id), l.cellM)) : Infinity));

  let active: number[] = [];
  for (let k = 0; k < n; k++) if (s.state[k] === Cell.Burning) active.push(k);
  const pending = new Uint8Array(n);
  const builtCount = compiled.map(() => 0);
  const pool = compiled.map(() => 0); // litres injected so far and not yet used up
  // Cells whose wetting lasts longer: retardant, and peat soaked from wells (holds water).
  const retardant = new Uint8Array(n);
  for (const c of compiled) if (c.a.kind === 'water' && c.a.product === 'retardant' && c.cells) for (const k of c.cells) retardant[k] = 1;
  const cellHa = (l.cellM * l.cellM) / 1e4;
  const isPeat = FUEL_LIST.map((f) => ON_PEAT.has(f.id));
  // Drained peat: canals and ditches lower the water table around them, so peat-soil fuel near
  // drainage is drier and ignites more readily. Only landscapes that carry drainM (built from the
  // OSM snapshot) get this term; without it the spread hazard below is computed exactly as before.
  let drainF: Float64Array | null = null;
  if (l.drainM) {
    const kD = R.drainK ?? 0, lD = Math.max(1, R.drainLM ?? 1);
    drainF = new Float64Array(n);
    for (let j = 0; j < n; j++) drainF[j] = isPeat[l.fuel[j]] ? 1 + kD * M.exp(-l.drainM[j] / lD) : 1;
  }

  // Cloud seeding: in a share of runs (cloud potential), rain falls over the whole map for a while.
  const rainAdd: { from: number; to: number; mmH: number }[] = [];
  const pSeed = seedChance(scn.cloudPotential, R);
  compiled.forEach((c, ci) => {
    if (c.a.kind !== 'seeding') return;
    if (hash4(seed, 0, ci, 41) >= pSeed) return; // seeding found no workable cloud in this run
    const r = seedingRain(c.a, R);
    rainAdd.push({ from: c.a.startH + R.seedLagH, to: c.a.startH + R.seedLagH + r.hours, mmH: r.mmH });
  });
  // Haze grounds helicopters except while dry-ice sorties keep it open.
  const clearWindows = compiled.filter((c) => c.a.kind === 'dryice').map((c) => ({ from: c.a.startH + R.dryIceLagH, to: c.endH }));
  const aircraftCanFly = (t: number) => !scn.haze || clearWindows.some((wnd) => t >= wnd.from && t < wnd.to);

  for (let step = 0; step < steps; step++) {
    const t0 = step * dt;
    const t1 = t0 + dt;
    const base = weatherAt(scn.weather, t0);
    const seededMm = rainAdd.reduce((acc, r) => acc + (t0 >= r.from && t0 < r.to ? r.mmH : 0), 0);
    const w: WeatherHour = {
      ...base,
      precipMm: base.precipMm + seededMm,
      rh: Math.min(100, Math.max(5, base.rh + rhOff + (seededMm > 0 ? 15 : 0))),
      windKmh: base.windKmh * spdMul,
      windFromDeg: base.windFromDeg + dirOff,
    };
    const windMs = w.windKmh / 3.6;
    const spreadDir = (((w.windFromDeg + 180) % 360) * Math.PI) / 180;
    const pw = NB.map((nb) => windFactor(windMs, nb.bearing - spreadDir, M));
    const dry = dryness(w, opts.antecedentRainMm ?? 0, M);
    // A finished control line removes most fuel; it leaks a little more in strong wind.
    const brkEff = Math.min(0.99, Math.max(0.85, 0.99 - 0.003 * w.windKmh));
    const wetTau = 6 * Math.max(0.5, w.rh / 60);
    // Flame length per fuel this step (IRPG tactic limits apply to it).
    const flame = FUEL_LIST.map((_, fi) => flameLengthAt(fi, w, params, l.cellM, opts.antecedentRainMm ?? 0, M));

    // ── Suppression actions ──
    compiled.forEach((c, ci) => {
      const a = c.a;
      if (t1 <= a.startH || t0 >= c.endH) return;
      if (a.kind === 'firebreak' && c.cells) {
        const target = Math.min(c.cells.length, Math.floor((t1 - a.startH) * a.cellsPerHour));
        for (let i = builtCount[ci]; i < target; i++) {
          const k = c.cells[i];
          // A line cannot be cut through cells that are already on fire.
          if (s.state[k] === Cell.Fuel) s.brk[k] = 1;
        }
        builtCount[ci] = Math.max(builtCount[ci], target);
      } else if (a.kind === 'water' && c.cells) {
        if (!aircraftCanFly(t0)) return; // grounded by haze: this time is lost
        const dur = Math.max(dt, c.endH - a.startH);
        const discHa = c.cells.length * (l.cellM * l.cellM) / 1e4;
        const perStep = Math.min(1, (a.drops * DROP_HA) / discHa) * (dt / dur);
        for (const k of c.cells) {
          s.wet[k] = Math.min(1, s.wet[k] + perStep * (a.product === 'retardant' ? 1 : 0.85));
          // Aircraft knock down flame only where it is short enough (IRPG: effective up to ~2.4 m).
          if (s.state[k] === Cell.Burning && flame[l.fuel[k]] < R.equipMaxFlameM) {
            const smoulder = FUEL_LIST[l.fuel[k]].burnHours >= 8 ? R.peatKnockdown : 1; // drops barely reach smouldering peat
            if (hash4(seed, step, k, 31) < 0.85 * s.wet[k] * smoulder) {
              s.state[k] = Cell.Extinguished; out[k] = t1; ext[k] = 1;
            }
          }
        }
      } else if (a.kind === 'inject' && c.cells) {
        // The crews' lances pour water into the nearest smouldering peat cell until it has the
        // injectLPerHa it needs, then move on. Water carries over between steps.
        pool[ci] += a.crews * R.lancesPerCrew * R.lanceLph * dt * (a.additive === 'foam' ? R.foamMul : 1);
        const perCell = Math.max(1, R.injectLPerHa * cellHa);
        for (const k of c.cells) {
          if (pool[ci] < perCell) break;
          if (s.state[k] !== Cell.Burning || !isPeat[l.fuel[k]]) continue;
          if (flame[l.fuel[k]] >= R.crewMaxFlameM) continue; // crews cannot stand in the flaming front
          pool[ci] -= perCell;
          if (hash4(seed, step, k, 43) < 0.9) { s.state[k] = Cell.Extinguished; out[k] = t1; ext[k] = 1; }
        }
      } else if (a.kind === 'wet' && c.cells) {
        // Pumps fed by bored wells soak unburned peat ahead of the fire; soaked peat dries slowly.
        let litres = a.crews * R.pumpLpm * 60 * dt;
        const perCell = Math.max(1, R.soakLPerHa * cellHa);
        for (const k of c.cells) {
          if (litres <= 0) break;
          if (s.state[k] !== Cell.Fuel || s.wet[k] >= 0.95) continue;
          const add = Math.min(1 - s.wet[k], litres / perCell);
          s.wet[k] += add; litres -= add * perCell;
          if (isPeat[l.fuel[k]]) retardant[k] = 1;
        }
      } else if (a.kind === 'crew' && c.cells) {
        let budget = a.crews * dt; // crew-hours this step
        // Work the burning edge cells that border unburned fuel first.
        for (const k of c.cells) {
          if (budget <= 0) break;
          if (s.state[k] !== Cell.Burning) continue;
          if (flame[l.fuel[k]] >= R.crewMaxFlameM) continue; // IRPG: too hot for hand tools
          const x = k % l.w, y = (k / l.w) | 0;
          let edge = false;
          for (const nb of NB) {
            const xx = x + nb.dx, yy = y + nb.dy;
            if (xx >= 0 && yy >= 0 && xx < l.w && yy < l.h && s.state[yy * l.w + xx] === Cell.Fuel) { edge = true; break; }
          }
          if (!edge) continue;
          budget -= crewHoursPerCell[l.fuel[k]];
          if (hash4(seed, step, k, 37) < 0.85) {
            s.state[k] = Cell.Extinguished; out[k] = t1; ext[k] = 1;
          }
        }
      }
    });

    // ── Spread ──
    const next: number[] = [];
    for (const k of active) {
      if (s.state[k] !== Cell.Burning) continue;
      const x = k % l.w, y = (k / l.w) | 0;
      const hk = l.elev[k];
      for (let ni = 0; ni < 8; ni++) {
        const nb = NB[ni];
        const xx = x + nb.dx, yy = y + nb.dy;
        if (xx < 0 || yy < 0 || xx >= l.w || yy >= l.h) continue;
        const j = yy * l.w + xx;
        if (s.state[j] !== Cell.Fuel || pending[j]) continue;
        const f = FUEL_LIST[l.fuel[j]];
        const thetaS = (M.atan((l.elev[j] - hk) / (nb.dist * l.cellM)) * 180) / Math.PI;
        let p =
          PH * (1 + f.pveg) * (1 + f.pden) * pw[ni] * M.exp(A_SLOPE * thetaS) * dry *
          (1 - 0.9 * s.wet[j]) * (1 - brkEff * s.brk[j]);
        if (drainF) p *= drainF[j];
        // Treat p_burn as a hazard so it rescales to our step length and keeps
        // wind/slope anisotropy when p > 1: p_step = 1 − exp(−p · dt/τ).
        const pStep = 1 - M.exp(-p * dtOverTau);
        if (hash4(seed, step, k, ni) < pStep) { pending[j] = 1; next.push(j); }
      }
      // Wind-driven spotting: embers land 2–4 cells downwind and ignore control lines.
      if (params.spotting && w.windKmh > 15) {
        const pSpot = Math.min(0.08, 0.012 * ((w.windKmh - 15) / 10) * dry);
        if (hash4(seed, step, k, 11) < pSpot) {
          const dist = 2 + Math.floor(hash4(seed, step, k, 12) * 3);
          const ang = spreadDir + (hash4(seed, step, k, 13) - 0.5) * 0.7;
          const sx = Math.round(x + M.sin(ang) * dist);
          const sy = Math.round(y - M.cos(ang) * dist);
          if (sx >= 0 && sy >= 0 && sx < l.w && sy < l.h) {
            const j = sy * l.w + sx;
            if (s.state[j] === Cell.Fuel && !pending[j] && s.brk[j] < 1 && hash4(seed, step, j, 14) < 1 - 0.9 * s.wet[j]) {
              pending[j] = 1; next.push(j);
            }
          }
        }
      }
      if (--s.remaining[k] <= 0) { s.state[k] = Cell.Burned; out[k] = t1; }
    }
    for (const j of next) {
      pending[j] = 0;
      s.state[j] = Cell.Burning;
      s.remaining[j] = burnSteps[l.fuel[j]];
      ign[j] = t1;
    }
    // Wetness evaporates (faster when hot and dry). Retardant decays 4× slower.
    {
      const decay = M.exp(-dt / wetTau), decayRet = M.exp(-dt / (wetTau * 4));
      for (let k = 0; k < n; k++) if (s.wet[k] > 0) s.wet[k] *= retardant[k] ? decayRet : decay;
    }
    active = [];
    for (let k = 0; k < n; k++) if (s.state[k] === Cell.Burning) active.push(k);
  }
  return { ign, out, ext, final: s };
}
