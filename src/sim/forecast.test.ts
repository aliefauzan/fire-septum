import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { bboxAround } from '../data/live';
import { registerAsForecast } from '../data/register';
import { runEnsemble } from './ensemble';
import {
  BLOCKS, CLIMATOLOGY_RATE, FORECAST_GRID, FORECAST_SCHEMA, boxBounds, climatologyProbabilities, detectionsInWindow, distanceProbabilities,
  fireMaskFromDetections, maskFromString, maskToString, scoreForecast, splitForecast, validateForecast, type Forecast,
} from './forecast';
import { blockFireMask, scoreHindcast } from './hindcast';
import { checkRecord, decode, outputsDigest, type RunInputs } from './receipt';
import { observedInWindow, type RegisterEntry } from './register';

const ROOT = join(__dirname, '..', '..');
const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'forecast-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const schemaValid = ajv.compile(schema);

const good = (): Forecast => ({
  schema: FORECAST_SCHEMA,
  model: { id: 'example-gbm', name: 'Gradient boosting', version: '0.1.0', url: 'https://example.org/model' },
  issuedAt: '2026-10-24T10:00:00Z', windowH: 24, grid: FORECAST_GRID,
  box: { lat: -2.9641, lon: 112.1507 },
  probabilities: new Array(BLOCKS).fill(0.1),
});

describe('forecast schema', () => {
  const bad: [string, (f: Record<string, unknown>) => void][] = [
    ['wrong schema tag', (f) => { f.schema = 'other'; }],
    ['255 probabilities', (f) => { (f.probabilities as number[]).pop(); }],
    ['probability > 1', (f) => { (f.probabilities as number[])[3] = 1.2; }],
    ['probability NaN-like string', (f) => { (f.probabilities as unknown[])[0] = '0.5'; }],
    ['window 48 h', (f) => { f.windowH = 48; }],
    ['other grid', (f) => { f.grid = 'cells100m'; }],
    ['no time zone', (f) => { f.issuedAt = '2026-10-24T10:00:00'; }],
    ['uppercase model id', (f) => { (f.model as { id: string }).id = 'GBM'; }],
    ['model without version', (f) => { delete (f.model as { version?: string }).version; }],
    ['unknown field', (f) => { f.extra = 1; }],
    ['box and boxes', (f) => { f.boxes = [{ lat: 0, lon: 110, probabilities: new Array(BLOCKS).fill(0) }]; }],
    ['no box', (f) => { delete f.box; delete f.probabilities; }],
    ['lat out of range', (f) => { (f.box as { lat: number }).lat = 95; }],
  ];

  it('accepts a valid single-box and multi-box forecast (validator and JSON Schema agree)', () => {
    const f = good();
    expect(validateForecast(f)).toEqual([]);
    expect(schemaValid(f)).toBe(true);
    const { box, probabilities, ...rest } = f;
    const multi = { ...rest, metadata: { features: ['fwi'] }, boxes: [{ ...box!, probabilities: probabilities! }, { lat: -3.3, lon: 112.6, probabilities: new Array(BLOCKS).fill(0) }] };
    expect(validateForecast(multi)).toEqual([]);
    expect(schemaValid(multi)).toBe(true);
    expect(splitForecast(multi as Forecast).map((b) => b.box)).toEqual([box, { lat: -3.3, lon: 112.6 }]);
  });

  it.each(bad)('rejects %s (validator and JSON Schema agree)', (_name, mutate) => {
    const f = good() as unknown as Record<string, unknown>;
    mutate(f);
    expect(validateForecast(f).length).toBeGreaterThan(0);
    expect(schemaValid(f)).toBe(false);
  });
});

