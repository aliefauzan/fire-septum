// Co-signing keys: one Ed25519 key pair per role, made and kept in the signer's own browser.
//
// The server's signature says which Fire Septum instance issued a record. A co-signature says
// that a named person, acting in a role (forecaster, incident commander, BPBD), saw the record
// and accepted it at a given time. Neither says the numbers are right: re-running does that.
import {
  COSIGN_ROLES, COSIGN_SCHEME, cosignMessage, fromB64, sha256Hex, toB64,
  type Cosignature, type CosignRole,
} from './receipt';

export const KEY_FILE_KIND = 'fireseptum.cosign-key';

/** A role key as stored in localStorage and in an exported key file. Holds the PRIVATE key. */
export interface RoleKey {
  v: 1;
  kind: typeof KEY_FILE_KIND;
  role: CosignRole;
  name: string;
  /** Raw 32-byte public key, base64. */
  publicKey: string;
  keyId: string;
  createdAt: string;
  privateJwk: JsonWebKey;
}

const keyIdOf = async (pub: Uint8Array) => (await sha256Hex(pub)).slice(0, 16);

export async function generateRoleKey(role: CosignRole, name: string): Promise<RoleKey> {
  if (!COSIGN_ROLES.includes(role)) throw new Error(`unknown role ${role}`);
  const clean = name.trim();
  if (!clean) throw new Error('A co-signing key needs a display name.');
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { v: 1, kind: KEY_FILE_KIND, role, name: clean.slice(0, 80), publicKey: toB64(pub), keyId: await keyIdOf(pub), createdAt: new Date().toISOString(), privateJwk };
}

/** Parse and check an imported key file: the private key must match the stated public key. */
export async function parseRoleKey(json: unknown): Promise<RoleKey> {
  const k = json as Partial<RoleKey> | null;
  if (!k || k.kind !== KEY_FILE_KIND || k.v !== 1 || !k.role || !COSIGN_ROLES.includes(k.role) || !k.privateJwk || !k.publicKey || !k.name) throw new Error('Not a Fire Septum co-signing key file.');
  const pub = fromB64(k.publicKey);
  if (k.privateJwk.x !== toB64url(pub)) throw new Error('The key file is inconsistent: its private key does not match its public key.');
  if ((await keyIdOf(pub)) !== k.keyId) throw new Error('The key file is inconsistent: wrong key id.');
  await importPrivate(k.privateJwk);
  return k as RoleKey;
}

const toB64url = (u: Uint8Array) => toB64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const importPrivate = (jwk: JsonWebKey) => crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);

/** Co-sign a record hash as this key's role. */
export async function cosign(key: RoleKey, recordSha256: string, signedAt = new Date().toISOString()): Promise<Cosignature> {
  if (!/^[0-9a-f]{64}$/.test(recordSha256)) throw new Error('record hash must be 64 lowercase hex digits');
  const priv = await importPrivate(key.privateJwk);
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', priv, new TextEncoder().encode(cosignMessage(recordSha256, key.role, signedAt)) as BufferSource));
  return { role: key.role, name: key.name, alg: 'Ed25519', publicKey: key.publicKey, keyId: key.keyId, signedAt, scheme: COSIGN_SCHEME, sig: toB64(sig) };
}

/** Add a co-signature unless the same key already co-signed in the same role. */
export function withCosignature(list: Cosignature[] | undefined, c: Cosignature): Cosignature[] {
  const cur = list ?? [];
  return cur.some((x) => x.keyId === c.keyId && x.role === c.role) ? cur : [...cur, c];
}
