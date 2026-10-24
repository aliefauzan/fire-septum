// Builds a Scenario from real data around a point:
//   weather    — Open-Meteo hourly forecast (real)
//   hotspots   — NASA FIRMS VIIRS detections (real, needs FIRMS_MAP_KEY on the server)
//   terrain    — AWS Terrain Tiles (real)
//   peat soil  — Global Forest Watch global peatland layer (real)
//   land cover — ESA WorldCover 2021 (real)
//   barriers   — dated OpenStreetMap snapshot (public/data/osm-barriers, barriers.ts): canals,
//                rivers, major roads, water and built-up areas as non-burnable cells; ditches,
//                drains, streams, minor roads and tracks as partial fuel breaks (FireState.brk);
//                distance to drainage for the drained-peat term (Landscape.drainM). Live Overpass
//                only for boxes the snapshot does not cover.
//   fuel       — SYNTHETIC zone defaults only where those layers fail or have no data
//
// All network and file access goes through a DataEnv (env.ts): the browser by default, Node with
// scripts/lib/node-env.ts.
import { DEFAULT_RATES, type Rates } from '../sim/doctrine';
import { FUEL_INDEX, FUEL_LIST } from '../sim/fuels';
import { buildZoneIndex, burnDisc, emptyState, gridZones, igniteDisc } from '../sim/landscape';
import { DEFAULT_PARAMS } from '../sim/model';
import { fbm } from '../sim/rng';
import { CELL_M, GRID } from '../sim/scenarios';
import { Cell, type DataProvenance, type FuelId, type Hotspot, type Landscape, type Scenario, type Zone } from '../sim/types';
import { loadBarrierIndex, loadBarriers, rasterizeBarriers, snapshotCovers, snapshotDate } from './barriers';
import { browserEnv, type DataEnv } from './env';
import { FIRMS_SOURCES, FirmsKeyMissing, type RawHotspot } from './firms';
import { sampleFireHistory } from './fireHistorySample';
import { fetchLandCover, fuelFromCover, onPeatSoil } from './landcover';
import { fetchWeather, fetchWeatherAt, type LiveWeather } from './openmeteo';
import { fetchOsmFuel } from './osm';
import { fetchPeatMask } from './peat';
import { fetchElevationGrid } from './terrain';

export interface LiveOptions {
  lat: number;
  lon: number;
  /** Zone defaults used only where the peat and land-cover layers have nothing. */
  zoneFuels?: FuelId[];
  horizonH?: number;
  /** Hand-placed ignitions (cell coords) when FIRMS is unavailable or empty. */
  manualIgnitions?: { x: number; y: number }[];
  /** Replay a past moment (hindcast): start time, the detections known by then, and what was seen after. */
  past?: { t0: string; known: RawHotspot[]; observed: RawHotspot[]; windowH: number };
  /** Map rivers, canals and roads (default true). False only for reference runs without them. */
  barriers?: boolean;
  /** Drained-peat term from distance to canals and ditches (default true; needs the snapshot). */
  drainage?: boolean;
  /** Rates for the partial fuel-break strengths (default DEFAULT_RATES). */
  rates?: Rates;
  /**
   * Weather supplied by the caller instead of an Open-Meteo request (batch runs that read cached
   * ERA5, scripts/ml/). `note` replaces the provenance text.
   */
  weather?: LiveWeather & { note?: string };
}

/** Barriers for one box, ready to lay over the fuel map. */
export interface BarrierLayer {
  source: NonNullable<DataProvenance['barriers']>;
  /** Full barriers: water / settlement override per cell. */
  fuel: (FuelId | null)[] | null;
  /** Partial fuel-break strength per cell. */
  brk: Float32Array | null;
  /** Metres to the nearest canal, ditch or drain. */
  drainM: Float32Array | null;
  /** Features that touched the grid. */
  features: number;
  /** Snapshot OSM date, YYYY-MM-DD (snapshot source only). */
  date?: string;
  /** Why the snapshot was not used, when it was not. */
  why?: string;
}

