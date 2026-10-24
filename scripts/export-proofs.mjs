// Export every pre-registered forecast in data/register/ as the exact receipt bytes plus
// its OpenTimestamps proof, so anyone can check the timestamps without Fire Septum:
//
//   node scripts/export-proofs.mjs            # writes proofs/<hash>.receipt.json(.ots)
//   pip install opentimestamps-client
//   ots upgrade proofs/*.ots                  # once Bitcoin has confirmed (a few hours)
//   ots verify proofs/<hash>.receipt.json.ots
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'data', 'register');
const OUT = join(process.cwd(), 'proofs');

/** Same canonical JSON as src/sim/receipt.ts: sorted keys, undefined dropped. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

mkdirSync(OUT, { recursive: true });
let n = 0;
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
  const e = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  const { receipt, receiptSha256, anchor } = e.record;
  const bytes = Buffer.from(canonical(receipt));
  const ok = createHash('sha256').update(bytes).digest('hex') === receiptSha256;
  const name = `fireseptum-${receiptSha256.slice(0, 12)}.receipt.json`;
  writeFileSync(join(OUT, name), bytes);
  if (anchor) writeFileSync(join(OUT, `${name}.ots`), Buffer.from(anchor.otsB64, 'base64'));
  console.log(`${ok ? 'ok ' : 'BAD'} ${e.issuedAt}  ${e.lat.toFixed(3)}, ${e.lon.toFixed(3)}  ${name}${anchor ? ' + .ots' : ' (no timestamp)'}`);
  n++;
}
console.log(`${n} forecast(s) exported to proofs/`);
