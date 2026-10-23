import { describe, expect, it } from 'vitest';
import { CO2_PER_C, emissions, fmtTonnes, peatHaPerRun, tco2ePerHa } from './carbon';
import { DEFAULT_RATES } from './doctrine';
import { runEnsemble } from './ensemble';
import { DEFAULT_PARAMS } from './model';
import { scoreHindcast } from './hindcast';
import { splitAtLastPass } from '../data/hindcast';
import { buildReceipt, canonical, checkRecord, decode, encode, inputsDigest, outputsDigest, sha256Hex, type RunInputs, type RunRecord } from './receipt';
import { sketchScenario } from './scenarios';
import { Cell, type Action, type Scenario } from './types';

const P = { ...DEFAULT_PARAMS, runs: 12 };
const line: Action = { id: 'l1', kind: 'firebreak', from: [34, 8], to: [34, 30], cellsPerHour: 6, method: 'dozer', startH: 0 };

describe('peat emissions (IPCC Tier 1)', () => {
  it('uses the Wetlands Supplement factors: 353 t/ha × (464 g C × 44/12 + 21 g CH4 × 27)', () => {
    expect(CO2_PER_C).toBeCloseTo(3.667, 3);
    // 353 × (1,701.3 + 567) / 1000 ≈ 800.7 t CO2e per ha.
    expect(tco2ePerHa(DEFAULT_RATES)).toBeCloseTo(800.7, 1);
  });

  it('counts only newly burned peat-soil cells, and a plan cannot raise paired avoided emissions above the baseline', () => {
    const s = sketchScenario();
    const base = runEnsemble(s, [], P);
    const plan = runEnsemble(s, [line], P);
    const em = emissions(s.landscape, base, plan, DEFAULT_RATES, s.horizonH);
    const peatHa = peatHaPerRun(s.landscape, base, s.horizonH);
    expect(Math.max(...peatHa)).toBeLessThanOrEqual(Math.max(...base.burnedHa));
    expect(em.base.mean).toBeGreaterThan(0);
    expect(em.avoided!.mean).toBeLessThanOrEqual(em.base.mean);
    expect(em.base.p10).toBeLessThanOrEqual(em.base.p90);
  });

  it('rounds to two significant figures for display', () => {
    expect(fmtTonnes(256231)).toBe('260,000');
    expect(fmtTonnes(1234)).toBe('1,200');
    expect(fmtTonnes(0.4)).toBe('0');
  });
});

describe('run receipts', () => {
  const s = sketchScenario();
  const inputs: RunInputs = { scenario: s, actions: [line], params: P, seeds: Array.from({ length: P.runs }, (_, i) => i + 1) };

  it('round-trips typed arrays through encode/decode and JSON', () => {
    const back = decode<Scenario>(JSON.parse(JSON.stringify(encode(s))));
    expect(back.landscape.elev).toBeInstanceOf(Float32Array);
    expect(Array.from(back.landscape.elev)).toEqual(Array.from(s.landscape.elev));
    expect(Array.from(back.init.remaining)).toEqual(Array.from(s.init.remaining));
  });

  it('canonical JSON does not depend on key order', () => {
    expect(canonical({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(canonical({ a: [2, { c: 4, d: 3 }], b: 1 }));
  });

  it('gives the same output hash when the same inputs are re-run, and a different one when the weather changes', async () => {
    const a = await outputsDigest(runEnsemble(s, [], P), runEnsemble(s, [line], P));
    const b = await outputsDigest(runEnsemble(s, [], P), runEnsemble(s, [line], P));
    const windy = { ...s, weather: s.weather.map((w) => ({ ...w, windKmh: w.windKmh * 2 })) };
    const c = await outputsDigest(runEnsemble(windy, [], P), runEnsemble(windy, [line], P));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('detects a tampered input, result or record', async () => {
    const base = runEnsemble(s, [], P), plan = runEnsemble(s, [line], P);
    const em = emissions(s.landscape, base, plan, DEFAULT_RATES, s.horizonH);
    const { receipt, receiptSha256 } = await buildReceipt(inputs, base, plan, em, 'V8 (Node)');
    const record: RunRecord = JSON.parse(JSON.stringify({ receipt, receiptSha256, inputs: encode(inputs) }));
    expect(await checkRecord(record)).toMatchObject({ receiptHash: true, inputsHash: true, signature: null });

    // Re-running the decoded inputs reproduces the recorded outputs.
    const d = decode<RunInputs>(record.inputs);
    expect(await outputsDigest(runEnsemble(d.scenario, [], d.params), runEnsemble(d.scenario, d.actions, d.params))).toBe(receipt.outputsSha256);

    const edited = structuredClone(record);
    edited.receipt.results.savedHa.mean += 100;
    expect((await checkRecord(edited)).receiptHash).toBe(false);

    const moved = structuredClone(record);
    (moved.inputs as { actions: Action[] }).actions[0].startH = 3;
    expect((await checkRecord(moved)).inputsHash).toBe(false);
  });

  it('hashes inputs the same way before and after a JSON round trip', async () => {
    expect(await sha256Hex(canonical(JSON.parse(JSON.stringify(encode(inputs)))))).toBe(await inputsDigest(inputs));
  });
});

describe('hindcast scoring', () => {
  const s = sketchScenario();
  const base = runEnsemble(s, [], P);
  const at = 12;
  // Observations: cells that ignited in most runs, plus one far-off new fire.
  const n = s.landscape.w * s.landscape.h;
  const share = new Float32Array(n);
  for (const r of base.runs) for (let k = 0; k < n; k++) if (r.ign[k] > 0 && r.ign[k] <= at) share[k] += 1 / base.runs.length;
  const likely = [...share.keys()].filter((k) => share[k] > 0.9).map((k) => ({ x: k % s.landscape.w, y: Math.floor(k / s.landscape.w) }));

  it('scores a forecast against its own likely spread as skilful, and beats nothing', () => {
    const sc = scoreHindcast(s.landscape, s.init, base, likely, at);
    expect(sc.observed).toBeGreaterThan(0);
    expect(sc.pod).toBeGreaterThan(0.8);
    expect(sc.csi).toBeGreaterThan(0.3);
  });

  it('does not score fire already burning at t0, and sets aside new fires out of reach', () => {
    const burning = [...s.init.state.keys()].filter((k) => s.init.state[k] === Cell.Burning).slice(0, 20).map((k) => ({ x: k % s.landscape.w, y: Math.floor(k / s.landscape.w) }));
    const sc = scoreHindcast(s.landscape, s.init, base, burning, at);
    expect(sc.observed).toBe(0);
    const far = scoreHindcast(s.landscape, s.init, base, [{ x: 63, y: 63 }], at, { reachKm: 0.5 });
    expect(far.newFires).toBe(1);
    expect(far.observed).toBe(0);
  });

  it('splits detections at the last pass of the day', () => {
    const h = (acquired: string) => ({ lat: 0, lon: 0, frp: 1, confidence: 'n', satellite: 'N', acquired });
    const sp = splitAtLastPass([h('2026-10-09T05:30:00Z'), h('2026-10-10T05:30:00Z'), h('2026-10-10T17:40:00Z'), h('2026-10-11T05:10:00Z'), h('2026-10-12T05:10:00Z')], '2026-10-10')!;
    expect(sp.t0).toBe('2026-10-10T17:40:00Z');
    expect(sp.known).toHaveLength(3);
    expect(sp.observed.map((x) => x.acquired)).toEqual(['2026-10-11T05:10:00Z']);
  });
});
