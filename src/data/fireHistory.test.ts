import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFireHistory, popcount, yearsBeforeMask } from './fireHistory';

const PUBLIC = join(process.cwd(), 'public');
const readBuf = async (url: string) => {
  const b = await readFile(join(PUBLIC, url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

// A VIIRS S-NPP high-confidence detection of 23 Jul 2015, 05:44 UTC, in Central Kalimantan
// (kalimantan-viirs-snpp extract). Its cell burned in 2004, 2009, 2011, 2013, 2014, 2015, 2018, 2019, 2023.
const LAT = -2.31406, LON = 114.10638;
const YEARS = [2004, 2009, 2011, 2013, 2014, 2015, 2018, 2019, 2023];

describe('fire history raster (public/data/fire-history)', async () => {
  const fh = await loadFireHistory(readBuf);

  it('loads both islands', () => {
    expect(fh.grids.map((g) => g.meta.name).sort()).toEqual(['Kalimantan', 'Sumatra']);
    for (const g of fh.grids) {
      expect(g.cells.length).toBe(g.meta.cells);
      for (let i = 1; i < Math.min(g.cells.length, 10_000); i++) expect(g.cells[i]).toBeGreaterThan(g.cells[i - 1]);
    }
  });

  it('marks a cell known to have burned in 2015', () => {
    const mask = fh.maskAt(LAT, LON);
    const years = Array.from({ length: 25 }, (_, i) => 2001 + i).filter((y) => (mask >>> (y - 2001)) & 1);
    expect(years).toEqual(YEARS);
    expect(years).toContain(2015);
  });

  it('counts distinct earlier fire years', () => {
    expect(fh.fireYearsBefore(LAT, LON, 2001)).toBe(0);
    expect(fh.fireYearsBefore(LAT, LON, 2015)).toBe(5);
    expect(fh.fireYearsBefore(LAT, LON, 2016)).toBe(6);
    expect(fh.fireYearsBefore(LAT, LON, 2026)).toBe(9);
    // Java Sea (inside the Kalimantan bbox) and a point outside both islands.
    expect(fh.fireYearsBefore(-4.4, 109.0, 2026)).toBe(0);
    expect(fh.fireYearsBefore(-7.5, 110.4, 2026)).toBe(0);
  });

  it('samples a w x h box row-major from the north-west', () => {
    const d = 0.03;
    const g = fh.sampleGrid({ north: LAT + d, south: LAT - d, west: LON - d, east: LON + d }, 12, 12, 2016);
    expect(g).toHaveLength(144);
    expect(Math.max(...g)).toBeGreaterThanOrEqual(1);
    // Grid cell (6, 6) has its centre at (LAT - 0.0025, LON + 0.0025).
    expect(g[6 * 12 + 6]).toBe(fh.fireYearsBefore(LAT - 0.0025, LON + 0.0025, 2016));
  });

  it('bit helpers', () => {
    expect(popcount(0)).toBe(0);
    expect(popcount(0x1ffffff)).toBe(25);
    expect(popcount(0xffffffff)).toBe(32);
    expect(yearsBeforeMask(2001, 2001)).toBe(0);
    expect(yearsBeforeMask(2016, 2001)).toBe(0x7fff);
  });
});
