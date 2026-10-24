#!/usr/bin/env node
// Convert the project-boundary KMLs filed in the Verra registry into small GeoJSON files for the
// carbon-project reversal monitor (src/sim/reversal.ts, src/ui/CarbonProjects.tsx).
//
//   node scripts/carbon-projects.mjs <dir with the KMLs>
//
// The KMLs are downloaded by hand from each project's page in the Verra registry (the registry
// has no keyless API). They are not committed: only the simplified GeoJSON and index.json under
// public/data/carbon-projects/ are. Boundaries are simplified with Douglas–Peucker at 20 m, far
// below the 375 m VIIRS pixel the monitor compares them with. No dependencies.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RETRIEVED = '2026-10-24';
const TOLERANCE_M = 20;
const OUT = join(process.cwd(), 'public', 'data', 'carbon-projects');

const PROJECTS = [
  {
    id: 'vcs1477', vcsId: 1477, file: 'katingan.kml',
    name: 'Katingan Peatland Restoration and Conservation Project',
    province: 'Central Kalimantan',
    source: { name: 'KatinganProjectArea.kml', documentId: '110200000381922' },
  },
  {
    id: 'vcs674', vcsId: 674, file: 'rimbaraya674.kml',
    name: 'Rimba Raya Biodiversity Reserve Project',
    province: 'Central Kalimantan',
    source: { name: 'VCS_KML_0674_16122021.kml', documentId: '110200000270012' },
  },
  {
    id: 'vcs1899', vcsId: 1899, file: 'merang1899.kml',
    name: 'Sumatra Merang Peatland Project',
    province: 'South Sumatra',
    source: { name: 'VCS_KML_1899_15FEB2023.kml', documentId: '110200000381622' },
  },
];

const TERMS = 'Boundaries as filed by the project proponents in the Verra Registry and simplified to about 20 m. The Verra Registry Terms of Use apply to the source files. Fire Septum is not affiliated with or endorsed by Verra or the proponents, and showing a boundary here says nothing about the project’s credits or verification status.';

/** Every <Polygon> as rings of [lon, lat]: the outer boundary first, then any holes. */
function polygonsOf(kml) {
  const polys = [];
  for (const m of kml.matchAll(/<Polygon[\s>][\s\S]*?<\/Polygon>/g)) {
    const rings = [];
    const ringOf = (block) => {
      const c = /<coordinates>([\s\S]*?)<\/coordinates>/.exec(block);
      if (!c) return null;
      return c[1].trim().split(/\s+/).map((t) => t.split(',').slice(0, 2).map(Number)).filter((p) => p.every(Number.isFinite));
    };
    const outer = /<outerBoundaryIs>([\s\S]*?)<\/outerBoundaryIs>/.exec(m[0]);
    if (outer) { const r = ringOf(outer[1]); if (r) rings.push(r); }
    for (const inner of m[0].matchAll(/<innerBoundaryIs>([\s\S]*?)<\/innerBoundaryIs>/g)) { const r = ringOf(inner[1]); if (r) rings.push(r); }
    if (rings.length) polys.push(rings);
  }
  return polys;
}

/** Douglas–Peucker on a ring, in local metres around its first point. */
function simplify(ring, tolM) {
  const lat0 = ring[0][1] * Math.PI / 180;
  const mx = 111_320 * Math.cos(lat0), my = 110_574;
  const P = ring.map(([x, y]) => [x * mx, y * my]);
  const keep = new Uint8Array(P.length);
  keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, idx = -1;
    const [ax, ay] = P[a], [bx, by] = P[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      const d = L === 0 ? Math.hypot(P[i][0] - ax, P[i][1] - ay) : Math.abs(dy * P[i][0] - dx * P[i][1] + bx * ay - by * ax) / L;
      if (d > best) { best = d; idx = i; }
    }
    if (best > tolM) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = ring.filter((_, i) => keep[i]).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]);
  // A closed ring needs at least four positions.
  return out.length >= 4 ? out : ring.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]);
}

/** Ring area in hectares (equirectangular around the ring's centre, fine at project scale). */
function ringHa(ring) {
  const lat0 = (ring.reduce((a, p) => a + p[1], 0) / ring.length) * Math.PI / 180;
  const mx = 111_320 * Math.cos(lat0), my = 110_574;
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] * mx) * (ring[i][1] * my) - (ring[i][0] * mx) * (ring[j][1] * my);
  return Math.abs(s) / 2 / 1e4;
}

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/carbon-projects.mjs <dir with the KMLs>'); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const index = [];
for (const p of PROJECTS) {
  const polys = polygonsOf(readFileSync(join(dir, p.file), 'utf8'));
  if (!polys.length) throw new Error(`${p.file}: no polygons`);
  const before = polys.flat().reduce((a, r) => a + r.length, 0);
  const simple = polys.map((rings) => rings.map((r) => simplify(r, TOLERANCE_M)));
  const after = simple.flat().reduce((a, r) => a + r.length, 0);
  const areaHa = simple.reduce((a, rings) => a + ringHa(rings[0]) - rings.slice(1).reduce((b, r) => b + ringHa(r), 0), 0);
  const all = simple.flat(2);
  const bbox = [Math.min(...all.map((q) => q[0])), Math.min(...all.map((q) => q[1])), Math.max(...all.map((q) => q[0])), Math.max(...all.map((q) => q[1]))].map((v) => +v.toFixed(5));
  const registryUrl = `https://registry.verra.org/app/projectDetail/VCS/${p.vcsId}`;
  const meta = { id: p.id, name: p.name, vcsId: p.vcsId, province: p.province, registryUrl, source: { ...p.source, registry: 'Verra Registry' }, retrieved: RETRIEVED, areaHa: Math.round(areaHa), bbox, vertices: after, file: `data/carbon-projects/${p.id}.geojson` };
  const fc = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { ...meta, terms: TERMS }, geometry: { type: 'MultiPolygon', coordinates: simple } }],
  };
  writeFileSync(join(OUT, `${p.id}.geojson`), JSON.stringify(fc));
  index.push(meta);
  console.log(`${p.id}: ${polys.length} polygon(s), ${before} → ${after} vertices, ${Math.round(areaHa).toLocaleString('en-US')} ha, bbox ${bbox.join(',')}`);
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({
  kind: 'fireseptum.carbon-projects', v: 1, retrieved: RETRIEVED,
  attribution: 'Project boundaries: Verra Registry (registry.verra.org), as filed by the project proponents.',
  terms: TERMS,
  simplifiedM: TOLERANCE_M,
  projects: index,
}, null, 1));
