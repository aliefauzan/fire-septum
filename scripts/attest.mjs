// Attest daily batch roots with the Ethereum Attestation Service (EAS) on Base. No token.
//
//   node scripts/attest.mjs 2026-10-20             # Base Sepolia (testnet), one day
//   node scripts/attest.mjs --all                  # every batch not yet attested on that network
//   node scripts/attest.mjs --all --dry-run        # never broadcast, even with a key
//   node scripts/attest.mjs --all --network base   # Base mainnet: only with this explicit flag
//
// Key: EAS_PRIVATE_KEY from the environment or .env.local (gitignored). Without a key the script
// runs dry: it prints the calldata and simulates each call with eth_call; nothing is broadcast.
// RPC: EAS_RPC_URL, else https://sepolia.base.org (testnet) / https://mainnet.base.org.
//
// The schema (bytes32 merkleRoot, string day, uint32 records, string uri; non-revocable, no
// resolver) is registered once per network; its UID goes to data/batches/eas.json. Each
// attestation is written into its batch file as `eas`. The attestation adds a public, widely
// indexed record of the root next to the OpenTimestamps proof; it does not make the forecasts
// more correct (re-running them does that).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, decodeEventLog, encodeAbiParameters, formatEther, http, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import {
  EAS_ABI, EAS_ADDRESS, NETWORKS, SCHEMA, SCHEMA_REGISTRY_ABI, SCHEMA_REGISTRY_ADDRESS, SCHEMA_RESOLVER, SCHEMA_REVOCABLE,
  ZERO_BYTES32, attestCalldata, attestationUrl, batchUri, decodeAttestCalldata, registerCalldata, schemaUid, schemaUrl,
} from './eas-lib.mjs';

const ROOT = process.cwd();
const DIR = join(ROOT, 'data', 'batches');
const EAS_FILE = join(DIR, 'eas.json');
const DRY_FROM = '0x000000000000000000000000000000000000dEaD';

function envLocal(name) {
  if (process.env[name]) return process.env[name].trim();
  const f = join(ROOT, '.env.local');
  if (!existsSync(f)) return undefined;
  const line = readFileSync(f, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') || undefined;
}

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const network = opt('--network') ?? 'base-sepolia';
if (!(network in NETWORKS)) throw new Error(`unknown network ${network} (base-sepolia or base)`);
const net = NETWORKS[network];
const chain = network === 'base' ? base : baseSepolia;
const rpc = process.env.EAS_RPC_URL || net.rpc;
const pk = envLocal('EAS_PRIVATE_KEY');
const dry = flag('--dry-run') || !pk;
if (pk && !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error('EAS_PRIVATE_KEY must be 0x followed by 64 hex digits');
const account = pk ? privateKeyToAccount(pk) : null;
const from = account?.address ?? DRY_FROM;

const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = account && !dry ? createWalletClient({ account, chain, transport: http(rpc) }) : null;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const batchFiles = () => (existsSync(DIR) ? readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : []);
const easOf = (b) => (b.eas ? (Array.isArray(b.eas) ? b.eas : [b.eas]) : []);

async function simulate(label, to, data, stateOverride) {
  try {
    const r = await pub.call({ account: from, to, data, ...(stateOverride ? { stateOverride } : {}) });
    console.log(`   eth_call ${label}: ok${r.data ? ` → ${r.data}` : ''}`);
    return { ok: true, data: r.data };
  } catch (e) {
    const m = (e?.shortMessage || e?.message || String(e)).split('\n')[0];
    console.log(`   eth_call ${label}: reverted (${m})`);
    return { ok: false, error: m };
  }
}

/** eth_call state override that makes SchemaRegistry hold this schema (uid, no resolver, non-revocable). */
function schemaRegisteredOverride(uid) {
  const base = BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [uid, 0n])));
  const slot = (i) => `0x${(base + BigInt(i)).toString(16).padStart(64, '0')}`;
  return [{ address: SCHEMA_REGISTRY_ADDRESS, stateDiff: [{ slot: slot(0), value: uid }, { slot: slot(1), value: ZERO_BYTES32 }] }];
}

