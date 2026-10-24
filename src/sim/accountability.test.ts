// Co-signatures, decision records, daily batches and the EAS attestation calldata.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EAS_ADDRESS, SCHEMA, SCHEMA_REGISTRY_ADDRESS, ZERO_ADDRESS, ZERO_BYTES32, attestCalldata, decodeAttestCalldata, encodeBatchData, decodeBatchData, schemaUid,
} from '../../scripts/eas-lib.mjs';
import { buildBatch, otsStatus, planBatch, utcDay, type DailyBatch, type SealedLeaf } from './batch';
import { cosign, generateRoleKey, parseRoleKey, withCosignature } from './cosign';
import { alternativesOf, buildDecision, checkDecision, isDecisionRecord, type DecisionRecord } from './decision';
import { verifyInclusion } from './merkle';
import { DECISION_SIGNATURE_SCHEME, SIGNATURE_SCHEME, canonical, checkRecord, fromB64, sha256Hex, signedMessage, toB64, verifyCosignature, type RunRecord } from './receipt';
import type { Recommendation } from './recommend';
import { ENTRY_KIND, type RegisterEntry } from './register';
import { UNKNOWN_INVENTORY } from './resources';

const H = (s: string) => createHash('sha256').update(s).digest('hex');

describe('co-signatures', () => {
  it('round-trip: a role key co-signs a record hash and the co-signature verifies', async () => {
    const key = await generateRoleKey('commander', 'Daops Manggala Agni Pulang Pisau');
    const hash = H('record');
    const c = await cosign(key, hash);
    expect(c).toMatchObject({ role: 'commander', alg: 'Ed25519', scheme: 'fireseptum-cosign-v1', keyId: key.keyId });
    expect(await verifyCosignature(hash, c)).toBe(true);
  });

  it('fails for another record, another role, another time, another key or a forged key id', async () => {
    const key = await generateRoleKey('bpbd', 'BPBD Kalteng');
    const other = await generateRoleKey('bpbd', 'Someone else');
    const hash = H('record');
    const c = await cosign(key, hash);
    expect(await verifyCosignature(H('other'), c)).toBe(false);
    expect(await verifyCosignature(hash, { ...c, role: 'commander' })).toBe(false);
    expect(await verifyCosignature(hash, { ...c, signedAt: new Date(0).toISOString() })).toBe(false);
    expect(await verifyCosignature(hash, { ...c, publicKey: other.publicKey })).toBe(false);
    expect(await verifyCosignature(hash, { ...c, publicKey: other.publicKey, keyId: other.keyId })).toBe(false);
    expect(await verifyCosignature(hash, { ...c, keyId: '0000000000000000' })).toBe(false);
  });

  it('key files export and import; an inconsistent key file is refused', async () => {
    const key = await generateRoleKey('forecaster', 'Analyst');
    const back = await parseRoleKey(JSON.parse(JSON.stringify(key)));
    expect(await verifyCosignature(H('x'), await cosign(back, H('x')))).toBe(true);
    const other = await generateRoleKey('forecaster', 'Other');
    await expect(parseRoleKey({ ...key, publicKey: other.publicKey, keyId: other.keyId })).rejects.toThrow(/inconsistent/);
    await expect(parseRoleKey({ kind: 'nope' })).rejects.toThrow();
  });

  it('checkRecord verifies co-signatures, which sit outside the receipt hash', async () => {
    const e = readdirSync(join(process.cwd(), 'data', 'register')).map((f) => JSON.parse(readFileSync(join(process.cwd(), 'data', 'register', f), 'utf8')) as RegisterEntry)[0];
    const key = await generateRoleKey('commander', 'IC');
    const rec: RunRecord = { ...e.record, cosignatures: withCosignature(undefined, await cosign(key, e.record.receiptSha256)) };
    expect(withCosignature(rec.cosignatures, rec.cosignatures![0])).toHaveLength(1);
    const ok = await checkRecord(rec);
    expect(ok).toMatchObject({ receiptHash: true, inputsHash: true });
    expect(ok.cosignatures).toEqual([{ role: 'commander', name: 'IC', keyId: key.keyId, ok: true }]);
    const forged = { ...rec, cosignatures: [{ ...rec.cosignatures![0], name: 'Someone else', role: 'bpbd' as const }] };
    expect((await checkRecord(forged)).cosignatures[0].ok).toBe(false);
  });
});

