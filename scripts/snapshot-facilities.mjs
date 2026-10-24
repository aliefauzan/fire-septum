// Fetch a dated OpenStreetMap snapshot of suppression bases (fire stations, helipads,
// airfields) for Kalimantan and Sumatra. Used by /api/osm-resources when the public
// Overpass servers are overloaded. Run: node scripts/snapshot-facilities.mjs
import { writeFileSync } from 'node:fs';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const REGIONS = { kalimantan: '-4.6,108.5,4.6,119.5', sumatra: '-6.2,94.9,6.2,106.8' };
const UA = 'FireSeptum/0.2 (IEEE ClimateChain hackathon prototype)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(bbox) {
  const q = `[out:json][timeout:180];(
    nwr["amenity"="fire_station"](${bbox});
    nwr["aeroway"~"^(helipad|heliport|aerodrome|airstrip)$"](${bbox});
    nwr["office"="government"]["name"~"[Mm]anggala|[Dd]aops|BPBD|BNPB"](${bbox});
  );out tags center;`;
  for (let attempt = 0; attempt < 12; attempt++) {
    for (const url of MIRRORS) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(200_000) });
        const t = await r.text();
        if (r.ok && t.trimStart().startsWith('{')) return { url, json: JSON.parse(t) };
        console.error(`${url} HTTP ${r.status}`);
      } catch (e) { console.error(`${url} ${e.message}`); }
    }
    await sleep(30_000 * (attempt + 1));
  }
  throw new Error('all mirrors failed');
}

const out = { source: 'OpenStreetMap contributors (ODbL), via Overpass API', fetchedAt: new Date().toISOString(), elements: [] };
for (const [name, bbox] of Object.entries(REGIONS)) {
  const { url, json } = await query(bbox);
  console.error(`${name}: ${json.elements.length} elements from ${url}`);
  for (const e of json.elements) {
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat == null) continue;
    const t = e.tags ?? {};
    out.elements.push({ id: `${e.type}/${e.id}`, lat: +lat.toFixed(5), lon: +lon.toFixed(5), tags: Object.fromEntries(Object.entries(t).filter(([k]) => /^(name|amenity|aeroway|office|operator|iata|icao|surface|ref)$/.test(k))) });
  }
}
writeFileSync('data/osm-facilities.json', JSON.stringify(out));
console.error(`saved ${out.elements.length} facilities`);
