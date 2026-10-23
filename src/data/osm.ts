// Real fuel/barrier hints from OpenStreetMap via the public Overpass API:
// water bodies, rivers and canals, main roads, settlements and land use.
// OSM coverage in rural Kalimantan/Sumatra is uneven; unmapped cells keep the
// synthetic zone fuel and the UI says so.
import type { FuelId } from '../sim/types';

interface Geo { north: number; south: number; west: number; east: number }
type LL = { lat: number; lon: number };
interface Feature { tags: Record<string, string>; geometry: LL[]; closed: boolean }

export interface OsmFuel {
  /** Fuel override per cell (null = no OSM information). */
  fuel: (FuelId | null)[];
  features: number;
}

function classify(tags: Record<string, string>): { fuel: FuelId; line: boolean; priority: number } | null {
  if (tags.natural === 'water' || tags.water || tags.landuse === 'reservoir' || tags.landuse === 'basin') return { fuel: 'water', line: false, priority: 5 };
  if (/^(river|canal|stream|ditch|drain)$/.test(tags.waterway ?? '')) return { fuel: 'water', line: true, priority: 5 };
  if (/^(motorway|trunk|primary|secondary|tertiary)$/.test(tags.highway ?? '')) return { fuel: 'settlement', line: true, priority: 4 };
  if (/^(residential|industrial|commercial|retail)$/.test(tags.landuse ?? '')) return { fuel: 'settlement', line: false, priority: 3 };
  if (/^(farmland|meadow|paddy|rice)$/.test(tags.landuse ?? '') || tags.crop === 'rice') return { fuel: 'agri', line: false, priority: 2 };
  if (/^(plantation|orchard)$/.test(tags.landuse ?? '')) return { fuel: 'plantation', line: false, priority: 2 };
  if (tags.natural === 'wetland') return { fuel: 'peat', line: false, priority: 1 };
  if (tags.landuse === 'forest' || tags.natural === 'wood') return { fuel: 'peat', line: false, priority: 1 };
  if (tags.natural === 'scrub') return { fuel: 'shrub', line: false, priority: 1 };
  if (tags.natural === 'grassland' || tags.landuse === 'grass') return { fuel: 'grass', line: false, priority: 1 };
  return null;
}

function inside(p: LL, poly: LL[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) c = !c;
  }
  return c;
}

export async function fetchOsmFuel(geo: Geo, w: number, h: number): Promise<OsmFuel> {
  // Proxied through the dev server (see server/firmsProxy.ts) so Overpass gets a User-Agent.
  const bb = [geo.south, geo.west, geo.north, geo.east].map((v) => v.toFixed(5)).join(',');
  // Overpass is often overloaded: give up after 15 s rather than blocking the live scenario.
  const res = await fetch(`/api/osm?bbox=${bb}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Overpass proxy HTTP ${res.status}`);
  const j = await res.json();
  const feats: Feature[] = [];
  for (const el of j.elements ?? []) {
    if (el.type === 'way' && el.geometry) {
      const g = el.geometry as LL[];
      feats.push({ tags: el.tags ?? {}, geometry: g, closed: g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon });
    } else if (el.type === 'relation') {
      for (const m of el.members ?? []) if (m.role === 'outer' && m.geometry) feats.push({ tags: el.tags ?? {}, geometry: m.geometry, closed: true });
    }
  }

  const fuel: (FuelId | null)[] = new Array(w * h).fill(null);
  const prio = new Int8Array(w * h).fill(-1);
  const toCell = (p: LL) => ({
    x: ((p.lon - geo.west) / (geo.east - geo.west)) * w - 0.5,
    y: ((geo.north - p.lat) / (geo.north - geo.south)) * h - 0.5,
  });
  const set = (x: number, y: number, f: FuelId, pr: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const k = y * w + x;
    if (pr >= prio[k]) { prio[k] = pr; fuel[k] = f; }
  };

  // Areas first (lower priority), then lines on top.
  const sorted = feats.map((f) => ({ f, c: classify(f.tags) })).filter((x) => x.c).sort((a, b) => a.c!.priority - b.c!.priority);
  for (const { f, c } of sorted) {
    if (!c) continue;
    if (!c.line && f.closed) {
      const cells = f.geometry.map(toCell);
      const x0 = Math.max(0, Math.floor(Math.min(...cells.map((p) => p.x)))), x1 = Math.min(w - 1, Math.ceil(Math.max(...cells.map((p) => p.x))));
      const y0 = Math.max(0, Math.floor(Math.min(...cells.map((p) => p.y)))), y1 = Math.min(h - 1, Math.ceil(Math.max(...cells.map((p) => p.y))));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const lat = geo.north - ((y + 0.5) / h) * (geo.north - geo.south);
        const lon = geo.west + ((x + 0.5) / w) * (geo.east - geo.west);
        if (inside({ lat, lon }, f.geometry)) set(x, y, c.fuel, c.priority);
      }
    } else {
      // Rasterise each segment densely (4-connected) so fire cannot slip diagonally across.
      for (let i = 1; i < f.geometry.length; i++) {
        const a = toCell(f.geometry[i - 1]), b = toCell(f.geometry[i]);
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2) + 1;
        let px = Math.round(a.x), py = Math.round(a.y);
        for (let s = 0; s <= steps; s++) {
          const x = Math.round(a.x + ((b.x - a.x) * s) / steps), y = Math.round(a.y + ((b.y - a.y) * s) / steps);
          if (x !== px && y !== py) set(x, py, c.fuel, c.priority);
          set(x, y, c.fuel, c.priority);
          px = x; py = y;
        }
      }
    }
  }
  return { fuel, features: sorted.length };
}
