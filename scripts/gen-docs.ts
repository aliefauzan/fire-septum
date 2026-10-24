// Fill the numbers in README.md and docs/submission.md from the data files, so the text never
// drifts from what was measured.
//
//   npx tsx scripts/gen-docs.ts           # rewrite the generated blocks
//   npx tsx scripts/gen-docs.ts --check   # exit 1 if any block is out of date (CI)
//
// A generated block sits between <!-- gen:NAME --> and <!-- /gen:NAME --> and is replaced whole.
// Everything outside the markers is hand-written and left alone.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { RegisterEntry } from '../src/sim/register';
import { boardIndex, boardRows, leaderboard } from '../src/sim/scoreboard';
import type { ForecastSubmission } from '../src/sim/submission';

const root = process.cwd();
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const files = (dir: string, ext: string): string[] =>
  !existsSync(join(root, dir)) ? [] : readdirSync(join(root, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(root, p)).isDirectory() ? files(p, ext) : p.endsWith(ext) ? [p] : [];
  });
const f2 = (x: number) => x.toFixed(2);
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Hindcast of the 12 October 2026 fires with the canal and road barriers (the app default). */
function hindcast(): string {
  const s = read('docs/hindcast-rerun-2026-10-24-barriers.json').summary['barriers@6'];
  const row = (k: string) => `| ${k === 'all' ? 'Pooled' : k} | ${s[k].events} | ${s[k].obs} | ${f2(s[k].csi)} | ${f2(s[k].dcsi)} | ${f2(s[k].bss)} |`;
  return [
    '| Fires | Events | New-fire blocks | CSI, model | CSI, distance only | Brier skill |',
    '|---|---:|---:|---:|---:|---:|',
    ...['all', 'Kalimantan', 'Sumatra'].map(row),
    '',
    `Source: \`docs/hindcast-rerun-2026-10-24-barriers.json\` (τ = 6 h, canal and road barriers on). Brier skill below 0 means the raw ensemble probabilities are not calibrated.`,
  ].join('\n');
}

/** The forecast register and open submissions, pooled per model as on the public scoreboard. */
function register(): string {
  const entries = files('data/register', '.json').map((p) => read(p) as RegisterEntry);
  const subs = files('data/submissions', '.json').map((p) => read(p) as ForecastSubmission);
  const board = leaderboard(boardRows(boardIndex(entries, subs, '')));
  const scored = entries.filter((e) => e.score).length;
  return [
    `${entries.length} forecasts sealed in the register, ${scored} scored; ${subs.length} open submissions.`,
    '',
    '| Model | Boxes | CSI | POD | FAR | Brier skill |',
    '|---|---:|---:|---:|---:|---:|',
    ...board.map((m) => `| \`${m.model}\` | ${m.boxes} | ${f2(m.csi)} | ${f2(m.pod)} | ${f2(m.far)} | ${f2(m.brierSkill)} |`),
  ].join('\n');
}

/** The published train / validation / test split. */
function split(): string {
  const v = read('data/validation/events.json');
  const n: Record<string, number> = {};
  for (const e of v.events) n[e.split] = (n[e.split] ?? 0) + 1;
  const boxes = existsSync(join(root, 'data/validation/train-boxes.json')) ? read('data/validation/train-boxes.json').events?.length : undefined;
  return [
    '| Split | Rule | Events |',
    '|---|---|---:|',
    ...Object.entries(v.split as Record<string, string>).map(([k, rule]) => `| ${k} | ${rule} | ${(n[k] ?? 0).toLocaleString('en')} |`),
    '',
    `${v.events.length.toLocaleString('en')} events in all${boxes ? `, plus ${boxes.toLocaleString('en')} training boxes` : ''}. The split was fixed and timestamped on Bitcoin (\`data/validation/events.json.ots\`) before any tuning.`,
  ].join('\n');
}