async function main() {
  console.log(`EAS on ${network} (chain ${net.chainId}) via ${rpc}`);
  console.log(dry ? `DRY RUN: nothing will be broadcast${pk ? ' (--dry-run)' : ' (no EAS_PRIVATE_KEY)'}; simulating from ${from}` : `LIVE: sending transactions from ${from}`);

  // 1. The predeploys are where the docs say, and are EAS.
  const chainId = await pub.getChainId();
  if (chainId !== net.chainId) throw new Error(`RPC is on chain ${chainId}, expected ${net.chainId}`);
  const [easVersion, regVersion, registryOfEas] = await Promise.all([
    pub.readContract({ address: EAS_ADDRESS, abi: EAS_ABI, functionName: 'version' }),
    pub.readContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: SCHEMA_REGISTRY_ABI, functionName: 'version' }),
    pub.readContract({ address: EAS_ADDRESS, abi: EAS_ABI, functionName: 'getSchemaRegistry' }),
  ]);
  console.log(`EAS ${EAS_ADDRESS} version ${easVersion}; SchemaRegistry ${SCHEMA_REGISTRY_ADDRESS} version ${regVersion}`);
  if (registryOfEas.toLowerCase() !== SCHEMA_REGISTRY_ADDRESS.toLowerCase()) throw new Error(`EAS.getSchemaRegistry() is ${registryOfEas}, expected ${SCHEMA_REGISTRY_ADDRESS}`);
  if (account) console.log(`Balance of ${from}: ${formatEther(await pub.getBalance({ address: from }))} ETH`);

  // 2. Schema: registered once per network.
  const uid = schemaUid();
  const easJson = existsSync(EAS_FILE) ? readJson(EAS_FILE) : {};
  const onChain = await pub.readContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: SCHEMA_REGISTRY_ABI, functionName: 'getSchema', args: [uid] });
  let registered = onChain.uid !== ZERO_BYTES32;
  console.log(`Schema "${SCHEMA}" (non-revocable, no resolver)\n   UID ${uid} — ${registered ? 'registered' : 'not registered yet'} on ${network}`);
  if (!registered) {
    const data = registerCalldata();
    console.log(`   SchemaRegistry.register calldata: ${data}`);
    await simulate('SchemaRegistry.register', SCHEMA_REGISTRY_ADDRESS, data);
    if (wallet) {
      const hash = await wallet.writeContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: SCHEMA_REGISTRY_ABI, functionName: 'register', args: [SCHEMA, SCHEMA_RESOLVER, SCHEMA_REVOCABLE] });
      console.log(`   register tx ${net.tx}${hash}`);
      const rcpt = await pub.waitForTransactionReceipt({ hash });
      if (rcpt.status !== 'success') throw new Error('schema registration failed');
      registered = true;
      easJson[network] = { chainId: net.chainId, schema: SCHEMA, resolver: SCHEMA_RESOLVER, revocable: SCHEMA_REVOCABLE, schemaUid: uid, registeredTx: hash, registeredAt: new Date().toISOString(), explorer: schemaUrl(network, uid) };
      writeFileSync(EAS_FILE, JSON.stringify(easJson, null, 1) + '\n');
    }
  } else if (!easJson[network] && !dry) {
    easJson[network] = { chainId: net.chainId, schema: SCHEMA, resolver: SCHEMA_RESOLVER, revocable: SCHEMA_REVOCABLE, schemaUid: uid, registeredTx: null, registeredAt: null, explorer: schemaUrl(network, uid) };
    writeFileSync(EAS_FILE, JSON.stringify(easJson, null, 1) + '\n');
  }

  // 3. Attest each requested batch root once per network.
  const days = flag('--all') ? batchFiles().map((f) => f.slice(0, 10)) : args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--network');
  if (!days.length) { console.log('No day given. Use a day (YYYY-MM-DD) or --all.'); return; }
  const uriBase = process.env.EAS_BATCH_URI_BASE;
  for (const day of days) {
    const file = join(DIR, `${day}.json`);
    if (!existsSync(file)) { console.log(`${day}: no batch file (seal it first: npx tsx scripts/seal-day.ts ${day})`); continue; }
    const b = readJson(file);
    if (easOf(b).some((e) => e.network === network)) { console.log(`${day}: already attested on ${network}`); continue; }
    const uri = uriBase ? batchUri(day, uriBase) : batchUri(day);
    const data = attestCalldata(uid, b, uri);
    const back = decodeAttestCalldata(data);
    if (back.batch.root !== b.root || back.batch.day !== day || back.schema !== uid) throw new Error('calldata does not decode back to the batch');
    console.log(`${day}: root ${b.root}, ${b.leaves.length} record(s), uri ${uri}`);
    console.log(`   EAS.attest calldata: ${data}`);
    const sim = await simulate('EAS.attest', EAS_ADDRESS, data);
    if (!sim.ok && !registered) {
      // EAS rejects an unknown schema. Simulate again as if the registration had landed: the
      // registry's record for this UID (mapping at storage slot 0) is set in the eth_call only.
      console.log('   (expected while the schema is not registered: a live run registers it first, then attests)');
      await simulate('EAS.attest with the schema registered (state override)', EAS_ADDRESS, data, schemaRegisteredOverride(uid));
    }
    if (!wallet) continue;
    const hash = await wallet.sendTransaction({ to: EAS_ADDRESS, data });
    console.log(`   attest tx ${net.tx}${hash}`);
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== 'success') throw new Error(`${day}: attestation failed`);
    let attestationUid = null;
    for (const log of rcpt.logs) {
      if (log.address.toLowerCase() !== EAS_ADDRESS.toLowerCase()) continue;
      try { const ev = decodeEventLog({ abi: EAS_ABI, data: log.data, topics: log.topics }); if (ev.eventName === 'Attested') attestationUid = ev.args.uid; } catch { /* other event */ }
    }
    if (!attestationUid) throw new Error(`${day}: no Attested event in ${hash}`);
    const att = { network, chainId: net.chainId, schemaUid: uid, attestationUid, txHash: hash, attestedAt: new Date().toISOString(), explorer: attestationUrl(network, attestationUid) };
    const prev = easOf(b);
    b.eas = prev.length ? [...prev, att] : att;
    writeFileSync(file, JSON.stringify(b, null, 1) + '\n');
    console.log(`   attested: ${att.explorer}`);
  }
}

main().catch((e) => { console.error(e?.shortMessage || e?.message || e); process.exit(1); });
