import type { FuelId, FuelType } from './types';

// p_veg / p_den follow the form of Alexandridis et al. (2008), whose published values
// were calibrated for Mediterranean vegetation on Spetses island. The mapping to
// Indonesian land cover below is our own heuristic and is NOT a calibrated result.
export const FUEL_LIST: FuelType[] = [
  { id: 'grass', label: 'Fern / alang-alang grass', pveg: 0.4, pden: 0.0, burnHours: 1, burnable: true, color: '#c9b46a' },
  { id: 'shrub', label: 'Degraded peat shrub', pveg: 0.3, pden: 0.3, burnHours: 4, burnable: true, color: '#8f9a4e' },
  { id: 'peat', label: 'Peat swamp forest', pveg: 0.0, pden: 0.3, burnHours: 12, burnable: true, color: '#4f6b3a' },
  { id: 'plantation', label: 'Plantation (oil palm / acacia)', pveg: -0.1, pden: 0.0, burnHours: 3, burnable: true, color: '#6f8f45' },
  // Wet or flooded fields barely carry fire; only dry stubble and field edges do.
  { id: 'agri', label: 'Wet farmland / rice field', pveg: -0.7, pden: -0.7, burnHours: 1, burnable: true, color: '#a8b98a' },
  { id: 'water', label: 'River / canal', pveg: 0, pden: 0, burnHours: 0, burnable: false, color: '#4d7ea8' },
  { id: 'settlement', label: 'Village / road', pveg: 0, pden: 0, burnHours: 0, burnable: false, color: '#9a8f86' },
];

export const FUEL_INDEX: Record<FuelId, number> = Object.fromEntries(
  FUEL_LIST.map((f, i) => [f.id, i]),
) as Record<FuelId, number>;

export const fuelOf = (idx: number): FuelType => FUEL_LIST[idx];

/** Fuels on peat soil, where peat injection and soaking apply. */
export const ON_PEAT = new Set<FuelId>(['peat', 'shrub']);
