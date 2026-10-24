// Re-run the recorded fire in Node, Chromium, Firefox and WebKit and compare the output hashes.
//
//   npx playwright install chromium firefox webkit   # once
//   node scripts/determinism.mjs                     # exits 1 if the 'det1' hashes differ
//
// Where Playwright's Firefox cannot start (it hangs on some macOS releases), the same
// SpiderMonkey engine is checked with Mozilla's standalone shell when JSSHELL points to it
// (or .cache/jsshell/js exists: unzip https://ftp.mozilla.org/pub/firefox/releases/<v>/jsshell/jsshell-mac.zip).
// REQUIRE_ALL=1 (set in CI) fails the check if any engine could not run.
//
// Writes docs/determinism.json, which the generated docs quote.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const root = process.cwd();
const tmp = join(root, '.cache', 'determinism');
mkdirSync(tmp, { recursive: true });
const opts = { entryPoints: [join(root, 'src/sim/determinism.ts')], bundle: true, logLevel: 'warning', target: 'es2022' };
await build({ ...opts, format: 'esm', platform: 'node', outfile: join(tmp, 'det.mjs') });
const iife = await build({ ...opts, format: 'iife', globalName: '__det', write: false });
const script = iife.outputFiles[0].text;

const results = [];
const node = await import(pathToFileURL(join(tmp, 'det.mjs')).href);
results.push(node.run());

for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  let browser;
  try {
    browser = await type.launch({ timeout: 45_000 });
    const page = await browser.newPage();
    // Served from a fake https origin so the page is an ordinary secure context.
    await page.route('https://determinism.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>det</title>' }));
    await page.goto('https://determinism.test/');
    await page.addScriptTag({ content: script });
    const r = await page.evaluate(() => globalThis.__det.run());
    results.push({ ...r, browser: `${name} ${browser.version()}` });
  } catch (e) {
    results.push({ engine: name, error: String(e).split('\n')[0] });
  } finally {
    await browser?.close();
  }
}

// SpiderMonkey shell: no atob/WebCrypto, so base64 is polyfilled and the bundle hashes in plain JS.
const shell = process.env.JSSHELL ?? join(root, '.cache', 'jsshell', 'js');
if (existsSync(shell)) {
  const atob = `globalThis.atob = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let o = '', b = 0, n = 0;
    for (const c of s.replace(/=+$/, '')) { b = (b << 6) | A.indexOf(c); n += 6; if (n >= 8) { n -= 8; o += String.fromCharCode((b >> n) & 255); } } return o; };`;
  const file = join(tmp, 'det-shell.js');
  writeFileSync(file, `${atob}\n${script}\nprint(JSON.stringify(__det.run()));`);
  try {
    const out = execFileSync(shell, [file], { encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n').at(-1);
    const version = execFileSync(shell, ['-e', 'print(typeof version === "function" ? version() : "")'], { encoding: 'utf8' }).trim();
    results.push({ ...JSON.parse(out), browser: `SpiderMonkey shell ${version}` });
  } catch (e) {
    results.push({ engine: 'SpiderMonkey shell', error: String(e).split('\n')[0] });
  }
}

const ok = results.filter((r) => !r.error);
const same = (k) => ok.every((r) => r[k] === ok[0][k]);
const report = {
  ranAt: new Date().toISOString(),
  scenario: 'src/data/events/kalimantan-2026-10-18.json, 40 runs, no actions',
  det1Identical: same('det1'),
  nativeIdentical: same('native'),
  results,
};
writeFileSync(join(root, 'docs', 'determinism.json'), JSON.stringify(report, null, 1) + '\n');
for (const r of results) console.log(r.error ? `${r.engine}: ERROR ${r.error}` : `${r.engine.padEnd(24)} det1 ${r.det1.slice(0, 16)}  native ${r.native.slice(0, 16)}  ${r.ms} ms`);
console.log(`det1 identical across ${ok.length} engines: ${report.det1Identical}; engine Math identical: ${report.nativeIdentical}`);
if (!report.det1Identical || (process.env.REQUIRE_ALL && ok.length < results.length)) process.exit(1);
