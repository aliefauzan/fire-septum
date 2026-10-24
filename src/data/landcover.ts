// Land cover from ESA WorldCover 2021 (10 m, Zanaga et al. 2022, CC BY 4.0), read through the
// Microsoft Planetary Computer tile API (keyless, open CORS). Without a colormap the PNG carries
// the class code in the grey channel; alpha 0 means the pixel lies outside the requested item.
import type { FuelId } from '../sim/types';
import { sampleTiles, type Geo, type TileFetcher } from './tiles';

/** WorldCover class codes. */
export const WC = { tree: 10, shrub: 20, grass: 30, crop: 40, built: 50, bare: 60, snow: 70, water: 80, wetland: 90, mangrove: 95, moss: 100 } as const;

/** ~19 m per pixel at the equator: four to five pixels per 100 m cell. */
export const LANDCOVER_Z = 13;

/** WorldCover is published in 3° × 3° items named by their south-west corner. */
export function worldcoverItem(lat: number, lon: number): string {
  const la = Math.floor(lat / 3) * 3, lo = Math.floor(lon / 3) * 3;
  const ns = la < 0 ? 'S' : 'N', ew = lo < 0 ? 'W' : 'E';
  return `ESA_WorldCover_10m_2021_v200_${ns}${String(Math.abs(la)).padStart(2, '0')}${ew}${String(Math.abs(lo)).padStart(3, '0')}`;
}

export const landcoverTileUrl = (z: number, x: number, y: number, lat: number, lon: number) =>
  `https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/${z}/${x}/${y}@1x?collection=esa-worldcover&item=${worldcoverItem(lat, lon)}&assets=map&format=png`;

export interface LandCover {
  /** WorldCover class per cell; 0 = no data. */
  cls: Uint8Array;
  /** Share of cells with a class, 0..1. */
  known: number;
}

export async function fetchLandCover(geo: Geo, w: number, h: number, fetchTile?: TileFetcher): Promise<LandCover> {
  const v = await sampleTiles(geo, w, h, LANDCOVER_Z, landcoverTileUrl, (d, i) => (d.data[i + 3] > 0 ? d.data[i] : 0), fetchTile);
  const cls = Uint8Array.from(v);
  let n = 0;
  for (let k = 0; k < cls.length; k++) if (cls[k] > 0) n++;
  return { cls, known: n / Math.max(1, cls.length) };
}

/**
 * Land cover class + peat soil → simulator fuel. On peat soil every burnable cover is a peat
 * fuel (so the peat emission count follows the soil, not the vegetation): closed tree cover is
 * peat swamp forest, anything else is degraded peat shrub, including cropland, which on
 * Kalimantan peat is mostly dryland smallholder plots and fallow that burn. Off peat, tree cover
 * is treated as plantation (oil palm and acacia read as trees in WorldCover), and herbaceous
 * wetland and mangrove as wet farmland, which barely carries fire. Null = no information.
 */
export function fuelFromCover(cls: number, onPeat: boolean): FuelId | null {
  if (cls === WC.water) return 'water';
  if (cls === WC.built) return 'settlement';
  if (cls === WC.mangrove) return 'agri';
  if (cls === 0 || cls === WC.snow || cls === WC.moss) return null;
  if (onPeat) return cls === WC.tree ? 'peat' : 'shrub';
  if (cls === WC.tree) return 'plantation';
  if (cls === WC.crop || cls === WC.wetland) return 'agri';
  return 'grass';
}

/** Make a fuel from another source (zone default, OpenStreetMap) agree with the peat mask. */
export function onPeatSoil(fuel: FuelId, onPeat: boolean): FuelId {
  if (onPeat) return fuel === 'grass' ? 'shrub' : fuel;
  if (fuel === 'peat') return 'plantation';
  if (fuel === 'shrub') return 'grass';
  return fuel;
}