describe('decision records', () => {
  const rec = (id: string, rank: number, saved: number): Recommendation => ({
    id, rank, title: `Option ${rank}`, kind: 'firebreak', actions: [{ id: `act-${id}` }], saved: { mean: saved, p10: saved / 2, p90: saved * 1.5, pBetter: 0.876 },
  } as unknown as Recommendation);

  const make = () => buildDecision({
    decidedAt: '2026-10-24T06:00:00.000Z', decision: 'adopt-plan', summary: '  Option 1 chosen at 14:00 ', planReceiptSha256: H('plan'),
    forecast: { scenarioId: 'live', title: 'Live', provenance: { kind: 'live', weather: 'Open-Meteo', hotspots: 'FIRMS', fuel: 'WorldCover' }, inputsSha256: H('in'), outputsSha256: H('out'), actions: 1 },
    alternatives: alternativesOf([rec('b', 2, 40.04), rec('a', 1, 120.26), rec('c', 3, 5)], ['act-a', 'act-x']),
    inventory: UNKNOWN_INVENTORY, note: 'Dozer line on the north flank.', role: 'commander',
  });

  it('takes the alternatives from the recommender, best first, marking the adopted one', async () => {
    const { decision } = await make();
    expect(decision.summary).toBe('Option 1 chosen at 14:00');
    expect(decision.alternatives.map((a) => [a.rank, a.adopted, a.savedHa.mean])).toEqual([[1, true, 120.3], [2, false, 40], [3, false, 5]]);
    expect(decision.alternatives[0].pBetter).toBe(0.88);
  });

  it('hashes canonical JSON, verifies a decision-scheme server signature and co-signatures, and catches tampering', async () => {
    const { decision, decisionSha256 } = await make();
    expect(decisionSha256).toBe(await sha256Hex(canonical(decision)));
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pub = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32);
    const signedAt = '2026-10-24T06:00:01.000Z';
    const sig = sign(null, Buffer.from(signedMessage(decisionSha256, signedAt, DECISION_SIGNATURE_SCHEME)), privateKey).toString('base64');
    const key = await generateRoleKey('bpbd', 'BPBD');
    const r: DecisionRecord = {
      decision, decisionSha256,
      signature: { alg: 'Ed25519', scheme: DECISION_SIGNATURE_SCHEME, publicKey: toB64(pub), keyId: (await sha256Hex(pub)).slice(0, 16), signedAt, sig },
      cosignatures: [await cosign(key, decisionSha256)],
    };
    const back = JSON.parse(JSON.stringify(r));
    expect(isDecisionRecord(back)).toBe(true);
    expect(await checkDecision(back)).toMatchObject({ hash: true, signature: true, cosignatures: [{ role: 'bpbd', ok: true }] });

    const edited = structuredClone(back);
    edited.decision.alternatives[0].adopted = false;
    expect((await checkDecision(edited)).hash).toBe(false);
    // A receipt-scheme signature over the same hash does not pass as a decision signature.
    const asReceipt = { ...back, signature: { ...back.signature, scheme: SIGNATURE_SCHEME[2] } };
    expect((await checkDecision(asReceipt)).signature).toBe(false);
  });

  it('refuses a decision that points at no sealed run record', async () => {
    const { decision } = await make();
    await expect(buildDecision({ ...decision, planReceiptSha256: 'nope' })).rejects.toThrow(/sealed run record/);
  });
});

