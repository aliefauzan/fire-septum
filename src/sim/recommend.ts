// Simulation-based recommender. It does not guess: every candidate action is
// simulated with the same ensemble seeds as the baseline, and ranked by the
// paired difference in value-weighted burned area. Explanations are generated
// from those numbers, the entered inventory, mapped logistics and the cited
// doctrine in doctrine.ts.

import { SOURCES, dropsPerHeliHour, effectEvidence, flameBand, type SourceId } from './doctrine';
import { pairedSaving, quantile, runEnsemble, seedsFor, weightedLoss } from './ensemble';
import { FUEL_LIST, ON_PEAT } from './fuels';
import { actionDurationH, dropHa, flameLengthAt, heliCount, helicoptersFor, lineCellsPerHour, seedChance, seedingRain, weatherAt } from './model';
import { FACILITY_LABEL, UNKNOWN_INVENTORY, nearest, type Inventory, type Logistics } from './resources';
import type { Action, EnsembleResult, Scenario, SimParams, Zone, ZoneStats } from './types';

export interface Resources {
  crews: number; // hand crews (regu)
  dozers: number;
  helicopters: number;
  /** Fixed-wing aircraft for weather modification (seeding, dry ice). */
  aircraft: number;
  hours: number;
  drops: number;
  waterL: number;
  personnel: number;
}

export interface Recommendation {
  id: string;
  rank: number;
  kind: Action['kind'];
  zoneId: string;
  actions: Action[];
  title: string;
  where: string;
  what: string;
  when: string;
  why: string;
  impact: string;
  resources: string;
  res: Resources;
  saved: { mean: number; p10: number; p90: number; pBetter: number };
  weightedSaved: number;
  zoneBase: ZoneStats;
  zonePlan: ZoneStats;
  timing: { startH: number; savedHa: number }[];
  bestStartH: number;
  actByH: number | null;
  score: number;
  /** 'unknown' when it needs a resource whose count was not entered. */
  availability: 'available' | 'unknown';
  /** 'speculative' when every rate behind the effect is a placeholder; never used in the strategy. */
  evidence: 'measured' | 'speculative';
  needs:('helicopters' | 'crews' | 'dozers' | 'aircraft')[];
  /** Sources behind the reasoning in this recommendation. */
  citations: SourceId[];
}

export interface RecommendOutput {
  baseline: EnsembleResult;
  threatened: { zone: Zone; stats: ZoneStats }[];
  recommendations: Recommendation[];
  /** Greedy combination of the best compatible actions. */
  strategy: Combination | null;
  /** Same greedy combination, built while some resource counts are unknown. Not executable until
   *  the commander confirms `unconfirmed` resources exist; the UI must say so. */
  draft: (Combination & { unconfirmed: string[] }) | null;
  notes: string[];
}

export interface Combination { actions: Action[]; ids: string[]; saved: number; remainingRisk: { zoneId: string; pIgnite: number }[] }

export interface RecommendOptions {
  screeningRuns?: number;
  startTimes?: number[];
  /** What is actually available; null counts are unknown. */
  inventory?: Inventory;
  logistics?: Logistics | null;
  onProgress?: (done: number, total: number) => void;
}


/** New burned area (ha, ensemble mean) for an already-burning zone to count as an active front. */
const FRONT_MIN_HA = 5;
/** Cap on how many suggestions one whole plan bundles, so it stays something a crew can be briefed on. */
const MAX_WHOLE_PLAN = 8;

