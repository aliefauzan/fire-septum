import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFwiArchive } from './fwiArchive';

const read = (p: string) => readFile(join(process.cwd(), p)).then((b) => new Uint8Array(b));

describe('ERA5 FWI archive (data/fwi)', async () => {
  const a = await loadFwiArchive(read, [2015, 2023, 2026]);

  it('returns values at the nearest point', () => {
    // Recorded event that opens the app: Kalimantan, 18 Oct 2026.
    const v = a.at(-2.8179, 110.6934, '2026-10-18')!;
    expect(v).not.toBeNull();
    expect(v.pointLat).toBe(-3);
    expect(v.pointLon).toBe(110.5);
    expect(v.distKm).toBeLessThan(40);
    for (const k of ['ffmc', 'dmc', 'dc', 'isi', 'bui', 'fwi'] as const) expect(v[k]).toBeGreaterThanOrEqual(0);
    expect(v.ffmc).toBeLessThanOrEqual(101);
  });

  it('shows the 2015 drought building through the dry season', () => {
    const p = { lat: -3.5, lon: 104.0 };
    const jan = a.at(p.lat, p.lon, '2015-01-15')!, oct = a.at(p.lat, p.lon, '2015-10-15')!;
    expect(oct.dc).toBeGreaterThan(400);
    expect(oct.dc).toBeGreaterThan(jan.dc * 5);
  });

  it('is null outside the covered dates and years', () => {
    expect(a.at(-3, 110.5, '2019-09-01')).toBeNull();
    expect(a.at(-3, 110.5, '2015-12-25')).toBeNull();
  });
});
