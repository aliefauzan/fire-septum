// What the incident actually has: resource inventory (entered by the commander,
// never invented for live data) and mapped logistics around the fire.

export interface Inventory {
  /** null = unknown. Actions that need an unknown resource are still simulated but flagged. */
  helicopters: number | null;
  crews: number | null;
  dozers: number | null;
  /** Fixed-wing aircraft for cloud seeding or dry ice (BMKG / BNPB). */
  aircraft: number | null;
  source: 'synthetic' | 'user' | 'unknown';
}

export const UNKNOWN_INVENTORY: Inventory = { helicopters: null, crews: null, dozers: null, aircraft: null, source: 'unknown' };
/** Exercise inventory for the synthetic scenarios only (labelled as such in the UI). */
export const SYNTHETIC_INVENTORY: Inventory = { helicopters: 2, crews: 4, dozers: 1, aircraft: 1, source: 'synthetic' };

export type FacilityKind = 'manggala' | 'agency' | 'fire_station' | 'heliport' | 'helipad' | 'aerodrome' | 'airstrip';

export interface Facility {
  id: string; // OSM element, e.g. node/123
  name: string;
  kind: FacilityKind;
  lat: number;
  lon: number;
  /** Straight-line distance from the fire centre. */
  km: number;
}

export interface Logistics {
  facilities: Facility[];
  /** Nearest mapped water body that could serve as a bucket dip site. */
  dip: { km: number; name: string; lat: number; lon: number } | null;
  /** Nearest mapped road to the fire centre. */
  roadKm: number | null;
  /** False when only the bases snapshot was available (water and roads were not queried). */
  waterChecked: boolean;
  source: string;
}

export const FACILITY_LABEL: Record<FacilityKind, string> = {
  manggala: 'Manggala Agni',
  agency: 'BPBD / agency office',
  fire_station: 'Fire station',
  heliport: 'Heliport',
  helipad: 'Helipad',
  aerodrome: 'Airport / aerodrome',
  airstrip: 'Airstrip',
};

export const nearest = (l: Logistics | null | undefined, kinds: FacilityKind[]) =>
  l?.facilities.filter((f) => kinds.includes(f.kind)).sort((a, b) => a.km - b.km)[0] ?? null;