/** The statistical next-day forecaster on the published split (docs/validation-scale.json), lead 1 day. */
function forecaster(): string {
  if (!existsSync(join(root, 'docs/validation-scale.json'))) return '_Not run yet._';
  type Cell = { all: { boxes: number; bss: number; auc?: number; atThreshold: { csi: number }; ci?: { bss: [number, number] } } };
  const v = read('docs/validation-scale.json');
  const splits = Object.entries(v.results as Record<string, Record<string, Record<string, Cell>>>).filter(([, leads]) => leads['1']);
  const models = [...new Set(splits.flatMap(([, leads]) => Object.keys(leads['1'])))];
  const f3 = (x: number) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(Math.abs(x) >= 1 ? 1 : 3);
  const cell = (c: Cell | undefined, boxes: number) => {
    if (!c) return '–';
    const a = c.all;
    const ci = a.ci?.bss ? ` [${f3(a.ci.bss[0])}, ${f3(a.ci.bss[1])}]` : '';
    return `${f3(a.bss)}${ci} · ${f2(a.atThreshold.csi)} · ${a.auc != null ? f2(a.auc) : '–'}${a.boxes < boxes ? ` (${a.boxes} boxes)` : ''}`;
  };
  const maxBoxes = (leads: Record<string, Record<string, Cell>>) => Math.max(...Object.values(leads['1']).map((c) => c.all.boxes));
  return [
    `| Model | ${splits.map(([k, leads]) => `${k} (${maxBoxes(leads)} boxes)`).join(' | ')} |`,
    `|---|${splits.map(() => '---').join('|')}|`,
    ...models.map((m) => `| \`${m}\` | ${splits.map(([, leads]) => cell(leads['1'][m], maxBoxes(leads))).join(' | ')} |`),
    '',
    `Next 24 h, each cell: Brier skill against train climatology [95% CI, bootstrap over boxes] · CSI at the threshold fixed on validation · AUC. \`gbm_iso\` is the calibrated model; its validation numbers are in-sample, because the calibration was fitted there. \`ca\` is the spread simulation; \`oot\` counts VIIRS S-NPP only (as in training), \`oot_allviirs\` all three satellites (as the app reads).${v.final ? '' : ' **Provisional: the test split has not been opened yet.**'} Source: \`docs/validation-scale.json\`.`,
  ].join('\n');
}

/** Cross-engine determinism of the deterministic maths (docs/determinism.json). */
function determinism(): string {
  const d = read('docs/determinism.json');
  const ok = d.results.filter((r: { error?: string }) => !r.error);
  const name = (r: { engine: string; browser?: string }) => {
    const version = r.browser?.match(/\d[\d.]*$/)?.[0];
    return version ? r.engine.replace(/\)$/, ` ${version})`) : r.engine;
  };
  const failed = d.results.filter((r: { error?: string }) => r.error).map((r: { engine: string }) => r.engine);
  return [
    `The recorded West Kalimantan fire (40 runs) gives output hash \`${ok[0].det1.slice(0, 16)}…\` on ${ok.length} engines: ${ok.map(name).join('; ')}.`,
    `Identical: ${d.det1Identical ? 'yes' : '**no**'} (checked ${d.ranAt.slice(0, 10)}).${failed.length ? ` Not run on the machine that wrote this file: ${failed.join(', ')} (CI runs every engine on Linux).` : ''}`,
  ].join(' ');
}

/** Satellite emission number against GFED4.1s, and burned area against FIRMS. */
function carbon(): string {
  const c = read('data/validation/emissions-crosscheck.json');
  const years = Object.entries(c.years as Record<string, { cells: { co2: { frp_total: number; gfed_total: number } }[] }>).map(([y, v]) => {
    let a = 0, b = 0;
    for (const x of v.cells) { a += x.co2.frp_total; b += x.co2.gfed_total; }
    return `${y} ${f2(a / b)}×`;
  });
  const ba = read('data/validation/burned-area/summary.json').events.filter((e: { burned_ha: number }) => e.burned_ha > 0);
  const share = ba.map((e: { share_of_burned_inside_firms_footprint: number }) => e.share_of_burned_inside_firms_footprint);
  return [
    `Satellite (FRP) CO₂ over GFED4.1s in the five most-burned peat cells: ${years.join(', ')}.`,
    `Measured burned area (Sentinel-2 dNBR and Sentinel-1 SAR) for ${ba.length} of the October 2026 fires: ${pct(Math.min(...share))}–${pct(Math.max(...share))} of it lies inside the FIRMS footprints.`,
  ].join(' ');
}

/** Automated tests (vitest). */
function tests(): string {
  let n = 0;
  for (const dir of ['src', 'server', 'scripts']) for (const p of files(dir, '.test.ts')) n += readFileSync(join(root, p), 'utf8').match(/^\s*(it|test)(\.each\([^)]*\))?\(/gm)?.length ?? 0;
  return `${n} automated tests`;
}

const BLOCKS: Record<string, () => string> = { hindcast, register, split, forecaster, determinism, carbon, tests };
const TARGETS = ['README.md', 'docs/submission.md'];

const check = process.argv.includes('--check');
let stale = 0;
for (const t of TARGETS) {
  const path = join(root, t);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(/<!-- gen:(\w+) -->([\s\S]*?)<!-- \/gen:\1 -->/g, (_, name: string, body: string) => {
    const fn = BLOCKS[name];
    if (!fn) throw new Error(`${t}: unknown generated block "${name}"`);
    // Inline blocks (no newline after the opening marker) stay inline.
    const inline = !body.startsWith('\n');
    const text = fn();
    return inline ? `<!-- gen:${name} -->${text}<!-- /gen:${name} -->` : `<!-- gen:${name} -->\n${text}\n<!-- /gen:${name} -->`;
  });
  if (after === before) continue;
  stale++;
  if (check) console.error(`${relative(root, path)} is out of date: run npx tsx scripts/gen-docs.ts`);
  else { writeFileSync(path, after); console.log(`updated ${t}`); }
}
if (check && stale) process.exit(1);
if (!stale) console.log('generated blocks up to date');
