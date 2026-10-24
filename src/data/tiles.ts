// Shared sampler for Web-Mercator PNG tile layers: fetch each tile once, then read the pixel
// under the centre of every grid cell. The peat mask and the land cover use it; terrain.ts
// predates it and keeps its own copy of the same loop.

export interface Geo { north: number; south: number; west: number; east: number }

export const lonToX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const latToY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

/** Fetch and decode one 256 × 256 tile. fetch + createImageBitmap keeps a timeout and works in background tabs. */
export async function loadTileImage(url: string, timeoutMs = 15_000): Promise<ImageData> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`tile HTTP ${res.status}`);
  const img = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(256, 256);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, 256, 256);
}

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
  pick: (d: ImageData, i: number) => number,
): Promise<Float32Array> {
  const tiles = new Map<string, Promise<ImageData>>();
  const get = (url: string) => {
    if (!tiles.has(url)) tiles.set(url, loadTileImage(url));
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
      const px = Math.min(255, Math.floor((fx - tx) * 256)), py = Math.min(255, Math.floor((fy - ty) * 256));
      const k = y * w + x;
      jobs.push(get(urlFor(z, tx, ty, lat, lon)).then((d) => { out[k] = pick(d, (py * 256 + px) * 4); }));
    }
  }
  await Promise.all(jobs);
  return out;
}