describe('forecast geometry and references', () => {
  it('uses the same 6.4 km box as the live scenario', () => {
    for (const [lat, lon] of [[-2.9641, 112.1507], [3.1, 98.7], [-8.5, 140]]) expect(boxBounds(lat, lon)).toEqual(bboxAround(lat, lon));
  });

  it('round-trips the fire mask and builds the reference probabilities', () => {
    const m = new Uint8Array(BLOCKS); m[8 * 16 + 8] = 1;
    expect(maskFromString(maskToString(m))).toEqual(m);
    const d = distanceProbabilities(m);
    expect(d[8 * 16 + 8]).toBe(0); // the burning block itself is not a candidate
    expect(d[8 * 16 + 9]).toBeCloseTo(Math.exp(-0.4), 6); // neighbour, 400 m
    expect(d[9 * 16 + 9]).toBeGreaterThan(0.5); // diagonal neighbour, 566 m
    expect(d[8 * 16 + 10]).toBeLessThan(0.5); // two blocks away
    expect(distanceProbabilities(new Uint8Array(BLOCKS)).every((p) => p === 0)).toBe(true);
    expect(climatologyProbabilities().every((p) => p === CLIMATOLOGY_RATE)).toBe(true);
  });

  it('marks fire at t0 from detections of the 48 h before issuedAt only', () => {
    const box = { lat: -3, lon: 112 };
    const at = (h: number) => new Date(Date.parse('2026-10-24T10:00:00Z') + h * 3.6e6).toISOString();
    const m = fireMaskFromDetections(box, at(0), [
      { lat: -3, lon: 112, acquired: at(-5) },
      { lat: -2.98, lon: 112, acquired: at(-60) }, // too old
      { lat: -3.02, lon: 112, acquired: at(1) }, // after issue
    ]);
    expect(m.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
    expect(m.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(4);
    expect(m[8 * 16 + 8] || m[7 * 16 + 7] || m[7 * 16 + 8] || m[8 * 16 + 7]).toBe(1);
  });
});

// The register's own forecasts, sealed on 20 Oct 2026: they must re-run to their sealed output hash,
// and scoring them on the open benchmark's terms must give exactly scoreHindcast's numbers.
const dir = join(ROOT, 'data', 'register');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

describe.each(files)('register entry %s', (file) => {
  const e = JSON.parse(readFileSync(join(dir, file), 'utf8')) as RegisterEntry;
  const inputs = decode<RunInputs>(e.record.inputs);
  const base = runEnsemble(inputs.scenario, inputs.actions, inputs.params, inputs.seeds);
  const l = inputs.scenario.landscape;

  it('re-runs to the sealed output hash', async () => {
    const c = await checkRecord(e.record);
    expect(c.receiptHash && c.inputsHash).toBe(true);
    expect(await outputsDigest(base, base)).toBe(e.record.receipt.outputsSha256);
    expect(l.geo).toEqual(bboxAround(e.lat, e.lon));
  });

  it('scoreForecast of the CA forecast equals scoreHindcast', () => {
    const t = Date.parse(e.issuedAt);
    // Detections around the fire and across the box, before, inside and after the window.
    const g = l.geo!;
    const dets = [];
    for (let i = 0; i < 300; i++) {
      const u = (i * 0.6180339887) % 1, v = (i * 0.7548776662) % 1;
      dets.push({ lat: g.south + (g.north - g.south) * (0.25 + 0.5 * v), lon: g.west + (g.east - g.west) * (0.25 + 0.5 * u), acquired: new Date(t + ((i % 31) - 3) * 3.6e6).toISOString(), frp: 1, confidence: 'n', satellite: 'N' });
    }
    if (e.score?.benchmark) dets.push(...e.score.benchmark.observed);
    const expected = scoreHindcast(l, inputs.scenario.init, base, observedInWindow(l, e, dets), e.windowH);
    const mask = blockFireMask(l, inputs.scenario.init);
    const got = scoreForecast(registerAsForecast(e, inputs, base), dets, mask);
    const { detections, ...core } = got;
    expect(core).toEqual(expected);
    expect(detections).toBe(observedInWindow(l, e, dets).length);
    expect(detectionsInWindow({ ...e, box: { lat: e.lat, lon: e.lon } }, dets).length).toBe(detections);
  });

  it('a stored score recomputes from its stored detections', () => {
    if (!e.score?.benchmark) return;
    const mask = maskFromString(e.score.benchmark.fireAtT0);
    expect(mask).toEqual(blockFireMask(l, inputs.scenario.init));
    const again = scoreHindcast(l, inputs.scenario.init, base, observedInWindow(l, e, e.score.benchmark.observed), e.windowH);
    expect(again).toEqual(e.score.result);
    expect(scoreForecast(registerAsForecast(e, inputs, base), e.score.benchmark.observed, mask)).toEqual(e.score.benchmark.models['fire-septum-ca']);
  });
});
