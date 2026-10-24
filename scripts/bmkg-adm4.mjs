#!/usr/bin/env node
// Build public/data/bmkg-adm4.json: one BMKG forecast point per kecamatan (district) in the peat
// provinces of Sumatra and Kalimantan, so the server can turn a lat/lon into the adm4 (village)
// code that BMKG's public forecast API needs (it has no lat/lon endpoint).
//
//   node scripts/bmkg-adm4.mjs
//
// Sources (both MIT, by cahya dsn):
//   district centroids  github.com/cahyadsn/wilayah_boundaries  db/kec/wilayah_boundaries_kec_<prov>.sql
//   village codes       github.com/cahyadsn/wilayah            db/wilayah.sql (Kepmendagri codes)
// Each district is represented by its first village code (lowest number, usually …1001 or
// …2001). BMKG returns that village's own name and position, which the app shows.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROVINCES = {
  11: 'Aceh', 12: 'Sumatera Utara', 13: 'Sumatera Barat', 14: 'Riau', 15: 'Jambi', 16: 'Sumatera Selatan', 17: 'Bengkulu',
  18: 'Lampung', 19: 'Kepulauan Bangka Belitung', 61: 'Kalimantan Barat', 62: 'Kalimantan Tengah', 63: 'Kalimantan Selatan',
  64: 'Kalimantan Timur', 65: 'Kalimantan Utara',
};
const RAW = 'https://raw.githubusercontent.com/cahyadsn';

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'FireSeptum/0.2 (IEEE ClimateChain hackathon prototype)' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

const STR = "'((?:[^'\\\\]|\\\\.)*)'";

// First village of every district.
const wil = await get(`${RAW}/wilayah/master/db/wilayah.sql`);
const firstVillage = new Map();
for (const m of wil.matchAll(new RegExp(`\\('(\\d\\d\\.\\d\\d\\.\\d\\d)\\.(\\d{4})',${STR}\\)`, 'g'))) {
  const [, kec, v] = m;
  const prev = firstVillage.get(kec);
  if (!prev || v < prev) firstVillage.set(kec, v);
}

const rows = [];
let missing = 0;
for (const prov of Object.keys(PROVINCES)) {
  const sql = await get(`${RAW}/wilayah_boundaries/main/db/kec/wilayah_boundaries_kec_${prov}.sql`);
  let n = 0;
  for (const m of sql.matchAll(new RegExp(`\\('(\\d\\d\\.\\d\\d\\.\\d\\d)',${STR},(-?\\d+(?:\\.\\d+)?),(-?\\d+(?:\\.\\d+)?)`, 'g'))) {
    const [, kec, , lat, lng] = m;
    const v = firstVillage.get(kec);
    if (!v) { missing++; continue; }
    rows.push([`${kec}.${v}`, +Number(lat).toFixed(3), +Number(lng).toFixed(3)]);
    n++;
  }
  console.log(`${prov} ${PROVINCES[prov]}: ${n} districts`);
}
rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
const out = join(process.cwd(), 'public', 'data');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'bmkg-adm4.json'), JSON.stringify({
  kind: 'fireseptum.bmkg-adm4', v: 1, built: new Date().toISOString().slice(0, 10),
  about: 'One BMKG forecast point per kecamatan: the first village (adm4) code and the kecamatan centroid, for the peat provinces of Sumatra and Kalimantan.',
  attribution: 'Codes: Kepmendagri via github.com/cahyadsn/wilayah (MIT). Centroids: github.com/cahyadsn/wilayah_boundaries (MIT). Forecasts: BMKG (api.bmkg.go.id), credit BMKG.',
  provinces: PROVINCES,
  fields: ['adm4', 'lat', 'lon'],
  rows,
}));
console.log(`${rows.length} districts written${missing ? `, ${missing} without a village code skipped` : ''}`);