let uid = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(uid++).toString(36)}`;

/** Compass name for a bearing (degrees from north). */
export function compass(deg: number): string {
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

const fmtH = (h: number | null) => (h === null ? '—' : `+${h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)} h`);
const fmtHa = (ha: number) => (Math.abs(ha) >= 100 ? Math.round(ha / 10) * 10 : Math.round(ha)).toLocaleString('en-US');
const pct = (p: number) => `${Math.round(p * 100)}%`;

export function localClock(scn: Scenario, h: number): string | null {
  const t0 = scn.weather[0]?.time;
  if (!t0) return null;
  const d = new Date(t0);
  if (isNaN(d.getTime())) return null;
  d.setMinutes(d.getMinutes() + Math.round(h * 60));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function resourcesOf(actions: Action[], params: SimParams): Resources {
  const R = params.rates;
  const r: Resources = { crews: 0, dozers: 0, helicopters: 0, aircraft: 0, hours: 0, drops: 0, waterL: 0, personnel: 0 };
  for (const a of actions) {
    const d = actionDurationH(a, R);
    r.hours = Math.max(r.hours, d);
    if (a.kind === 'firebreak') {
      if (a.method === 'hand') r.crews += a.crews ?? 1;
      else { r.dozers += 1; r.crews += 1; }
    }
    if (a.kind === 'water') { r.helicopters += heliCount(a, R); r.drops += a.drops; r.waterL += a.drops * R.bucketL; }
    if (a.kind === 'crew' || a.kind === 'inject' || a.kind === 'wet') r.crews += a.crews;
    if (a.kind === 'inject') r.waterL += a.crews * R.lancesPerCrew * R.lanceLph * a.durationH;
    if (a.kind === 'wet') r.waterL += a.crews * R.pumpLpm * 60 * a.durationH;
    // One plane can fly both seeding and dry-ice sorties one after another.
    if (a.kind === 'seeding' || a.kind === 'dryice') r.aircraft = 1;
  }
  r.personnel = r.crews * R.crewSize + r.dozers + r.helicopters * 3 + r.aircraft * 3;
  return r;
}

/** Cost in "crew-hour equivalents" used only to break near-ties between options. */
function costOf(actions: Action[], params: SimParams): number {
  return actions.reduce((acc, a) => {
    const d = actionDurationH(a, params.rates);
    if (a.kind === 'firebreak') return acc + d * (a.method === 'hand' ? a.crews ?? 1 : 3);
    if (a.kind === 'water') return acc + heliCount(a, params.rates) * d * 6;
    if (a.kind === 'seeding') return acc + a.sorties * 4 * 6;
    if (a.kind === 'dryice') return acc + a.sorties * 2 * 6;
    return acc + a.crews * d;
  }, 0);
}

const travel = (km: number, kmh: number) => { const h = km / Math.max(1, kmh); return h < 1 ? `~${Math.round(h * 60)} min` : `~${h.toFixed(1)} h`; };

function resourcesText(a: Action, scn: Scenario, params: SimParams, logi: Logistics | null | undefined): string {
  const R = params.rates;
  const d = actionDurationH(a, R);
  const base = nearest(logi, ['manggala', 'agency', 'fire_station']);
  const baseText = base ? ` Nearest mapped base: ${base.name} (${FACILITY_LABEL[base.kind]}), ${base.km.toFixed(0)} km straight-line, ${travel(base.km * 1.3, R.groundKmh)} by road at ${R.groundKmh} km/h (assumed).` : '';
  if (a.kind === 'firebreak') {
    const km = ((Math.abs(a.to[0] - a.from[0]) + Math.abs(a.to[1] - a.from[1]) + 1) * scn.landscape.cellM) / 1000;
    const who = a.method === 'hand' ? `${a.crews ?? 1} hand crew${(a.crews ?? 1) > 1 ? 's' : ''} (${(a.crews ?? 1) * R.crewSize} people)` : `1 dozer + 1 hand crew (${R.crewSize} people)`;
    return `${who} for ~${d.toFixed(1)} h to cut ${km.toFixed(1)} km of line (${(a.cellsPerHour * scn.landscape.cellM / 1000).toFixed(2)} km/h from the ${a.method === 'hand' ? 'hand-crew' : 'dozer'} production rates).${baseText}`;
  }
  if (a.kind === 'water') {
    const heli = heliCount(a, R);
    const pad = nearest(logi, ['heliport', 'helipad', 'aerodrome', 'airstrip']);
    const dip = logi?.dip ? `nearest mapped water (${logi.dip.name}) ${logi.dip.km.toFixed(1)} km away` : `dip site assumed ${R.dipKm} km away (${logi?.waterChecked ? 'no mapped water within 15 km' : 'distance to water not known'}; set it in Resources)`;
    return `${heli} helicopter${heli > 1 ? 's' : ''} with ${R.bucketL.toLocaleString('en-US')} L buckets for ~${d.toFixed(1)} h: ${a.drops} drops ≈ ${((a.drops * R.bucketL) / 1000).toFixed(0)} m³ of ${a.product}; ${dip}, so ~${dropsPerHeliHour(R).toFixed(1)} drops per helicopter-hour.` +
      (pad ? ` Nearest mapped landing site: ${pad.name} (${FACILITY_LABEL[pad.kind]}), ${pad.km.toFixed(0)} km.` : '');
  }
  if (a.kind === 'seeding') return `${a.sorties} seeding sorties (~800 kg NaCl each in BMKG's 2026 Kalimantan operations) by a BMKG/BNPB aircraft; request through the provincial Satgas.`;
  if (a.kind === 'dryice') return `${a.sorties} dry-ice sorties (800 kg of CO2 pellets each, as flown by BNPB over Sumsel in Oct 2026). Coarse pellets must not fall on settlements.`;
  if (a.kind === 'inject') return `${a.crews} crew${a.crews > 1 ? 's' : ''} (${a.crews * R.crewSize} people) with ${a.crews * R.lancesPerCrew} peat injectors for ${a.durationH} h, ≈ ${Math.round((a.crews * R.lancesPerCrew * R.lanceLph * a.durationH) / 1000)} m³ of water${a.additive === 'foam' ? ' with ~1% wetting agent' : ''}. Needs a water source within hose reach.${baseText}`;
  if (a.kind === 'wet') return `${a.crews} crew${a.crews > 1 ? 's' : ''} with pumps on bored wells or a canal for ${a.durationH} h, ≈ ${Math.round((a.crews * R.pumpLpm * 60 * a.durationH) / 1000)} m³. Needs working wells near the edge: in Kalsel only 350 of 629 wells worked in 2026.${baseText}`;
  return `${a.crews} hand crews (${a.crews * R.crewSize} people) for ${a.durationH} h with pumps and peat injectors.${baseText}`;
}

/** Is a line end next to something that does not burn (water, road, settlement) or the map edge? */
function anchored(scn: Scenario, p: [number, number]): boolean {
  const l = scn.landscape;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = p[0] + dx, y = p[1] + dy;
    if (x < 0 || y < 0 || x >= l.w || y >= l.h) return true;
    if (!FUEL_LIST[l.fuel[y * l.w + x]].burnable) return true;
  }
  return false;
}

