// Builds a Scenario from real data around a point:
//   weather    — Open-Meteo hourly forecast (real)
//   hotspots   — NASA FIRMS VIIRS detections (real, needs FIRMS_MAP_KEY on the server)
//   terrain    — AWS Terrain Tiles (real)
//   peat soil  — Global Forest Watch global peatland layer (real)
//   land cover — ESA WorldCover 2021 (real), with OpenStreetMap water, roads and land use on top
//   fuel       — SYNTHETIC zone defaults only where those layers fail or have no data
import { FUEL_INDEX, FUEL_LIST } from '../sim/fuels';
import { buildZoneIndex, burnDisc, emptyState, gridZones, igniteDisc } from '../sim/landscape';
import { DEFAULT_PARAMS } from '../sim/model';
import { fbm } from '../sim/rng';
import { CELL_M, GRID } from '../sim/scenarios';
import type { DataProvenance, FuelId, Hotspot, Landscape, Scenario, Zone } from '../sim/types';
import { FirmsKeyMissing, fetchHotspots, type RawHotspot } from './firms';
import { fetchLandCover, fuelFromCover, onPeatSoil } from './landcover';
import { fetchWeather, fetchWeatherAt } from './openmeteo';
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

const pct = (x: number) => `${Math.round(x * 100)}%`;

export async function buildLiveScenario(o: LiveOptions): Promise<LiveBuild> {
  const horizonH = o.horizonH ?? 48;
  const geo = bboxAround(o.lat, o.lon);
  const warnings: string[] = [];
  const w = GRID, h = GRID;

  const past = o.past;
  const [weatherR, firesR, elevR, osmR, peatR, coverR] = await Promise.allSettled([
    past ? fetchWeatherAt(o.lat, o.lon, past.t0, horizonH) : fetchWeather(o.lat, o.lon, horizonH),
    past ? Promise.resolve({ hotspots: past.known, sources: ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'], fetchedAt: '' }) : fetchHotspots([geo.west, geo.south, geo.east, geo.north], 2),
    fetchElevationGrid(geo, w, h),
    fetchOsmFuel(geo, w, h),
    fetchPeatMask(geo, w, h),
    fetchLandCover(geo, w, h),
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

  // Real barriers and land use from OpenStreetMap where mapped, made to agree with the peat mask.
  if (osmR.status === 'fulfilled' && osmR.value.features > 0) {
    let mapped = 0;
    osmR.value.fuel.forEach((f, k) => { if (f) { fuel[k] = FUEL_INDEX[peat ? onPeatSoil(f, peat.peat[k] === 1) : f]; mapped++; } });
    notes.push(`OpenStreetMap water/roads/land use on ${pct(mapped / (w * h))} of cells (${osmR.value.features} features)`);
  } else {
    warnings.push(osmR.status === 'rejected' ? 'OpenStreetMap (Overpass) unavailable: rivers and roads are not in the fuel map.' : 'No OpenStreetMap water/land-use features here.');
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

  const l: Landscape = { w, h, cellM: CELL_M, fuel, elev, zoneOf, zones, geo };
  const init = emptyState(l);
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
    weather: past
      ? `Open-Meteo historical forecast archive (real), from ${when}`
      : `Open-Meteo hourly forecast (real), fetched ${new Date(weather.fetchedAt).toLocaleString()}`,
    hotspots: hotspotNote,
    fuel: `${notes.join('. ')}. Terrain: ${terrainNote}`,
    peatMap: peat ? 'real' : 'synthetic',
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
