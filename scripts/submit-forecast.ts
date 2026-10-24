// Submit a forecast in the open format (schema/forecast-v1.json, docs/forecast-schema.md) to a
// Fire Septum instance. For outside modellers; needs only Node ≥ 20 and tsx.
//
//   npx tsx scripts/submit-forecast.ts my-forecast.json --url https://fire-septum.vercel.app
//   npx tsx scripts/submit-forecast.ts my-forecast.json --url http://localhost:5173 --check   # validate only
//   SUBMISSIONS_TOKEN=… npx tsx scripts/submit-forecast.ts f.json --url …                      # instances that require a token
//
// The forecast is checked locally first (the same validator as the server), then POSTed to
// <url>/api/submissions. The server hashes the canonical JSON, timestamps the hash on Bitcoin
// (OpenTimestamps) and stores it write-once; the answer carries the hash and the .ots proof,
// which this script saves next to the input: <file>.canonical.json (the exact bytes that were
// hashed) and <file>.canonical.json.ots (check with `ots verify` once Bitcoin has confirmed it).
import { readFileSync, writeFileSync } from 'node:fs';
import { FORECAST_SCHEMA, forecastSha256, splitForecast, validateForecast, type Forecast } from '../src/sim/forecast';
import { canonical } from '../src/sim/receipt';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--url');
if (!file) {
  console.error('usage: npx tsx scripts/submit-forecast.ts <forecast.json> --url <base URL> [--check]');
  process.exit(2);
}

const f = JSON.parse(readFileSync(file, 'utf8')) as Forecast;
const problems = validateForecast(f);
if (problems.length) {
  console.error(`${file} is not a valid ${FORECAST_SCHEMA} forecast:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
const sha = await forecastSha256(f);
const boxes = splitForecast(f);
console.log(`${f.model.id} ${f.model.version}: ${boxes.length} box(es), issued ${f.issuedAt}, window ${f.windowH} h`);
console.log(`sha256 ${sha} (of ${canonical(f).length} bytes of canonical JSON)`);
const late = (Date.now() - Date.parse(f.issuedAt)) / 3.6e6;
if (late > 1) console.warn(`warning: issuedAt is ${late.toFixed(1)} h ago; the server refuses forecasts more than 1 h old.`);
if (args.includes('--check')) process.exit(0);

const url = opt('url');
if (!url) { console.error('--url <base URL> is required (or --check to validate only)'); process.exit(2); }
const token = process.env.SUBMISSIONS_TOKEN;
const r = await fetch(new URL('/api/submissions', url), {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ forecast: f }),
});
const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` })) as { error?: string; problems?: string[]; sha256?: string; file?: string; anchor?: { calendar: string; otsB64: string } };
if (!r.ok) {
  console.error(`refused (HTTP ${r.status}): ${j.error}`);
  for (const p of j.problems ?? []) console.error(`  - ${p}`);
  process.exit(1);
}
if (j.sha256 !== sha) console.warn(`warning: the server's hash ${j.sha256} differs from the local one`);
console.log(`stored: ${j.file}`);
if (j.anchor) {
  writeFileSync(`${file}.canonical.json`, canonical(f));
  writeFileSync(`${file}.canonical.json.ots`, Buffer.from(j.anchor.otsB64, 'base64'));
  console.log(`timestamped via ${j.anchor.calendar}; proof saved as ${file}.canonical.json.ots`);
  console.log(`  ots upgrade ${file}.canonical.json.ots && ots verify ${file}.canonical.json.ots   # after a Bitcoin block confirms it`);
}
