// Peat soil from Global Forest Watch's global peatland layer (gfw_peatlands v20230315), served
// as keyless PNG tiles with open CORS. In the tropics the layer is Gumbricht et al. 2017 (CIFOR
// Tropical and Subtropical Wetlands Distribution v2, 232 m). Peat pixels are opaque, the rest
// transparent, so the alpha channel is the mask.
import { sampleTiles, type Geo, type TileFetcher } from './tiles';

/** Native resolution of the layer; tiles above z12 are the same raster upsampled. */
export const PEAT_Z = 12;

export const peatTileUrl = (z: number, x: number, y: number) =>
  `https://tiles.globalforestwatch.org/gfw_peatlands/latest/default/${z}/${x}/${y}.png`;

export interface PeatMask {
  /** 1 where the cell centre is on mapped peat. */
  peat: Uint8Array;
  /** Share of cells on peat, 0..1. */
  share: number;
}

export async function fetchPeatMask(geo: Geo, w: number, h: number, fetchTile?: TileFetcher): Promise<PeatMask> {
  const v = await sampleTiles(geo, w, h, PEAT_Z, peatTileUrl, (d, i) => (d.data[i + 3] > 0 ? 1 : 0), fetchTile);
  const peat = Uint8Array.from(v);
  let n = 0;
  for (let k = 0; k < peat.length; k++) n += peat[k];
  return { peat, share: n / Math.max(1, peat.length) };
}