/** Zones whose rectangles share an edge with zone z, with the side of z they touch. */
function neighbours(zones: Zone[], z: Zone): { zone: Zone; side: 'west' | 'east' | 'north' | 'south' }[] {
  const out: { zone: Zone; side: 'west' | 'east' | 'north' | 'south' }[] = [];
  for (const o of zones) {
    if (o === z) continue;
    const yOverlap = Math.min(o.y1, z.y1) - Math.max(o.y0, z.y0);
    const xOverlap = Math.min(o.x1, z.x1) - Math.max(o.x0, z.x0);
    if (o.x1 === z.x0 && yOverlap > 0) out.push({ zone: o, side: 'west' });
    if (o.x0 === z.x1 && yOverlap > 0) out.push({ zone: o, side: 'east' });
    if (o.y1 === z.y0 && xOverlap > 0) out.push({ zone: o, side: 'north' });
    if (o.y0 === z.y1 && xOverlap > 0) out.push({ zone: o, side: 'south' });
  }
  return out;
}

interface Approach {
  zone: Zone;
  stats: ZoneStats;
  entry: { x: number; y: number };
  /** Burning cell closest to the entry point (where the fire head comes from). */
  head: { x: number; y: number } | null;
  from: { zone: Zone; side: 'west' | 'east' | 'north' | 'south' }[];
  /** Per-cell median ignition time over runs (Infinity if < half the runs burn it). */
  medianIgn: Float32Array;
  w: number;
  cellM: number;
}

/** Predicted head position at hour t: the cell burned by t (median) closest to the zone entry. */
function headAt(ap: Approach, t: number): { x: number; y: number } | null {
  if (t <= 0 || !ap.head) return ap.head;
  let best = Infinity, out = ap.head;
  for (let k = 0; k < ap.medianIgn.length; k++) {
    const m = ap.medianIgn[k];
    if (!(m >= 0 && m <= t)) continue;
    const x = k % ap.w, y = (k / ap.w) | 0;
    const d = (x - ap.entry.x) ** 2 + (y - ap.entry.y) ** 2;
    if (d < best) { best = d; out = { x, y }; }
  }
  return out;
}

function medianIgnition(base: EnsembleResult, n: number): Float32Array {
  const m = new Float32Array(n);
  const R = base.runs.length;
  const buf: number[] = [];
  for (let k = 0; k < n; k++) {
    buf.length = 0;
    for (const r of base.runs) if (r.ign[k] >= 0) buf.push(r.ign[k]);
    if (buf.length * 2 < R) { m[k] = Infinity; continue; }
    buf.sort((a, b) => a - b);
    m[k] = buf[Math.floor(R / 2) - (R - buf.length)] ?? buf[buf.length - 1];
  }
  return m;
}

function analyseApproach(scn: Scenario, base: EnsembleResult, zi: number, medianIgn: Float32Array): Approach {
  const l = scn.landscape;
  const z = l.zones[zi];
  const cells: { k: number; t: number }[] = [];
  for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) {
    const k = y * l.w + x;
    if (isFinite(medianIgn[k]) && medianIgn[k] > 0) cells.push({ k, t: medianIgn[k] });
  }
  cells.sort((a, b) => a.t - b.t);
  const early = cells.slice(0, Math.max(3, Math.ceil(cells.length * 0.08)));
  let ex = (z.x0 + z.x1) / 2, ey = (z.y0 + z.y1) / 2;
  if (early.length) {
    ex = early.reduce((a, c) => a + (c.k % l.w), 0) / early.length;
    ey = early.reduce((a, c) => a + ((c.k / l.w) | 0), 0) / early.length;
  }
  // Nearest currently-burning cell = the fire head that threatens this zone.
  let head: Approach['head'] = null, best = Infinity;
  const first = base.runs[0];
  for (let k = 0; k < l.w * l.h; k++) {
    if (first.ign[k] !== 0) continue;
    const x = k % l.w, y = (k / l.w) | 0;
    const d = (x - ex) ** 2 + (y - ey) ** 2;
    if (d < best) { best = d; head = { x, y }; }
  }
  // Which neighbouring zones does the fire arrive from? Those with earlier median ignition.
  const from = neighbours(l.zones, z).filter(({ zone }) => {
    const ozi = l.zones.indexOf(zone);
    const os = base.zoneStats[ozi];
    return os.initiallyBurning || (os.etaMedian !== null && base.zoneStats[zi].etaMedian !== null && os.etaMedian < base.zoneStats[zi].etaMedian!);
  });
  return { zone: z, stats: base.zoneStats[zi], entry: { x: ex, y: ey }, head, from, medianIgn, w: l.w, cellM: l.cellM };
}

/** Control line on zone z's first row/column facing the fire, covering the threatened stretch. */
interface LinePlan { method: 'dozer' | 'hand'; crews: number; rates: SimParams['rates'] }

