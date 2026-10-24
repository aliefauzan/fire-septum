// Real elevation from the public AWS Terrain Tiles (Terrarium encoding, no key):
//   elevation_m = (R × 256 + G + B / 256) − 32768
// https://registry.opendata.aws/terrain-tiles/
import { sampleTiles, type Geo, type TileFetcher } from './tiles';

export const terrainTileUrl = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/** Sample elevation at the centre of each grid cell of a w × h grid covering the bbox. */
export function fetchElevationGrid(geo: Geo, w: number, h: number, z = 13, fetchTile?: TileFetcher): Promise<Float32Array> {
  return sampleTiles(geo, w, h, z, terrainTileUrl, (d, i) => d.data[i] * 256 + d.data[i + 1] + d.data[i + 2] / 256 - 32768, fetchTile);
}
