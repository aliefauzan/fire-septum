import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { bmkgHandler, nearestAdm4, normalizeHotspots, normalizeTmat } from './bmkg';

/** Call the handler with a GET and collect status and body (no network for the paths tested here). */
async function call(path: string, sipongi?: string) {
  let status = 0, body = '';
  const headers: Record<string, string> = {};
  const res = {
    set statusCode(v: number) { status = v; }, get statusCode() { return status; },
    setHeader: (k: string, v: string) => { headers[k] = v; },
    end: (b?: string) => { body = b ?? ''; },
  } as unknown as ServerResponse;
  let passed = false;
  await bmkgHandler(() => sipongi)({ url: path, method: 'GET' } as IncomingMessage, res, () => { passed = true; });
  return { status, json: body ? JSON.parse(body) : null, passed };
}

describe('BMKG and SiPongi adapters', () => {
  it('picks the nearest kecamatan and refuses points outside the lookup', () => {
    const rows: [string, number, number][] = [['62.71.01.1001', -2.2, 113.95], ['62.03.01.2001', -3.0, 114.4]];
    expect(nearestAdm4(-2.25, 114.0, rows)?.adm4).toBe('62.71.01.1001');
    expect(nearestAdm4(-2.9, 114.3, rows)?.adm4).toBe('62.03.01.2001');
    expect(nearestAdm4(-6.2, 106.8, rows)).toBeNull();
  });

  it('keeps SiPongi off without the permission flag', async () => {
    const off = await call('/api/sipongi/hotspots');
    expect(off.status).toBe(403);
    expect(off.json.error).toMatch(/written permission/);
    expect((await call('/api/sipongi/tmat', 'yes')).status).toBe(403);
    expect((await call('/api/sipongi/status')).json.enabled).toBe(false);
    expect((await call('/api/sipongi/status', 'granted')).json.enabled).toBe(true);
  });

  it('only proxies allow-listed fire danger maps and Indonesian points', async () => {
    expect((await call('/api/bmkg-fdrs?region=99_mars&var=dc&day=00')).status).toBe(400);
    expect((await call('/api/bmkg-fdrs?region=38_kalimantan&var=evil&day=00')).status).toBe(400);
    expect((await call('/api/bmkg-fdrs?region=38_kalimantan&var=dc&day=09')).status).toBe(400);
    expect((await call('/api/bmkg?lat=51.5&lon=0')).status).toBe(400);
    expect((await call('/api/other')).passed).toBe(true);
  });

  it('normalizes SiPongi shapes', () => {
    const hs = normalizeHotspots({ features: [{ geometry: { type: 'Point', coordinates: [113.9, -2.2] }, properties: { desa: 'Kalampangan', kecamatan: 'Sabangau', kabkota: 'Palangka Raya', kawasan: 'APL' } }] });
    expect(hs[0]).toMatchObject({ lat: -2.2, lon: 113.9, desa: 'Kalampangan', kawasan: 'APL' });
    const st = normalizeTmat([{ id: 7, nama: 'ST-01', latitude: '-2.1', longitude: '113.8', WaterLevel: '-45' }]);
    expect(st[0]).toMatchObject({ id: '7', lat: -2.1, lon: 113.8, waterLevelCm: -45 });
  });
});