describe('daily batches', () => {
  const L = (s: string, at: string): SealedLeaf => ({ hash: H(s), sealedAt: at, source: s });
  const recs = [L('a', '2026-10-20T16:00:00Z'), L('b', '2026-10-20T23:59:59Z'), L('c', '2026-10-21T00:00:00Z')];

  it('collects a day\'s records, never rebuilds a sealed day, and puts a late record into the next batch', async () => {
    const day1 = planBatch('2026-10-20', recs, [])!;
    expect(day1.map((l) => l.source)).toEqual(['a', 'b']);
    const b1 = await buildBatch('2026-10-20', day1, '2026-10-21T01:00:00Z');
    expect(planBatch('2026-10-20', recs, [b1])).toBeNull();
    // A record sealed on the 20th but stored after that day's batch was built.
    const late = L('late', '2026-10-20T12:00:00Z');
    const day2 = planBatch('2026-10-21', [...recs, late], [b1])!;
    expect(day2.map((l) => l.source).sort()).toEqual(['c', 'late']);
    const b2 = await buildBatch('2026-10-21', day2);
    expect(b2.leaves).toEqual([H('c'), H('late')].sort());
    // Rebuilding the same batch from the same records gives the same root.
    expect((await buildBatch('2026-10-20', day1)).root).toBe(b1.root);
    expect(planBatch('2026-10-22', [...recs, late], [b1, b2])).toEqual([]);
  });

  it('the backfilled batch of 20 Oct 2026 holds every register entry with a proof that verifies', async () => {
    const dir = join(process.cwd(), 'data', 'batches');
    const b = JSON.parse(readFileSync(join(dir, '2026-10-20.json'), 'utf8')) as DailyBatch;
    const entries = readdirSync(join(process.cwd(), 'data', 'register')).map((f) => JSON.parse(readFileSync(join(process.cwd(), 'data', 'register', f), 'utf8')) as RegisterEntry)
      .filter((e) => utcDay(e.issuedAt) === '2026-10-20');
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.kind).toBe(ENTRY_KIND[1]);
      expect(await verifyInclusion(b, e.record.receiptSha256)).toBe(true);
    }
    expect((await buildBatch(b.day, entries.map((e) => ({ hash: e.record.receiptSha256, sealedAt: e.issuedAt, source: '' })))).root).toBe(b.root);
    expect(b.ots && otsStatus(fromB64(b.ots.otsB64)).state).toMatch(/pending|bitcoin/);
  });

  it('reads the OpenTimestamps status from .ots bytes', () => {
    const bitcoin = Uint8Array.from([0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01, 0x03, 0xd0, 0xbc, 0x33]);
    expect(otsStatus(bitcoin)).toEqual({ state: 'bitcoin', height: 843344 });
    expect(otsStatus(Uint8Array.from([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e, 0x01])).state).toBe('pending');
    expect(otsStatus(new Uint8Array(4)).state).toBe('unknown');
  });
});

describe('EAS attestation calldata', () => {
  const batch = { day: '2026-10-20', root: H('root'), leaves: [H('a'), H('b'), H('c')] };

  it('uses the OP-stack predeploys and the schema UID the registry computes', () => {
    expect(EAS_ADDRESS).toBe('0x4200000000000000000000000000000000000021');
    expect(SCHEMA_REGISTRY_ADDRESS).toBe('0x4200000000000000000000000000000000000020');
    expect(SCHEMA).toBe('bytes32 merkleRoot,string day,uint32 records,string uri');
    // keccak256(abi.encodePacked(schema, resolver, revocable)); SchemaRegistry.register returned the same in an eth_call on Base Sepolia.
    expect(schemaUid()).toBe('0xd1a090ff6547fcad428f65174868b06b3fb455e95d1980422fe11f766802eba4');
    expect(schemaUid(SCHEMA, ZERO_ADDRESS, true)).not.toBe(schemaUid());
  });

  it('encodes attest(request) that decodes back to the batch with viem', () => {
    const uid = schemaUid();
    const uri = 'https://example.org/data/batches/2026-10-20.json';
    const data = attestCalldata(uid, batch, uri);
    expect(data.slice(0, 10)).toBe('0xf17325e7'); // attest((bytes32,(address,uint64,bool,bytes32,bytes,uint256)))
    const back = decodeAttestCalldata(data);
    expect(back).toMatchObject({ schema: uid, recipient: ZERO_ADDRESS, expirationTime: 0n, revocable: false, refUID: ZERO_BYTES32, value: 0n });
    expect(back.batch).toEqual({ root: batch.root, day: '2026-10-20', records: 3, uri });
    expect(decodeBatchData(encodeBatchData({ root: batch.root, day: batch.day, records: 6, uri: '' }))).toEqual({ root: batch.root, day: batch.day, records: 6, uri: '' });
    expect(() => encodeBatchData({ root: 'nope', day: batch.day, records: 1, uri })).toThrow();
  });
});
