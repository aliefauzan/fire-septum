// Seal one UTC day of records into a Merkle batch and timestamp its root on Bitcoin.
//
//   npx tsx scripts/seal-day.ts                # yesterday (UTC)
//   npx tsx scripts/seal-day.ts 2026-10-20     # a given day
//   npx tsx scripts/seal-day.ts --backfill     # every past day that has records not yet in a batch
//   npx tsx scripts/seal-day.ts --today        # today, before it is over (later records go into tomorrow's batch)
//
// Leaves are the record hashes of the day: register entries (receipt hash), forecast submissions
// (forecast hash), decision records (decision hash) and the plan run records they point at
// (receipt hash), sorted ascending (scripts/lib/seal.ts).
// The root goes to the OpenTimestamps calendars; the batch file data/batches/<day>.json is
// written only if that succeeds, and is never rewritten. A record that arrives after its day
// was sealed is put into the next batch that is built.
import { utcDay } from '../src/sim/batch';
import { existingBatches, sealDay, sealedRecords } from './lib/seal';

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

