// Seal one UTC day of records into a Merkle batch and timestamp its root on Bitcoin.
//
//   npx tsx scripts/seal-day.ts                # yesterday (UTC)
//   npx tsx scripts/seal-day.ts 2026-10-20     # a given day
//   npx tsx scripts/seal-day.ts --backfill     # every past day that has records not yet in a batch
//   npx tsx scripts/seal-day.ts --today        # today, before it is over (later records go into tomorrow's batch)
//
// Leaves are the record hashes of the day: register entries (receipt hash), decision records
// (decision hash) and the plan run records they point at (receipt hash), sorted ascending.
// The root goes to the OpenTimestamps calendars; the batch file data/batches/<day>.json is
// written only if that succeeds, and is never rewritten. A record that arrives after its day
// was sealed is put into the next batch that is built.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { anchor } from '../server/receipt';
import { buildBatch, planBatch, utcDay, type DailyBatch, type SealedLeaf } from '../src/sim/batch';
import { canonical, sha256Hex } from '../src/sim/receipt';

const ROOT = process.cwd();
const BATCHES = join(ROOT, 'data', 'batches');
const readDir = (d: string) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')).sort() : []);
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

/** Every sealed record in the store, checked against its own hash. */
async function sealedRecords(): Promise<SealedLeaf[]> {
  const out: SealedLeaf[] = [];
  for (const f of readDir(join(ROOT, 'data', 'register'))) {
    const e = readJson(join(ROOT, 'data', 'register', f));
    const h = e.record?.receiptSha256;
    if ((await sha256Hex(canonical(e.record.receipt))) !== h) { console.warn(`skip ${f}: receipt does not match its hash`); continue; }
    out.push({ hash: h, sealedAt: e.issuedAt, source: `data/register/${f}` });
  }
  for (const f of readDir(join(ROOT, 'data', 'decisions'))) {
    const r = readJson(join(ROOT, 'data', 'decisions', f));
    if ((await sha256Hex(canonical(r.decision))) !== r.decisionSha256) { console.warn(`skip ${f}: decision does not match its hash`); continue; }
    out.push({ hash: r.decisionSha256, sealedAt: r.decision.decidedAt, source: `data/decisions/${f}` });
    out.push({ hash: r.decision.planReceiptSha256, sealedAt: r.decision.decidedAt, source: `data/decisions/${f} (plan run record)` });
  }
  return out;
}

const existingBatches = (): DailyBatch[] => readDir(BATCHES).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => readJson(join(BATCHES, f)));

async function sealDay(day: string, records: SealedLeaf[]): Promise<'sealed' | 'exists' | 'empty'> {
  const leaves = planBatch(day, records, existingBatches());
  if (leaves === null) { console.log(`${day}: already sealed (data/batches/${day}.json is never rewritten)`); return 'exists'; }
  if (!leaves.length) { console.log(`${day}: no new records`); return 'empty'; }
  const batch = await buildBatch(day, leaves);
  const a = await anchor(batch.root);
  if (!a) throw new Error(`${day}: no OpenTimestamps calendar answered; nothing written (try again later)`);
  batch.ots = { calendar: a.calendar, submittedAt: new Date().toISOString(), otsB64: a.ots.toString('base64') };
  mkdirSync(BATCHES, { recursive: true });
  const file = join(BATCHES, `${day}.json`);
  if (existsSync(file)) throw new Error(`${file} appeared while sealing; not overwriting`);
  writeFileSync(file, JSON.stringify(batch, null, 1) + '\n', { flag: 'wx' });
  console.log(`${day}: sealed ${batch.leaves.length} record(s), root ${batch.root}`);
  for (const l of leaves) console.log(`   ${l.hash.slice(0, 16)}…  ${l.source}`);
  console.log(`   OpenTimestamps: ${a.calendar} (pending until a Bitcoin block confirms it)`);
  return 'sealed';
}

async function main() {
  const args = process.argv.slice(2);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const records = await sealedRecords();
  let days: string[];
  if (args.includes('--backfill')) {
    const done = new Set(existingBatches().flatMap((b) => b.leaves));
    days = [...new Set(records.filter((r) => !done.has(r.hash)).map((r) => utcDay(r.sealedAt)))].filter((d) => d < today).sort();
    if (!days.length) console.log('Nothing to backfill.');
  } else if (args.includes('--today')) {
    days = [today];
  } else {
    days = args.filter((a) => !a.startsWith('--'));
    if (!days.length) days = [yesterday];
    for (const d of days) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`not a day: ${d} (use YYYY-MM-DD)`);
      if (d >= today) throw new Error(`${d} is not over yet (UTC). Use --today to seal it anyway.`);
    }
  }
  for (const d of days) await sealDay(d, records);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