/** Kinds that only slow fire, and the rate that sets each one's strength. */
export function partialStrengths(r: Rates = DEFAULT_RATES): Record<string, number> {
  const water = r.brkNarrowWater ?? DEFAULT_RATES.brkNarrowWater!, track = r.brkTrack ?? DEFAULT_RATES.brkTrack!;
  return { ditch: water, drain: water, stream: water, road_minor: track, track };
}

/**
 * Barriers from the OSM snapshot where it covers the box, else from a live Overpass query, else
 * none. Never rejects: the source says what happened.
 */
export async function loadBarrierLayer(geo: { north: number; south: number; west: number; east: number }, w: number, h: number, env: DataEnv, rates: Rates = DEFAULT_RATES): Promise<BarrierLayer> {
  let why = '';
  try {
    const index = await loadBarrierIndex(env.fetchJson);
    if (!index) why = 'the OSM snapshot is not shipped with this build';
    else if (!snapshotCovers(index, geo)) why = 'the OSM snapshot (Kalimantan and Sumatra) does not cover this box';
    else {
      const feats = await loadBarriers(geo, env.fetchJson);
      const r = rasterizeBarriers(geo, w, h, feats, { partial: partialStrengths(rates) });
      return { source: 'snapshot', fuel: r.fuel, brk: r.brk, drainM: r.drainDistM, features: r.features, date: snapshotDate(index) };
    }
  } catch (e) {
    why = `the OSM snapshot failed to load (${e instanceof Error ? e.message : String(e)})`;
  }
  try {
    const o = await fetchOsmFuel(geo, w, h, env.overpass);
    return { source: 'overpass', fuel: o.fuel, brk: null, drainM: null, features: o.features, why };
  } catch (e) {
    return { source: 'none', fuel: null, brk: null, drainM: null, features: 0, why: `${why}, and Overpass is unavailable (${e instanceof Error ? e.message : String(e)})` };
  }
}

export function bboxAround(lat: number, lon: number, sizeM = GRID * CELL_M) {
  const dLat = sizeM / 2 / 111_320;
  const dLon = sizeM / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { north: lat + dLat, south: lat - dLat, west: lon - dLon, east: lon + dLon };
}

export interface LiveBuild {
  scenario: Scenario;
  warnings: string[];
}

