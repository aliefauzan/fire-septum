import { FUEL_INDEX, FUEL_LIST } from './fuels';
import { Cell, type FireState, type Landscape, type Zone } from './types';

export const idx = (l: Pick<Landscape, 'w'>, x: number, y: number) => y * l.w + x;

/** Split the grid into cols × rows rectangular zones named A, B, C, ... (row-major). */
export function gridZones(w: number, h: number, cols: number, rows: number, fuels: Zone['fuel'][]): Zone[] {
  const zones: Zone[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const id = String.fromCharCode(65 + i);
      zones.push({
        id,
        name: `Zone ${id}`,
        x0: Math.round((c * w) / cols),
        x1: Math.round(((c + 1) * w) / cols),
        y0: Math.round((r * h) / rows),
        y1: Math.round(((r + 1) * h) / rows),
        fuel: fuels[i] ?? 'shrub',
        weight: 1,
      });
    }
  }
  return zones;
}

export function buildZoneIndex(w: number, h: number, zones: Zone[]): Uint8Array {
  const zoneOf = new Uint8Array(w * h).fill(255);
  zones.forEach((z, zi) => {
    for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) zoneOf[y * w + x] = zi;
  });
  return zoneOf;
}

export function emptyState(l: Landscape): FireState {
  const n = l.w * l.h;
  const state = new Uint8Array(n);
  for (let k = 0; k < n; k++) state[k] = FUEL_LIST[l.fuel[k]].burnable ? Cell.Fuel : Cell.NonFuel;
  return { state, remaining: new Uint16Array(n), wet: new Float32Array(n), brk: new Float32Array(n) };
}

export function cloneState(s: FireState): FireState {
  return { state: s.state.slice(), remaining: s.remaining.slice(), wet: s.wet.slice(), brk: s.brk.slice() };
}

/** Ignite every burnable cell within `radius` cells of (cx, cy). */
export function igniteDisc(l: Landscape, s: FireState, cx: number, cy: number, radius: number, dtH: number) {
  const r2 = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(l.h - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(l.w - 1, Math.ceil(cx + radius)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      const k = y * l.w + x;
      if (s.state[k] !== Cell.Fuel) continue;
      s.state[k] = Cell.Burning;
      s.remaining[k] = Math.max(1, Math.round(FUEL_LIST[l.fuel[k]].burnHours / dtH));
    }
  }
}

/** Mark cells as already burned out (scar behind the active front). */
export function burnDisc(l: Landscape, s: FireState, cx: number, cy: number, radius: number) {
  const r2 = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(l.h - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(l.w - 1, Math.ceil(cx + radius)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      const k = y * l.w + x;
      if (s.state[k] === Cell.Fuel || s.state[k] === Cell.Burning) s.state[k] = Cell.Burned;
    }
  }
}

/**
 * Slope (degrees) and aspect (degrees clockwise from north, downslope direction)
 * using the 3×3 Horn kernel described in Köse et al. (2008), IEEE 3DTV-CON,
 * doi:10.1109/3DTV.2008.4547885.
 */
export function slopeAspect(l: Landscape, x: number, y: number): { slope: number; aspect: number } {
  const e = (dx: number, dy: number) => {
    const xx = Math.min(l.w - 1, Math.max(0, x + dx));
    const yy = Math.min(l.h - 1, Math.max(0, y + dy));
    return l.elev[yy * l.w + xx];
  };
  const d = l.cellM;
  const dzdx = (e(1, -1) + 2 * e(1, 0) + e(1, 1) - (e(-1, -1) + 2 * e(-1, 0) + e(-1, 1))) / (8 * d);
  const dzdy = (e(-1, 1) + 2 * e(0, 1) + e(1, 1) - (e(-1, -1) + 2 * e(0, -1) + e(1, -1))) / (8 * d);
  const slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  // Downslope vector in (east, north): east = -dz/dx, north = +dz/dy (y grows south).
  const aspect = ((Math.atan2(-dzdx, dzdy) * 180) / Math.PI + 360) % 360;
  return { slope, aspect };
}

export const fuelIndex = (id: Zone['fuel']) => FUEL_INDEX[id];
