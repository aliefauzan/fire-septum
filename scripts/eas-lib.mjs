// Ethereum Attestation Service (EAS) on Base: addresses, schema and calldata for attesting a
// daily batch root. Pure functions (no network), shared by scripts/attest.mjs and the tests.
//
// EAS and its SchemaRegistry are OP-stack predeploys, at the same addresses on Base and Base
// Sepolia (eas-contracts README, "Deployments"):
//   EAS            0x4200000000000000000000000000000000000021
//   SchemaRegistry 0x4200000000000000000000000000000000000020
// attest.mjs also checks on chain that EAS.getSchemaRegistry() returns the registry address.
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, parseAbiParameters } from 'viem';

export const EAS_ADDRESS = '0x4200000000000000000000000000000000000021';
export const SCHEMA_REGISTRY_ADDRESS = '0x4200000000000000000000000000000000000020';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

export const NETWORKS = {
  'base-sepolia': { chainId: 84532, rpc: 'https://sepolia.base.org', explorer: 'https://base-sepolia.easscan.org', tx: 'https://sepolia.basescan.org/tx/' },
  base: { chainId: 8453, rpc: 'https://mainnet.base.org', explorer: 'https://base.easscan.org', tx: 'https://basescan.org/tx/' },
};

/** One attestation per daily batch: its Merkle root, the day, how many records, and where the batch file is. */
export const SCHEMA = 'bytes32 merkleRoot,string day,uint32 records,string uri';
export const SCHEMA_RESOLVER = ZERO_ADDRESS;
export const SCHEMA_REVOCABLE = false;

/** Schema UID as SchemaRegistry computes it: keccak256(abi.encodePacked(schema, resolver, revocable)). */
export const schemaUid = (schema = SCHEMA, resolver = SCHEMA_RESOLVER, revocable = SCHEMA_REVOCABLE) =>
  keccak256(encodePacked(['string', 'address', 'bool'], [schema, resolver, revocable]));

export const SCHEMA_REGISTRY_ABI = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'schema', type: 'string' }, { name: 'resolver', type: 'address' }, { name: 'revocable', type: 'bool' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'getSchema', stateMutability: 'view', inputs: [{ name: 'uid', type: 'bytes32' }], outputs: [{ type: 'tuple', components: [{ name: 'uid', type: 'bytes32' }, { name: 'resolver', type: 'address' }, { name: 'revocable', type: 'bool' }, { name: 'schema', type: 'string' }] }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'event', name: 'Registered', inputs: [{ name: 'uid', type: 'bytes32', indexed: true }, { name: 'registerer', type: 'address', indexed: true }, { name: 'schema', type: 'tuple', indexed: false, components: [{ name: 'uid', type: 'bytes32' }, { name: 'resolver', type: 'address' }, { name: 'revocable', type: 'bool' }, { name: 'schema', type: 'string' }] }] },
];

const ATTESTATION_REQUEST = {
  name: 'request', type: 'tuple', components: [
    { name: 'schema', type: 'bytes32' },
    { name: 'data', type: 'tuple', components: [
      { name: 'recipient', type: 'address' },
      { name: 'expirationTime', type: 'uint64' },
      { name: 'revocable', type: 'bool' },
      { name: 'refUID', type: 'bytes32' },
      { name: 'data', type: 'bytes' },
      { name: 'value', type: 'uint256' },
    ] },
  ],
};

export const EAS_ABI = [
  { type: 'function', name: 'attest', stateMutability: 'payable', inputs: [ATTESTATION_REQUEST], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'getSchemaRegistry', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'event', name: 'Attested', inputs: [{ name: 'recipient', type: 'address', indexed: true }, { name: 'attester', type: 'address', indexed: true }, { name: 'uid', type: 'bytes32', indexed: false }, { name: 'schemaUID', type: 'bytes32', indexed: true }] },
];

const DATA_PARAMS = parseAbiParameters(SCHEMA);

/** ABI-encoded attestation data for a batch. */
export function encodeBatchData({ root, day, records, uri }) {
  if (!/^[0-9a-f]{64}$/.test(root)) throw new Error('root must be 64 lowercase hex digits');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('day must be YYYY-MM-DD');
  return encodeAbiParameters(DATA_PARAMS, [`0x${root}`, day, records, uri]);
}

export function decodeBatchData(data) {
  const [merkleRoot, day, records, uri] = decodeAbiParameters(DATA_PARAMS, data);
  return { root: merkleRoot.slice(2), day, records, uri };
}

/** Calldata for EAS.attest: non-revocable, no recipient, no expiry, no reference, no value. */
export function attestCalldata(uid, batch, uri) {
  const data = encodeBatchData({ root: batch.root, day: batch.day, records: batch.leaves.length, uri });
  return encodeFunctionData({
    abi: EAS_ABI, functionName: 'attest',
    args: [{ schema: uid, data: { recipient: ZERO_ADDRESS, expirationTime: 0n, revocable: false, refUID: ZERO_BYTES32, data, value: 0n } }],
  });
}

export const registerCalldata = () => encodeFunctionData({ abi: SCHEMA_REGISTRY_ABI, functionName: 'register', args: [SCHEMA, SCHEMA_RESOLVER, SCHEMA_REVOCABLE] });

/** Decode attest calldata back to its request (for checks and tests). */
export function decodeAttestCalldata(calldata) {
  const { functionName, args } = decodeFunctionData({ abi: EAS_ABI, data: calldata });
  if (functionName !== 'attest') throw new Error(`not attest: ${functionName}`);
  const req = args[0];
  return { schema: req.schema, ...req.data, batch: decodeBatchData(req.data.data) };
}

/** Public URL of a batch file (EAS_BATCH_URI_BASE overrides the repository default). */
export const batchUri = (day, base = 'https://raw.githubusercontent.com/aliefauzan/fire-septum/main/data/batches/') => `${base}${day}.json`;

export const attestationUrl = (network, uid) => `${NETWORKS[network].explorer}/attestation/view/${uid}`;
export const schemaUrl = (network, uid) => `${NETWORKS[network].explorer}/schema/view/${uid}`;
