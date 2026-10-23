// Satellite basemap for live scenarios: Esri World Imagery tiles stitched and
// cropped to the scenario box. Attribution is shown in the UI.
export const SATELLITE_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics';

const lonToX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const latToY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

export async function loadSatellite(geo: { north: number; south: number; west: number; east: number }, z = 14, out = 768): Promise<HTMLCanvasElement> {
  const x0 = lonToX(geo.west, z), x1 = lonToX(geo.east, z);
  const y0 = latToY(geo.north, z), y1 = latToY(geo.south, z);
  const c = document.createElement('canvas');
  c.width = out; c.height = out;
  const ctx = c.getContext('2d')!;
  const sx = out / (x1 - x0), sy = out / (y1 - y0);
  const jobs: Promise<void>[] = [];
  for (let ty = Math.floor(y0); ty <= Math.floor(y1); ty++) {
    for (let tx = Math.floor(x0); tx <= Math.floor(x1); tx++) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
      jobs.push(img.decode().then(() => {
        ctx.drawImage(img, (tx - x0) * sx, (ty - y0) * sy, sx, sy);
      }));
    }
  }
  await Promise.all(jobs);
  return c;
}