function firebreakFor(scn: Scenario, ap: Approach, side: 'west' | 'east' | 'north' | 'south', startH: number, line: LinePlan): Action | null {
  const l = scn.landscape, z = ap.zone;
  const inset = 0;
  const vertical = side === 'west' || side === 'east';
  const fixed = side === 'west' ? z.x0 + inset : side === 'east' ? z.x1 - 1 - inset : side === 'north' ? z.y0 + inset : z.y1 - 1 - inset;
  // Extent: where cells along the line are expected to burn in the baseline, plus a margin.
  let lo = Infinity, hi = -Infinity;
  const span = vertical ? [z.y0, z.y1] : [z.x0, z.x1];
  for (let v = span[0]; v < span[1]; v++) {
    const x = vertical ? fixed : v, y = vertical ? v : fixed;
    if (isFinite(ap.medianIgn[y * l.w + x])) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  if (!isFinite(lo)) return null;
  lo = Math.max(span[0], lo - 3); hi = Math.min(span[1] - 1, hi + 3);
  const from: [number, number] = vertical ? [fixed, lo] : [lo, fixed];
  const to: [number, number] = vertical ? [fixed, hi] : [hi, fixed];
  const method = line.method;
  const cellsPerHour = lineCellsPerHour(l, from, to, line.rates, method, line.crews);
  return { id: newId('fb'), kind: 'firebreak', from, to, cellsPerHour, method, crews: method === 'hand' ? line.crews : undefined, startH, source: 'recommended' };
}

function waterFor(ap: Approach, startH: number, product: 'water' | 'retardant', params: SimParams, maxHeli: number | null): Action {
  // Knock down the fire head that threatens the zone: wet a disc of radius 2 cells.
  const h = headAt(ap, startH);
  const cx = h ? h.x : ap.entry.x;
  const cy = h ? h.y : ap.entry.y;
  const discHa = Math.PI * 2 * 2 * (ap.cellM * ap.cellM) / 1e4;
  const drops = Math.max(4, Math.ceil(discHa / dropHa(params.rates)));
  const helicopters = Math.min(helicoptersFor(drops, params.rates), maxHeli ?? Infinity);
  return { id: newId('w'), kind: 'water', cx: Math.round(cx), cy: Math.round(cy), radius: 2, drops, helicopters, product, startH, source: 'recommended' };
}

function crewFor(ap: Approach, startH: number, crews: number): Action | null {
  const h = headAt(ap, startH);
  if (!h) return null;
  return { id: newId('c'), kind: 'crew', cx: h.x, cy: h.y, radius: 6, crews, durationH: 12, startH, source: 'recommended' };
}

function injectFor(ap: Approach, startH: number, crews: number): Action | null {
  const h = headAt(ap, startH);
  if (!h) return null;
  return { id: newId('i'), kind: 'inject', cx: h.x, cy: h.y, radius: 4, crews, durationH: 12, additive: 'water', startH, source: 'recommended' };
}

function wetFor(ap: Approach, startH: number, crews: number): Action {
  return { id: newId('s'), kind: 'wet', cx: Math.round(ap.entry.x), cy: Math.round(ap.entry.y), radius: 3, crews, durationH: 10, startH, source: 'recommended' };
}

function where(scn: Scenario, a: Action, ap: Approach, side?: string): string {
  const l = scn.landscape;
  if (a.kind === 'seeding' || a.kind === 'dryice') return 'Over the whole map area and beyond (BMKG seeds boxes of ~1,000–1,800 km²).';
  const km = (v: number) => ((v * l.cellM) / 1000).toFixed(1);
  const geo = (x: number, y: number) => {
    if (!l.geo) return '';
    const lat = l.geo.north - ((y + 0.5) / l.h) * (l.geo.north - l.geo.south);
    const lon = l.geo.west + ((x + 0.5) / l.w) * (l.geo.east - l.geo.west);
    return ` (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
  };
  if (a.kind === 'firebreak') {
    const mx = (a.from[0] + a.to[0]) / 2, my = (a.from[1] + a.to[1]) / 2;
    return `${ap.zone.name}: along its ${side} edge${side ? ` facing ${ap.from.find((f) => f.side === side)?.zone.id ?? 'the fire'}` : ''}, on the boundary, centred ${km(mx)} km E / ${km(my)} km S of the map's NW corner${geo(mx, my)}.`;
  }
  const cx = a.cx, cy = a.cy;
  const label = 'fire head nearest to';
  return `${label} ${ap.zone.name}, ${km(cx)} km E / ${km(cy)} km S of the NW corner${geo(cx, cy)}, radius ${((a.radius * l.cellM) / 1000).toFixed(1)} km.`;
}

type Need = 'helicopters' | 'crews' | 'dozers' | 'aircraft';
const NEED_LABEL: Record<Need, string> = { helicopters: 'helicopters', crews: 'hand crews', dozers: 'dozers', aircraft: 'seeding aircraft' };
const NEEDS: Need[] = ['helicopters', 'crews', 'dozers', 'aircraft'];

export function recommend(scn: Scenario, params: SimParams, current: Action[] = [], opts: RecommendOptions = {}): RecommendOutput {
  const l = scn.landscape;
  const n = l.w * l.h;
  const R = params.rates;
  const runs = opts.screeningRuns ?? Math.min(params.runs, 24);
  const seeds = seedsFor(runs);
  const starts = opts.startTimes ?? [0, 3, 6, 10, 15];
  const inv = opts.inventory ?? UNKNOWN_INVENTORY;
  const logi = opts.logistics ?? null;
  const notes: string[] = [];

  // Resources already committed by the current plan reduce what is left.
  const used = resourcesOf(current, params);
  const left = (k: Need): number | null => (inv[k] === null ? null : Math.max(0, inv[k]! - used[k]));

  // Baseline for recommendations = the current plan (empty plan = "no action").
  const base = runEnsemble(scn, current, params, seeds);
  const baseLoss = weightedLoss(scn, base);
  const medianIgn = medianIgnition(base, n);

  let threatened = l.zones
    .map((zone, zi) => ({ zone, zi, stats: base.zoneStats[zi] }))
    .filter((t) => !t.stats.initiallyBurning && t.stats.pIgnite >= 0.15)
    .sort((a, b) => b.zone.weight * b.stats.pIgnite - a.zone.weight * a.stats.pIgnite)
    .slice(0, 2);

  if (threatened.length === 0) {
    // Large live fires often touch every zone at the start. The fire can still grow a lot inside
    // them, so target the zones where the most new area burns; every option is still simulated
    // and only shown if it saves area.
    const front = l.zones
      .map((zone, zi) => ({ zone, zi, stats: base.zoneStats[zi] }))
      .filter((t) => t.stats.initiallyBurning && t.stats.burnedHaMean >= FRONT_MIN_HA)
      .sort((a, b) => b.zone.weight * b.stats.burnedHaMean - a.zone.weight * a.stats.burnedHaMean)
      .slice(0, 2);
    if (front.length) {
      threatened = front;
      notes.push(`No zone without fire is at risk, so suggestions target the burning zones where fire grows most: ${front.map((t) => `${t.zone.id} (~${fmtHa(t.stats.burnedHaMean)} ha more)`).join(', ')}.`);
    } else notes.push('No unburned zone has ≥15% predicted chance of igniting within the horizon. Monitoring is the suggested action; this is lower risk, not a guarantee.');
  }

  // Which tactics can be considered at all, given the inventory.
  const heliLeft = left('helicopters'), crewLeft = left('crews'), dozerLeft = left('dozers'), planeLeft = left('aircraft');
  const line: LinePlan | null =
    dozerLeft !== 0 && crewLeft !== 0 ? { method: 'dozer', crews: 1, rates: R }
      : crewLeft !== 0 ? { method: 'hand', crews: Math.min(2, crewLeft ?? 2), rates: R }
        : null;
  if (threatened.length) {
    if (heliLeft === 0) notes.push('No helicopters available in the entered inventory, so aerial water drops were not considered.');
    if (crewLeft === 0) notes.push('No hand crews available in the entered inventory, so direct attack and control lines were not considered.');
    else if (dozerLeft === 0) notes.push('No dozer available: control lines are planned as hand line (slower).');
    if (scn.haze) notes.push(planeLeft === 0 ? 'Haze grounds helicopters and no aircraft is available for dry ice, so water drops have no effect.' : 'Haze grounds helicopters: water drops are paired with dry-ice sorties to open the sky.');
    if (scn.cloudPotential === 'low') notes.push('Cloud potential is low, so cloud seeding was not considered (BMKG: seeding fails when clouds do not form).');
  }

  type Family = { kind: Action['kind']; zi: number; ap: Approach; build: (s: number) => Action | Action[] | null; side?: string; label: string; needs: Need[] };
  const dryIce = (s: number): Action => ({ id: newId('d'), kind: 'dryice', sorties: 2, startH: Math.max(0, s - R.dryIceLagH), source: 'recommended' });
  const families: Family[] = [];
  for (const t of threatened) {
    const ap = analyseApproach(scn, base, t.zi, medianIgn);
    if (line) for (const f of ap.from) families.push({
      kind: 'firebreak', zi: t.zi, ap, side: f.side, needs: line.method === 'dozer' ? ['dozers', 'crews'] : ['crews'],
      label: `${line.method === 'dozer' ? 'Dozer' : 'Hand'} line on ${t.zone.id}'s ${f.side} edge`,
      build: (s) => firebreakFor(scn, ap, f.side, s, line),
    });
    if (heliLeft !== 0 && !(scn.haze && planeLeft === 0)) families.push(scn.haze
      ? { kind: 'water', zi: t.zi, ap, needs: ['helicopters', 'aircraft'], label: `Dry ice to clear haze, then helicopter drops on the head threatening ${t.zone.id}`, build: (s) => [dryIce(s), waterFor(ap, s, 'water', params, heliLeft)] }
      : { kind: 'water', zi: t.zi, ap, needs: ['helicopters'], label: `Helicopter knockdown of the head threatening ${t.zone.id}`, build: (s) => waterFor(ap, s, 'water', params, heliLeft) });
    if (crewLeft !== 0) families.push({ kind: 'crew', zi: t.zi, ap, needs: ['crews'], label: `Direct attack on the head threatening ${t.zone.id}`, build: (s) => crewFor(ap, s, Math.min(3, crewLeft ?? 3)) });
    const headPeat = ap.head ? ON_PEAT.has(FUEL_LIST[l.fuel[ap.head.y * l.w + ap.head.x]].id) : false;
    if (crewLeft !== 0 && headPeat) families.push({ kind: 'inject', zi: t.zi, ap, needs: ['crews'], label: `Peat injection at the head threatening ${t.zone.id}`, build: (s) => injectFor(ap, s, Math.min(2, crewLeft ?? 2)) });
    if (crewLeft !== 0 && ON_PEAT.has(t.zone.fuel))
      families.push({ kind: 'wet', zi: t.zi, ap, needs: ['crews'], label: `Soak peat at ${t.zone.id}'s edge from bored wells`, build: (s) => wetFor(ap, s, Math.min(2, crewLeft ?? 2)) });
  }
  if (threatened.length && planeLeft !== 0 && scn.cloudPotential !== 'low') {
    const t = threatened[0];
    families.push({ kind: 'seeding', zi: t.zi, ap: analyseApproach(scn, base, t.zi, medianIgn), needs: ['aircraft'], label: 'Request cloud seeding (OMC) over the fire', build: (s) => ({ id: newId('o'), kind: 'seeding', sorties: 2, startH: s, source: 'recommended' }) });
  }

  const total = families.length * starts.length;
  let done = 0;
  const recs: Recommendation[] = [];
  for (const fam of families) {
    const ap = fam.ap;
    const zs = base.zoneStats[fam.zi];
    const timing: { startH: number; savedHa: number; acts: Action[]; plan: EnsembleResult; loss: number }[] = [];
    for (const s of starts) {
      done++;
      opts.onProgress?.(done, total);
      if (zs.etaP90 !== null && s >= zs.etaP90) continue; // too late to matter in almost every run
      const built = fam.build(s);
      if (!built) continue;
      const acts = Array.isArray(built) ? built : [built];
      const plan = runEnsemble(scn, [...current, ...acts], params, seeds);
      const sv = pairedSaving(base, plan);
      timing.push({ startH: s, savedHa: sv.mean, acts, plan, loss: weightedLoss(scn, plan) });
    }
    if (!timing.length) continue;
    const best = timing.reduce((a, b) => (b.loss < a.loss - 1e-6 ? b : a));
    const bestSaved = Math.max(0, best.savedHa);
    const actBy = [...timing].reverse().find((t) => t.savedHa >= 0.8 * bestSaved && bestSaved > 1);
    const sv = pairedSaving(base, best.plan);
    const zp = best.plan.zoneStats[fam.zi];
    const res = resourcesOf(best.acts, params);
    const weightedSaved = baseLoss - best.loss;
    const cost = costOf(best.acts, params);
    const unknownNeeds = fam.needs.filter((k) => inv[k] === null);
    const citations = new Set<SourceId>(['alexandridis']);

    const w0 = weatherAt(scn.weather, 0);
    const wEta = weatherAt(scn.weather, zs.etaMedian ?? 0);
    const wStart = weatherAt(scn.weather, best.startH);
    const clock = (h: number) => { const c = localClock(scn, h); return c ? ` (${c} local)` : ''; };
    const lateNote = (() => {
      const last = timing[timing.length - 1];
      if (timing.length < 2 || last === best) return '';
      return ` Starting at ${fmtH(last.startH)} saves only ~${fmtHa(Math.max(0, last.savedHa))} ha, because the fire reaches the area first in most runs.`;
    })();
    // The main action; a dry-ice sortie may come before it.
    const a = best.acts[best.acts.length - 1];
    const d = actionDurationH(a, R);

    // Doctrine: flame length at the threatening head when the action starts.
    const headFuel = ap.head ? l.fuel[ap.head.y * l.w + ap.head.x] : FUEL_LIST.findIndex((f) => f.id === ap.zone.fuel);
    const L = flameLengthAt(headFuel, wStart, params, l.cellM, scn.antecedentRainMm ?? 0);
    const band = flameBand(L, R);
    const flameText = `Estimated flame length at the head ≈ ${L.toFixed(1)} m in ${FUEL_LIST[headFuel].label.toLowerCase()}: ${band.text} (${SOURCES.irpg.short}; ${SOURCES.andrewsRothermel.short}).`;
    let doctrine = '';
    if (a.kind === 'firebreak') {
      citations.add('irpg').add(a.method === 'hand' ? 'sanDimas' : 'nwcgDozer');
      const doneH = a.startH + d;
      const early = zs.etaP10;
      doctrine = early === null ? ''
        : doneH <= early ? ` The line is finished by ${fmtH(doneH)}, before the earliest 10% of arrivals (${fmtH(early)}), as the IRPG requires for indirect line.`
          : ` Warning: the line is only finished at ${fmtH(doneH)}, after the earliest 10% of arrivals (${fmtH(early)}). The IRPG requires indirect line to be completed and held before the fire arrives, so start sooner or add resources.`;
      const anc = anchored(scn, a.from) && anchored(scn, a.to);
      doctrine += anc ? ' Both ends meet non-burnable ground or the map edge (anchor points).' : ' Anchor both ends to a road, canal or wet ground first: line without an anchor point is IRPG Watch-Out Situation 8.';
    } else if (a.kind === 'water') {
      citations.add('irpg').add('andrewsRothermel').add('santoso');
      doctrine = ` ${flameText}${FUEL_LIST[headFuel].burnHours >= 8 ? ' On peat, drops mostly stop surface flame; smouldering peat needs ~4–6 L of water per kg (Santoso 2021), so ground crews with peat injectors must follow.' : ''}`;
      if (scn.provenance.kind !== 'synthetic') { citations.add('p32'); doctrine += ' Under P.32/2016 (Pasal 89), aerial suppression is deployed in emergency status or at a Governor’s request.'; }
      if (scn.haze) { citations.add('bnpbDryIce'); doctrine += ` Haze grounds the helicopters: dry-ice sorties start ${R.dryIceLagH} h earlier to open the sky (BNPB, Sumsel Oct 2026; effect still being evaluated).`; }
    } else if (a.kind === 'inject') {
      citations.add('santoso').add('csiroLance').add('p32').add('irpg');
      const haDay = (a.crews * R.lancesPerCrew * R.lanceLph * 24) / R.injectLPerHa;
      doctrine = ` Smouldering peat needs ~4–6 L of water per kg; injecting beats surface spraying (Santoso 2021; Mulyasih 2022). At ${R.lanceLph.toLocaleString('en-US')} L/h per lance this is ≈ ${haDay.toFixed(1)} ha per day. Crews work only where surface flames are below ${R.crewMaxFlameM} m; set up LCES first.`;
    } else if (a.kind === 'wet') {
      citations.add('ppGambut').add('santoso');
      doctrine = ' Wet peat ignites far less. Bored wells and canal blocks wet a few hundred metres around them; the target is a water table no deeper than 0.4 m (PP 57/2016). This only soaks the top layer and dries again over hours.';
    } else if (a.kind === 'seeding') {
      citations.add('bmkgOmc').add('bmkgClouds');
      const r = seedingRain(a, R);
      doctrine = ` With ${scn.cloudPotential ?? 'medium'} cloud potential the model lets seeding work in ${pct(seedChance(scn.cloudPotential, R))} of runs, adding ~${r.mmH.toFixed(1)} mm/h of rain for ${r.hours} h starting ${R.seedLagH} h after the sorties. These rain numbers are placeholders: BMKG reports only "light to moderate" rain. Patrols and ground work must continue.`;
    } else {
      citations.add('irpg').add('andrewsRothermel').add('sanDimas');
      doctrine = ` ${flameText} Set up LCES (lookouts, communications, escape routes, safety zones) before engaging.`;
      if (FUEL_LIST[headFuel].burnHours >= 8) { citations.add('santoso').add('p32'); doctrine += ' On peat, soak or inject water into the smouldering layer (P.32 regu kit includes peat injectors).'; }
    }
    if (logi) citations.add('osm');

    const what =
      a.kind === 'firebreak'
        ? `Cut a ${(((Math.abs(a.to[0] - a.from[0]) + Math.abs(a.to[1] - a.from[1]) + 1) * l.cellM) / 1000).toFixed(1)} km control line (fuel removed down to mineral soil or wet peat) parallel to the zone boundary, by ${a.method === 'hand' ? 'hand crews' : 'dozer'}.${doctrine}`
        : a.kind === 'water'
          ? `Drop ${a.drops} helicopter buckets on the active head (~${Math.round(Math.PI * a.radius * a.radius * l.cellM * l.cellM / 1e4)} ha) to knock down flames and wet the fuel just ahead of it.${doctrine}`
          : a.kind === 'inject'
            ? `Send ${a.crews} crew${a.crews > 1 ? 's' : ''} with peat injectors to the smouldering edge nearest the zone and push water into the burning peat layer.${doctrine}`
            : a.kind === 'wet'
              ? `Pump water from bored wells or a canal to soak the unburned peat along the zone edge the fire will reach first.${doctrine}`
              : a.kind === 'seeding'
                ? `Ask BMKG/BNPB to fly ${a.sorties} NaCl cloud-seeding sorties over the fire area.${doctrine}`
                : a.kind === 'crew'
                  ? `Send ${a.crews} hand crews for direct attack on the fire edge nearest the zone (the model only lets crews work where flames are below ${R.crewMaxFlameM} m).${doctrine}`
                  : `Fly ${a.sorties} dry-ice sorties to break the haze layer.${doctrine}`;
    const why =
      `${ap.zone.name} has a ${pct(zs.pIgnite)} predicted chance of igniting within ${scn.horizonH} h (median arrival ${fmtH(zs.etaMedian)}, 10–90%: ${fmtH(zs.etaP10)}–${fmtH(zs.etaP90)}). ` +
      `The wind is from the ${compass(w0.windFromDeg)} at ${Math.round(w0.windKmh)} km/h now and ${Math.round(wEta.windKmh)} km/h around the expected arrival, pushing the head ${compass(w0.windFromDeg + 180)}.` +
      (ap.zone.asset ? ` At stake: ${ap.zone.asset} (value weight ${ap.zone.weight}×).` : '');
    const impact =
      `Expected burned area −${fmtHa(Math.max(0, sv.mean))} ha (10–90%: ${fmtHa(sv.p10)} to ${fmtHa(sv.p90)} ha); better than no action in ${pct(sv.pBetter)} of runs. ` +
      `P(${ap.zone.id} ignites) ${pct(zs.pIgnite)} → ${pct(zp.pIgnite)}` +
      (zp.etaMedian !== null && zs.etaMedian !== null ? `; median arrival ${fmtH(zs.etaMedian)} → ${fmtH(zp.etaMedian)}` : zp.etaMedian === null ? '; fire does not reach it in most runs' : '') +
      `. ${zp.pIgnite > 0.05 ? 'Lower predicted risk, not a guarantee.' : 'Risk becomes low in the simulation, but this is a forecast, not a guarantee.'}`;
    const when =
      `Start at ${fmtH(best.startH)}${clock(best.startH)}` +
      (actBy && actBy.startH > best.startH ? `; most of the benefit holds if started by ${fmtH(actBy.startH)}${clock(actBy.startH)}.` : '.') +
      ` Takes ~${d.toFixed(1)} h.` + lateNote;
    const availText = unknownNeeds.length
      ? ` Availability unknown: enter how many ${unknownNeeds.map((k) => NEED_LABEL[k]).join(' and ')} you actually have in Resources.`
      : '';

    recs.push({
      id: newId('rec'),
      rank: 0,
      kind: fam.kind,
      zoneId: ap.zone.id,
      actions: best.acts,
      title: fam.label,
      where: where(scn, a, ap, fam.side),
      what, when, why, impact,
      resources: best.acts.map((x) => resourcesText(x, scn, params, logi)).join(' ') + availText,
      res,
      saved: sv,
      weightedSaved,
      zoneBase: zs,
      zonePlan: zp,
      timing: timing.map((t) => ({ startH: t.startH, savedHa: t.savedHa })),
      bestStartH: best.startH,
      actByH: actBy ? actBy.startH : null,
      score: weightedSaved - 0.5 * cost,
      availability: unknownNeeds.length ? 'unknown' : 'available',
      evidence: effectEvidence(fam.kind),
      needs: fam.needs,
      citations: [...citations],
    });
  }
  // Executable, measured options first; then those waiting on an inventory count; speculative
  // ones (effect rates all placeholders) last. By score within each group.
  const group = (r: Recommendation) => (r.evidence === 'speculative' ? 2 : r.availability === 'available' ? 0 : 1);
  recs.sort((a, b) => group(a) - group(b) || b.score - a.score);
  recs.forEach((r, i) => (r.rank = i + 1));
  for (const r of recs) r.actions.forEach((a) => (a.label = `#${r.rank} ${r.title}`));

  // Whole plan: every measured option that saves at least 1 ha, best first, as long as the
  // known inventory covers it. Simulated together once, so the saving shown is the combined one.
  let strategy: RecommendOutput['strategy'] = null;
  const useful = recs.filter((r) => r.saved.mean >= 1);
  const executable = useful.filter((r) => r.availability === 'available' && r.evidence === 'measured');
  if (recs.some((r) => r.evidence === 'speculative'))
    notes.push('Cloud seeding is shown but left out of the combined strategy: every number behind its effect is a placeholder (BMKG reports no rain amounts or timing).');
  // Known counts limit what fits; unknown counts do not, which is why a draft needs confirming.
  const combine = (pool: Recommendation[]): Combination | null => {
    const chosen: Recommendation[] = [];
    let actions = [...current];
    for (const r of pool) {
      if (chosen.length >= MAX_WHOLE_PLAN) break;
      const u = resourcesOf([...actions, ...r.actions], params);
      if (NEEDS.some((k) => u[k] > (inv[k] ?? Infinity))) continue;
      chosen.push(r); actions = [...actions, ...r.actions];
    }
    if (!chosen.length) return null;
    const plan = runEnsemble(scn, actions, params, seeds);
    return {
      actions: actions.slice(current.length),
      ids: chosen.map((c) => c.id),
      saved: pairedSaving(base, plan).mean,
      remainingRisk: plan.zoneStats.filter((z) => !z.initiallyBurning && z.pIgnite >= 0.3).map((z) => ({ zoneId: z.zoneId, pIgnite: z.pIgnite })),
    };
  };
  if (executable.length) {
    strategy = combine(executable);
    if (strategy?.remainingRisk.length)
      notes.push(`Even with the suggested strategy, ${strategy.remainingRisk.map((z) => `${z.zoneId} (${pct(z.pIgnite)})`).join(', ')} keep a ≥30% chance of igniting. More resources or a later re-plan may be needed.`);
  }
  let draft: RecommendOutput['draft'] = null;
  if (!strategy) {
    const c = combine(useful.filter((r) => r.evidence === 'measured'));
    if (c) {
      const needed = resourcesOf(c.actions, params);
      const unconfirmed = NEEDS.filter((k) => needed[k] > 0 && inv[k] === null).map((k) => NEED_LABEL[k]);
      draft = { ...c, unconfirmed };
    }
  }
  if (draft && !executable.length)
    notes.push(`The whole plan assumes ${draft.unconfirmed.join(', ') || 'resources'} you have not confirmed. Enter how many helicopters, crews, dozers and aircraft are actually available in Resources.`);
  const savings = recs.map((r) => r.saved.mean).sort((a, b) => a - b);
  if (recs.length > 1 && quantile(savings, 0.5) < 1) notes.push('Most single actions barely change the outcome in this scenario: conditions may be beyond what these resources can influence.');

  return { baseline: base, threatened: threatened.map((t) => ({ zone: t.zone, stats: t.stats })), recommendations: recs, strategy, draft, notes };
}

