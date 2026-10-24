// Re-run the 12 hindcast events of docs/hindcast.md from Node and pool the scores.
//
//   npx tsx scripts/hindcast-batch.ts                       # 3 variants, τ = 6 h
//   npx tsx scripts/hindcast-batch.ts --taus 3,6 --variants none,barriers+drainage --out docs/x.json
//   npx tsx scripts/hindcast-batch.ts --offline             # only cached data (no network)
//
// Needs FIRMS_MAP_KEY (environment, .env.local or .env) unless every FIRMS answer is cached.
// Data are cached under .cache/ (see scripts/lib/node-env.ts), so a re-run is fast and offline-able.
import { writeFileSync } from 'node:fs';
import { VALIDATION_EVENTS, VARIANTS, poolRows, runHindcastBatch, type BatchRow } from '../src/data/hindcastBatch.ts';
import { nodeEnv } from './lib/node-env.ts';

const args = process.argv.slice(2);
const arg = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const taus = arg('taus', '6').split(',').map(Number);
const names = arg('variants', Object.keys(VARIANTS).join(',')).split(',') as (keyof typeof VARIANTS)[];
for (const n of names) if (!(n in VARIANTS)) throw new Error(`unknown variant ${n}; known: ${Object.keys(VARIANTS).join(', ')}`);
const out = arg('out', 'docs/hindcast-rerun-2026-10-24-barriers.json');

const env = nodeEnv({ offline: args.includes('--offline'), log: (m) => console.log(`  ${m}`) });
const variants = Object.fromEntries(names.map((n) => [n, VARIANTS[n]]));
const t = Date.now();
const r = await runHindcastBatch(VALIDATION_EVENTS, taus, console.log, variants, env);

const f2 = (x: number) => x.toFixed(3);
const summary: Record<string, Record<string, ReturnType<typeof poolRows>>> = {};
console.log(`\nPooled (${r.rows.length} rows, ${r.err.length} errors, ${((Date.now() - t) / 1000).toFixed(0)} s)`);
console.log('variant              τ  subset       obs  pred  hits   POD   FAR   CSI  dist CSI   BSS');
for (const v of names) {
  for (const tau of taus) {
    const rows = r.rows.filter((x) => x.variant === v);
    for (const [subset, sel] of [['all', rows], ['Kalimantan', rows.filter((x) => x.isl === 'Kalimantan')], ['Sumatra', rows.filter((x) => x.isl === 'Sumatra')]] as [string, BatchRow[]][]) {
      const p = poolRows(sel, tau);
      (summary[`${v}@${tau}`] ??= {})[subset] = p;
      console.log(`${v.padEnd(20)} ${String(tau).padStart(2)}  ${subset.padEnd(10)} ${String(p.obs).padStart(5)} ${String(p.pred).padStart(5)} ${String(p.hits).padStart(5)}  ${f2(p.pod)} ${f2(p.far)} ${f2(p.csi)}   ${f2(p.dcsi)}  ${p.bss.toFixed(2)}`);
    }
  }
}
for (const e of r.err) console.log(`ERROR ${e}`);
writeFileSync(out, JSON.stringify({ ...r, taus, variants, summary }) + '\n');
console.log(`\nwrote ${out}`);
if (r.err.length) process.exitCode = 1;
