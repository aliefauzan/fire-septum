// Records made under the first name (SekatApi, version 1, engine Math) must keep verifying:
// their receipt hash, inputs hash, Ed25519 signature, and a re-run to the sealed output hash.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEnsemble } from './ensemble';
import { DEFAULT_PARAMS } from './model';
import { RECEIPT_KIND, checkRecord, decode, isRunRecord, outputsDigest, signedMessage, type RunInputs } from './receipt';
import { ENTRY_KIND, type RegisterEntry } from './register';

const DIR = join(process.cwd(), 'data', 'register');
const v1 = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as RegisterEntry)
  .filter((e) => e.kind === ENTRY_KIND[1]);

describe('version 1 records (SekatApi) still verify', () => {
  it('there are version 1 entries in the register', () => expect(v1.length).toBeGreaterThan(0));

  it('receipt hash, inputs hash and signature hold', async () => {
    for (const e of v1) {
      expect(e.record.receipt.kind).toBe(RECEIPT_KIND[1]);
      expect(isRunRecord(e.record)).toBe(true);
      const c = await checkRecord(e.record);
      expect(c).toMatchObject({ receiptHash: true, inputsHash: true, signature: true });
    }
  });

  it('re-runs to the sealed output hash with the engine Math it was made with', async () => {
    const e = v1[0];
    const inputs = decode<RunInputs>(e.record.inputs);
    expect(inputs.params.math).toBeUndefined();
    const base = runEnsemble(inputs.scenario, inputs.actions, inputs.params, inputs.seeds);
    expect(await outputsDigest(base, base)).toBe(e.record.receipt.outputsSha256);
  }, 60_000);

  it('new records use version 2 identifiers and deterministic maths', () => {
    expect(signedMessage('ab', 't')).toBe('fireseptum-receipt-v2:ab:t');
    expect(DEFAULT_PARAMS.math).toBe('det1');
  });
});
