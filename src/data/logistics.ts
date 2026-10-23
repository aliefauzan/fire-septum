// Suppression logistics around a fire from OpenStreetMap: bases (Manggala Agni,
// BPBD, fire stations), landing sites, the nearest mapped water for bucket dips and
// the nearest road. Only mapped features: absence on the map is not absence on the ground.
import type { Facility, FacilityKind, Logistics } from '../sim/resources';

interface OsmEl {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

const KM_PER_DEG = 111.32;

export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dy = (lat2 - lat1) * KM_PER_DEG;
  const dx = (lon2 - lon1) * KM_PER_DEG * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

function kindOf(t: Record<string, string>): FacilityKind | null {
  const name = `${t.name ?? ''} ${t.operator ?? ''}`;
  if (/manggala\s*agni|\bdaops\b/i.test(name)) return 'manggala';
  if (/\b(BPBD|BNPB)\b/.test(name)) return 'agency';
  if (t.amenity === 'fire_station') return 'fire_station';
  if (t.aeroway === 'heliport' || t.aeroway === 'helipad' || t.aeroway === 'aerodrome' || t.aeroway === 'airstrip') return t.aeroway;
  return null;
}

/** Turn an Overpass response into logistics relative to (lat, lon). Exported for tests. */
export function parseLogistics(json: { elements: OsmEl[]; origin?: string; snapshotAt?: string }, lat: number, lon: number): Logistics {
  const facilities: Facility[] = [];
  let dip: Logistics['dip'] = null;
  let roadKm: number | null = null;
  for (const e of json.elements) {
    const t = e.tags ?? {};
    const kind = kindOf(t);
    if (kind) {
      const p = e.lat !== undefined ? { lat: e.lat, lon: e.lon! } : e.center;
      if (!p) continue;
      facilities.push({ id: `${e.type}/${e.id}`, name: t.name ?? `Unnamed ${kind.replace('_', ' ')}`, kind, lat: p.lat, lon: p.lon, km: kmBetween(lat, lon, p.lat, p.lon) });
      continue;
    }
    if (!e.geometry?.length) continue;
    let best = Infinity, bp = e.geometry[0];
    for (const g of e.geometry) { const d = kmBetween(lat, lon, g.lat, g.lon); if (d < best) { best = d; bp = g; } }
    if (t.waterway || t.natural === 'water') {
      if (!dip || best < dip.km) dip = { km: best, name: t.name ?? (t.waterway ? `unnamed ${t.waterway}` : 'unnamed water body'), lat: bp.lat, lon: bp.lon };
    } else if (t.highway) {
      roadKm = Math.min(roadKm ?? Infinity, best);
    }
  }
  facilities.sort((a, b) => a.km - b.km);
  const source = json.origin === 'snapshot'
    ? `OpenStreetMap snapshot of ${json.snapshotAt?.slice(0, 10) ?? '?'} (live Overpass busy): bases only, no water or roads`
    : 'OpenStreetMap via Overpass (live)';
  return { facilities, dip, roadKm, waterChecked: json.origin !== 'snapshot', source };
}

export async function fetchLogistics(lat: number, lon: number, signal?: AbortSignal): Promise<Logistics> {
  const r = await fetch(`/api/osm-resources?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, { signal });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `HTTP ${r.status}`);
  return parseLogistics(await r.json(), lat, lon);
}
