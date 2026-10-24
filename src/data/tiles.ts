// Shared sampler for Web-Mercator PNG tile layers: fetch each tile once, then read the pixel
// under the centre of every grid cell. Terrain, the peat mask and the land cover use it. Tiles
// come from a DataEnv (env.ts), so the same sampler runs in the browser and in Node.
import { browserEnv, type DecodedTile } from './env';

export interface Geo { north: number; south: number; west: number; east: number }

export type TileFetcher = (url: string) => Promise<DecodedTile>;

export const lonToX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const latToY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

/**
 * One value per cell of a w × h grid over `geo`, read from the tile pixel under the cell centre.
 * `urlFor` may depend on the cell's own lat/lon (layers split into items by region).
 * `pick` turns the RGBA bytes at offset `i` into the value.
 */
export async function sampleTiles(
  geo: Geo,
  w: number,
  h: number,
  z: number,
  urlFor: (z: number, x: number, y: number, lat: number, lon: number) => string,
  pick: (d: DecodedTile, i: number) => number,
  fetchTile: TileFetcher = browserEnv.fetchTile,
): Promise<Float32Array> {
  const tiles = new Map<string, Promise<DecodedTile>>();
  const get = (url: string) => {
    if (!tiles.has(url)) tiles.set(url, fetchTile(url));
    return tiles.get(url)!;
  };
  const out = new Float32Array(w * h);
  const jobs: Promise<void>[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lat = geo.north - ((y + 0.5) / h) * (geo.north - geo.south);
      const lon = geo.west + ((x + 0.5) / w) * (geo.east - geo.west);
      const fx = lonToX(lon, z), fy = latToY(lat, z);
      const tx = Math.floor(fx), ty = Math.floor(fy);
      const k = y * w + x;
      jobs.push(get(urlFor(z, tx, ty, lat, lon)).then((d) => {
        const px = Math.min(d.width - 1, Math.floor((fx - tx) * d.width)), py = Math.min(d.height - 1, Math.floor((fy - ty) * d.height));
        out[k] = pick(d, (py * d.width + px) * 4);
      }));
    }
  }
  await Promise.all(jobs);
  return out;
}