const pct = (x: number) => (x > 0 && x < 0.01 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`);

export async function buildLiveScenario(o: LiveOptions, env: DataEnv = browserEnv): Promise<LiveBuild> {
  const horizonH = o.horizonH ?? 48;
  const rates = o.rates ?? DEFAULT_RATES;
  const useBarriers = o.barriers ?? true, useDrainage = o.drainage ?? true;
  const geo = bboxAround(o.lat, o.lon);
  const warnings: string[] = [];
  const w = GRID, h = GRID;

  const past = o.past;
  // Fire history counts only years before the scenario's own, so a fire never counts itself.
  const fireYear = new Date(past ? Date.parse(past.t0) : Date.now()).getUTCFullYear();
  const [weatherR, firesR, elevR, peatR, coverR, barrierR, historyR] = await Promise.allSettled([
    o.weather ? Promise.resolve(o.weather) : past ? fetchWeatherAt(o.lat, o.lon, past.t0, horizonH, env.getJson) : fetchWeather(o.lat, o.lon, horizonH, env.getJson),
    past ? Promise.resolve({ hotspots: past.known, sources: FIRMS_SOURCES, fetchedAt: '' }) : env.firms([geo.west, geo.south, geo.east, geo.north], 2),
    fetchElevationGrid(geo, w, h, 13, env.fetchTile),
    fetchPeatMask(geo, w, h, env.fetchTile),
    fetchLandCover(geo, w, h, env.fetchTile),
    useBarriers ? loadBarrierLayer(geo, w, h, env, rates) : Promise.resolve<BarrierLayer>({ source: 'off', fuel: null, brk: null, drainM: null, features: 0 }),
    sampleFireHistory(geo, w, h, fireYear, env),
  ]);
  if (weatherR.status === 'rejected') throw new Error(`Weather unavailable: ${weatherR.reason}`);
  const weather = weatherR.value;

  let elev: Float32Array;
  let terrainNote = 'AWS Terrain Tiles (real)';
  if (elevR.status === 'fulfilled') elev = elevR.value;
  else { elev = new Float32Array(w * h).fill(15); terrainNote = 'Flat (terrain tiles unavailable)'; warnings.push('Terrain tiles could not be loaded, using flat ground.'); }

  let raw: RawHotspot[] = [];
  let hotspotNote: string;
  if (firesR.status === 'fulfilled') {
    raw = firesR.value.hotspots;
    hotspotNote = past
      ? `NASA FIRMS ${firesR.value.sources.join(' + ')}, detections up to ${past.t0.slice(0, 16).replace('T', ' ')} UTC (${raw.length} in area)`
      : `NASA FIRMS ${firesR.value.sources.join(' + ')}, last 48 h (${raw.length} detections in area)`;
    if (raw.length === 0) warnings.push('FIRMS returned no detections in this 6.4 km box in the last 48 h. Pick an active cluster or place ignitions by hand.');
  } else if (firesR.reason instanceof FirmsKeyMissing) {
    hotspotNote = 'Not loaded — FIRMS_MAP_KEY not set';
    warnings.push('NASA FIRMS key missing: hotspots not loaded. Add FIRMS_MAP_KEY to .env (free) or place ignitions by hand.');
  } else {
    hotspotNote = 'Not loaded — FIRMS request failed';
    warnings.push(`FIRMS request failed: ${String(firesR.reason)}`);
  }

  // 3×3 zones (A–I, row-major from the north-west): a real cluster usually spans the
  // centre, which leaves unburned outer zones for the recommender to protect.
  const zoneFuels = o.zoneFuels ?? ['peat', 'shrub', 'peat', 'shrub', 'peat', 'shrub', 'peat', 'shrub', 'peat'];
  const zones: Zone[] = gridZones(w, h, 3, 3, zoneFuels).map((z) => ({ ...z, name: `Zone ${z.id}` }));
  const fuel = new Uint8Array(w * h);
  const zoneOf = buildZoneIndex(w, h, zones);
  const seed = Math.round(o.lat * 1000) ^ Math.round(o.lon * 1000);
  const peat = peatR.status === 'fulfilled' ? peatR.value : null;
  const cover = coverR.status === 'fulfilled' && coverR.value.known > 0 ? coverR.value : null;
  let synthetic = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    const onPeat = peat ? peat.peat[k] === 1 : false;
    let id: FuelId | null = cover ? fuelFromCover(cover.cls[k], onPeat) : null;
    if (!id) {
      // Zone default with a little texture, bent to the peat mask when there is one.
      id = zones[zoneOf[k]].fuel;
      if ((id === 'shrub' || id === 'peat') && fbm(x / 9, y / 9, seed) > 0.68) id = 'grass';
      if (peat) id = onPeatSoil(id, onPeat);
      synthetic++;
    }
    fuel[k] = FUEL_INDEX[id];
  }
  const notes: string[] = [];
  if (peat) notes.push(`Peat soil: Global Forest Watch peatland map (real), ${pct(peat.share)} of cells`);
  else { notes.push('Peat soil: SYNTHETIC (peat map unavailable)'); warnings.push('The peat map could not be loaded, so the emission numbers are illustrative only.'); }
  if (cover) notes.push(`Land cover: ESA WorldCover 2021 (real), ${pct(cover.known)} of cells${synthetic ? `; ${pct(synthetic / (w * h))} SYNTHETIC` : ''}`);
  else { notes.push('Land cover: SYNTHETIC zone types'); warnings.push(coverR.status === 'rejected' ? 'Land cover tiles could not be loaded: vegetation types are synthetic.' : 'No land-cover data here: vegetation types are synthetic.'); }

  // Rivers, canals and roads: full barriers become water / settlement cells; partial ones (ditches,
  // tracks) are fuel breaks laid into the initial state below.
  const bl: BarrierLayer = barrierR.status === 'fulfilled' ? barrierR.value : { source: 'none', fuel: null, brk: null, drainM: null, features: 0, why: String(barrierR.reason) };
  let fullCells = 0;
  if (bl.fuel) {
    bl.fuel.forEach((f, k) => {
      if (!f) return;
      // Snapshot barriers are water / settlement only; Overpass also brings land use, bent to the peat mask.
      fuel[k] = FUEL_INDEX[peat ? onPeatSoil(f, peat.peat[k] === 1) : f];
      fullCells++;
    });
  }
  const drainM = useDrainage && bl.drainM ? bl.drainM : undefined;
  if (bl.source === 'snapshot') {
    const partialCells = bl.brk ? bl.brk.reduce((a, v, k) => a + (v > 0 && FUEL_LIST[fuel[k]].burnable ? 1 : 0), 0) : 0;
    const ps = partialStrengths(rates);
    notes.push(
      `Barriers: OpenStreetMap snapshot of ${bl.date} (Geofabrik extract, ${bl.features} features): canals, rivers, major roads, water and built-up areas non-burnable on ${pct(fullCells / (w * h))} of cells (${fullCells}); ` +
      `ditches, drains and streams (fuel-break strength ${ps.ditch}) and minor roads and tracks (${ps.track}) slow spread on ${pct(partialCells / (w * h))} (${partialCells} cells)` +
      (drainM ? `. Drained peat: spread hazard on peat soil × (1 + ${rates.drainK ?? 0}·exp(−d/${rates.drainLM ?? 1} m)), d = distance to the nearest canal, ditch or drain` : '. No drained-peat term'),
    );
    if (bl.features === 0) warnings.push(`The OpenStreetMap snapshot (${bl.date}) has no rivers, canals or roads mapped in this box.`);
  } else if (bl.source === 'overpass') {
    notes.push(`Barriers: live OpenStreetMap (Overpass) query, because ${bl.why}: water, roads and land use on ${pct(fullCells / (w * h))} of cells (${bl.features} features), every waterway and road a full barrier, no drained-peat term`);
    if (bl.features === 0) warnings.push('No OpenStreetMap water, road or land-use features in this box.');
  } else if (bl.source === 'off') {
    notes.push('Barriers: switched off for this run (rivers, canals and roads ignored)');
  } else {
    notes.push('Barriers: NONE. Rivers, canals and roads are not in the fuel map');
    warnings.push(`NO BARRIERS: ${bl.why}. Rivers, canals and roads are missing from this forecast, so fire can cross them.`);
  }
  // Sea level cells from the DEM are water too.
  if (elevR.status === 'fulfilled') {
    for (let k = 0; k < w * h; k++) if (elev[k] <= 0.5) fuel[k] = FUEL_INDEX.water;
  }
  // Each zone is described by its most common burnable fuel (the recommender reads zone.fuel).
  for (const z of zones) {
    const count = new Map<FuelId, number>();
    for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) {
      const f = FUEL_LIST[fuel[y * w + x]];
      if (f.burnable) count.set(f.id, (count.get(f.id) ?? 0) + 1);
    }
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) z.fuel = top[0];
  }

  // Earlier fire years per cell set the burn-depth class of burned peat (carbon.ts).
  const history = historyR.status === 'fulfilled' ? historyR.value : null;
  if (history) {
    let peatCells = 0;
    const byClass = [0, 0, 0, 0];
    for (let k = 0; k < w * h; k++) {
      if (!peat || peat.peat[k] !== 1) continue;
      peatCells++;
      byClass[Math.min(3, history.years[k])]++;
    }
    notes.push(
      `Fire history: NASA FIRMS MODIS and VIIRS detections ${history.archive[0]}–${Math.min(history.archive[1], history.beforeYear - 1)} (real), years before ${history.beforeYear} only` +
      (peatCells ? `; of ${peatCells} peat cells ${pct(byClass[0] / peatCells)} had no earlier fire year, ${pct(byClass[1] / peatCells)} one, ${pct(byClass[2] / peatCells)} two, ${pct(byClass[3] / peatCells)} three or more` : ''),
    );
  } else {
    notes.push('Fire history: not loaded, so burned peat uses the flat IPCC burn depth');
    if (historyR.status === 'rejected') warnings.push(`Fire history could not be loaded (${String(historyR.reason)}): emissions use the flat IPCC burn depth.`);
  }

  const l: Landscape = { w, h, cellM: CELL_M, fuel, elev, zoneOf, zones, geo };
  if (drainM) l.drainM = drainM;
  if (history) l.fireYears = history.years;
  const init = emptyState(l);
  if (bl.brk) for (let k = 0; k < w * h; k++) if (bl.brk[k] > 0 && init.state[k] === Cell.Fuel) init.brk[k] = bl.brk[k];
  const now = past ? Date.parse(past.t0) : Date.now();
  const toCell = (r: RawHotspot): Hotspot => ({
    ...r,
    x: ((r.lon - geo.west) / (geo.east - geo.west)) * w - 0.5,
    y: ((geo.north - r.lat) / (geo.north - geo.south)) * h - 0.5,
  });
  const inBox = (p: Hotspot) => !(p.x < -2 || p.y < -2 || p.x > w + 1 || p.y > h + 1);
  const hotspots: Hotspot[] = [];
  for (const r of raw) {
    const { x, y } = toCell(r);
    if (!inBox({ ...r, x, y })) continue;
    const ageH = (now - Date.parse(r.acquired)) / 3.6e6;
    // VIIRS I-band pixels are ~375 m → radius ≈ 1.9 cells at 100 m. Older than 24 h = burned scar.
    if (ageH > 24) burnDisc(l, init, x, y, 1.9);
    else igniteDisc(l, init, x, y, 1.9, DEFAULT_PARAMS.dtH);
    hotspots.push({ ...r, x, y });
  }
  for (const m of o.manualIgnitions ?? []) igniteDisc(l, init, m.x, m.y, 1.5, DEFAULT_PARAMS.dtH);

  const when = past ? `${past.t0.slice(0, 16).replace('T', ' ')} UTC` : '';
  const lastPass = raw.map((r) => r.acquired).sort().at(-1);
  const fmtPass = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  const provenance: DataProvenance = {
    kind: 'mixed',
    weather: o.weather
      ? (o.weather.note ?? `Supplied by the caller (${o.weather.url})`)
      : past
      ? `Open-Meteo historical forecast archive (real), from ${when}`
      : `Open-Meteo hourly forecast (real), fetched ${new Date(weather.fetchedAt).toLocaleString()}`,
    hotspots: hotspotNote,
    fuel: `${notes.join('. ')}. Terrain: ${terrainNote}`,
    peatMap: peat ? 'real' : 'synthetic',
    barriers: bl.source,
    fetchedAt: weather.fetchedAt,
  };
  return {
    warnings,
    scenario: {
      id: past ? `hindcast-${o.lat.toFixed(3)},${o.lon.toFixed(3)}@${past.t0}` : `live-${o.lat.toFixed(3)},${o.lon.toFixed(3)}`,
      title: past ? `Past day: ${o.lat.toFixed(3)}, ${o.lon.toFixed(3)} from ${when}` : `Live fire near ${o.lat.toFixed(3)}, ${o.lon.toFixed(3)}`,
      description: past
        ? `Forecast made as if it were ${when}, using only data available then. The rings are what satellites detected in the next ${past.windowH} h.`
        : lastPass
          ? `Latest satellite pass ${fmtPass(lastPass)}. Live weather, terrain, peat and land cover, 6.4 × 6.4 km.`
          : `No satellite detections in the last 48 h. Live weather, terrain, peat and land cover, 6.4 × 6.4 km.`,
      provenance,
      landscape: l,
      weather: weather.hours,
      init,
      horizonH: Math.min(horizonH, weather.hours.length - 1),
      antecedentRainMm: weather.antecedentRainMm,
      hotspots,
      hindcast: past ? { t0: past.t0, windowH: past.windowH, observed: past.observed.map(toCell).filter(inBox) } : undefined,
    },
  };
}
