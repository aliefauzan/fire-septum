// The live scenario builder in Node, with the real OSM barrier snapshot and stand-in tiles and weather.
import { describe, expect, it } from 'vitest';
import { nodeEnv } from '../../scripts/lib/node-env';
import { FUEL_INDEX } from '../sim/fuels';
import type { DataEnv, DecodedTile } from './env';
import { buildLiveScenario, type LiveOptions } from './live';

const tile = (r: number, g: number, b: number, a: number): DecodedTile => {
  const data = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a; }
  return { data, width: 256, height: 256 };
};

/** Real public/ files from disk; flat 10 m terrain, peat everywhere, tree cover, steady weather. */
function fakeEnv(over: Partial<DataEnv> = {}): DataEnv & { overpassCalls: number } {
  const env = {
    ...nodeEnv({ offline: true }),
    overpassCalls: 0,
    fetchTile: async (url: string) => {
      const host = new URL(url).host;
      if (host.startsWith('s3.')) return tile(128, 10, 0, 255); // Terrarium: 128·256 + 10 − 32768 = 10 m
      if (host.includes('globalforestwatch')) return tile(200, 0, 0, 255); // opaque = peat
      return tile(10, 10, 10, 255); // WorldCover class 10, tree cover
    },
    getJson: async () => {
      const t0 = Date.parse('2026-10-15T00:00:00Z');
      const time = Array.from({ length: 24 * 6 }, (_, i) => new Date(t0 + i * 3.6e6).toISOString().slice(0, 13) + ':00');
      const n = time.length;
      return { hourly: { time, temperature_2m: Array(n).fill(32), relative_humidity_2m: Array(n).fill(55), precipitation: Array(n).fill(0), wind_speed_10m: Array(n).fill(10), wind_direction_10m: Array(n).fill(90) } };
    },
    firms: async () => ({ hotspots: [], sources: [], fetchedAt: '' }),
    overpass: async () => { env.overpassCalls++; throw new Error('Overpass down'); },
    ...over,
  };
  return env;
}

// Block C of the ex-Mega Rice Project, Central Kalimantan: a grid of large drainage canals.
const MRP = { lat: -2.901, lon: 114.402 };
const past = (o: Partial<LiveOptions> = {}): LiveOptions => ({
  ...MRP, horizonH: 24, ...o,
  past: { t0: '2026-10-17T06:00:00Z', windowH: 24, observed: [], known: [{ ...MRP, frp: 10, confidence: 'n', acquired: '2026-10-17T05:00:00Z', satellite: 'N' }] },
});

describe('live scenario builder in Node', () => {
  it('lays OSM snapshot canals, partial fuel breaks and drainage distance into a canal box', async () => {
    const env = fakeEnv();
    const { scenario: s, warnings } = await buildLiveScenario(past(), env);
    const l = s.landscape;
    expect(s.provenance.barriers).toBe('snapshot');
    expect(s.provenance.fuel).toMatch(/OpenStreetMap snapshot of 2026-10-23/);
    expect(env.overpassCalls).toBe(0);
    expect(warnings.join(' ')).not.toMatch(/NO BARRIERS/);
    // Canals are water cells; everything else here was tree cover on peat.
    const water = l.fuel.reduce((n, f) => n + (f === FUEL_INDEX.water ? 1 : 0), 0);
    expect(water).toBeGreaterThan(20);
    expect(l.drainM).toBeDefined();
    expect(Math.min(...l.drainM!)).toBe(0);
    expect(l.drainM!.filter((d) => d < 300).length).toBeGreaterThan(200);
    // Partial breaks only on burnable cells, never stronger than the strongest rate.
    for (let k = 0; k < l.w * l.h; k++) if (s.init.brk[k] > 0) expect(l.fuel[k]).not.toBe(FUEL_INDEX.water);
    expect(Math.max(...s.init.brk)).toBeLessThanOrEqual(0.5);
  });

  it('drainage and barriers can be switched off for reference runs', async () => {
    const { scenario: noDrain } = await buildLiveScenario(past({ drainage: false }), fakeEnv());
    expect(noDrain.landscape.drainM).toBeUndefined();
    expect(noDrain.provenance.fuel).toMatch(/No drained-peat term/);
    const { scenario: off } = await buildLiveScenario(past({ barriers: false }), fakeEnv());
    expect(off.provenance.barriers).toBe('off');
    expect(off.landscape.fuel.every((f) => f !== FUEL_INDEX.water)).toBe(true);
    expect(off.init.brk.every((v) => v === 0)).toBe(true);
  });

  it('falls back to Overpass outside the snapshot, and warns loudly when neither is there', async () => {
    const env = fakeEnv({ fetchJson: async () => null });
    const { scenario: s, warnings } = await buildLiveScenario(past(), env);
    expect(env.overpassCalls).toBe(1);
    expect(s.provenance.barriers).toBe('none');
    expect(s.provenance.fuel).toMatch(/Barriers: NONE/);
    expect(warnings.some((w) => w.startsWith('NO BARRIERS') && /Overpass is unavailable/.test(w))).toBe(true);
    expect(s.landscape.drainM).toBeUndefined();

    const osm = { elements: [{ type: 'way', tags: { waterway: 'canal' }, geometry: [{ lat: MRP.lat + 0.05, lon: MRP.lon }, { lat: MRP.lat - 0.05, lon: MRP.lon }] }] };
    const { scenario: o } = await buildLiveScenario(past(), fakeEnv({ fetchJson: async () => null, overpass: async () => osm }));
    expect(o.provenance.barriers).toBe('overpass');
    expect(o.provenance.fuel).toMatch(/live OpenStreetMap \(Overpass\) query, because the OSM snapshot is not shipped/);
    expect(o.landscape.fuel.filter((f) => f === FUEL_INDEX.water).length).toBe(64);
  });
});
