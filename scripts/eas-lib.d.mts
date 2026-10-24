// Types for scripts/eas-lib.mjs (used by the tests).
type Hex = `0x${string}`;
type Network = 'base-sepolia' | 'base';
interface BatchLike { root: string; day: string; leaves: string[] }

export const EAS_ADDRESS: Hex;
export const SCHEMA_REGISTRY_ADDRESS: Hex;
export const ZERO_ADDRESS: Hex;
export const ZERO_BYTES32: Hex;
export const NETWORKS: Record<Network, { chainId: number; rpc: string; explorer: string; tx: string }>;
export const SCHEMA: string;
export const SCHEMA_RESOLVER: Hex;
export const SCHEMA_REVOCABLE: boolean;
export function schemaUid(schema?: string, resolver?: string, revocable?: boolean): Hex;
export const SCHEMA_REGISTRY_ABI: readonly unknown[];
export const EAS_ABI: readonly unknown[];
export function encodeBatchData(b: { root: string; day: string; records: number; uri: string }): Hex;
export function decodeBatchData(data: Hex): { root: string; day: string; records: number; uri: string };
export function attestCalldata(uid: Hex, batch: BatchLike, uri: string): Hex;
export function registerCalldata(): Hex;
export function decodeAttestCalldata(calldata: Hex): {
  schema: Hex; recipient: Hex; expirationTime: bigint; revocable: boolean; refUID: Hex; data: Hex; value: bigint;
  batch: { root: string; day: string; records: number; uri: string };
};
export function batchUri(day: string, base?: string): string;
export function attestationUrl(network: Network, uid: string): string;
export function schemaUrl(network: Network, uid: string): string;
