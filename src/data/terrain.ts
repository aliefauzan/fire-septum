// Real elevation from the public AWS Terrain Tiles (Terrarium encoding, no key):
//   elevation_m = (R × 256 + G + B / 256) − 32768
// https://registry.opendata.aws/terrain-tiles/

const TILE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

function lonToX(lon: number, z: number) { return ((lon + 180) / 360) * 2 ** z; }
function latToY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

async function loadTile(z: number, x: number, y: number): Promise<ImageData> {
  // fetch + createImageBitmap rather than <img>.decode(): it has a timeout and still
  // decodes when the page is in a background tab.
  const res = await fetch(`${TILE}/${z}/${x}/${y}.png`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`terrain tile HTTP ${res.status}`);
  const img = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(256, 256);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, 256, 256);
}

/** Sample elevation at the centre of each grid cell of a w × h grid covering the bbox. */
export async function fetchElevationGrid(
  geo: { north: number; south: number; west: number; east: number },
  w: number,
  h: number,
  z = 13,
): Promise<Float32Array> {
  const tiles = new Map<string, Promise<ImageData>>();
  const get = (tx: number, ty: number) => {
    const k = `${tx}/${ty}`;
    if (!tiles.has(k)) tiles.set(k, loadTile(z, tx, ty));
    return tiles.get(k)!;
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
      jobs.push(get(tx, ty).then((d) => {
        const i = (py * 256 + px) * 4;
        out[k] = d.data[i] * 256 + d.data[i + 1] + d.data[i + 2] / 256 - 32768;
      }));
    }
  }
  await Promise.all(jobs);
  return out;
}
