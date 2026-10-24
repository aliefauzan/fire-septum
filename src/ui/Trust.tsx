// Trust widgets shared by the Record tab and the forecast register: which daily batch holds a
// record (with its inclusion proof checked here), the batch root's OpenTimestamps and EAS
// status, and co-signatures by role.
import { useEffect, useRef, useState } from 'react';
import { loadBatches } from '../data/trust';
import { easList, findInclusion, otsStatus, utcDay, type Inclusion } from '../sim/batch';
import { cosign, generateRoleKey, parseRoleKey, withCosignature, type RoleKey } from '../sim/cosign';
import { rootPreimage } from '../sim/merkle';
import { COSIGN_ROLES, COSIGN_ROLE_LABEL, fromB64, verifyCosignature, type Cosignature, type CosignRole } from '../sim/receipt';

export function save(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;

export function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <li className={`check ${ok === null ? 'pending' : ok ? 'ok' : 'bad'}`}>
      <span className="check-mark" aria-hidden>{ok === null ? '…' : ok ? '✓' : '✕'}</span>
      <span><span className="check-label">{label}</span>{detail && <span className="muted small"> {detail}</span>}</span>
    </li>
  );
}

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Daily batch status of one record: the batch that includes it, its Merkle proof checked here
 * against the batch root, the root's OpenTimestamps proof and the EAS attestation, if any.
 */
export function BatchStatus({ hash, sealedAt, compact = false }: { hash: string; sealedAt?: string; compact?: boolean }) {
  const [inc, setInc] = useState<Inclusion | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setInc(undefined);
    loadBatches().then((bs) => findInclusion(bs, hash)).then((r) => { if (live) setInc(r); }).catch(() => { if (live) setInc(null); });
    return () => { live = false; };
  }, [hash]);

  if (inc === undefined) return compact ? null : <p className="muted small">Looking for this record in the daily batches…</p>;
  if (inc === null) {
    const day = sealedAt ? utcDay(sealedAt) : null;
    const text = `Not in a daily batch yet${day ? `: it goes into the batch for ${day} (UTC) or the next one sealed` : ''}.`;
    return compact ? <span className="row-sub">{text}</span> : <p className="muted small">{text} A batch is one Merkle root over a day's records, timestamped on Bitcoin and attested on Base.</p>;
  }
  const b = inc.batch;
  const ots = b.ots ? otsStatus(fromB64(b.ots.otsB64)) : null;
  const eas = easList(b);
  const otsText = !b.ots ? 'root not timestamped'
    : ots?.state === 'bitcoin' ? `root in Bitcoin block ${ots.height ?? ''}`.trim()
    : `root sent to OpenTimestamps ${fmt(b.ots.submittedAt)}, pending a Bitcoin block (ots upgrade)`;
  const downloadRoot = async () => {
    const name = `fireseptum-batch-${b.day}`;
    save(`${name}.root.bin`, (await rootPreimage(b.leaves)) as BlobPart, 'application/octet-stream');
    if (b.ots) save(`${name}.root.bin.ots`, fromB64(b.ots.otsB64) as BlobPart, 'application/octet-stream');
    save(`${name}.json`, JSON.stringify(b, null, 1), 'application/json');
  };

  if (compact) {
    return (
      <span className="row-sub">
        Batch {b.day} · proof {inc.proofOk ? '✓' : '✕'} · {ots?.state === 'bitcoin' ? 'root on Bitcoin' : b.ots ? 'root timestamp pending' : 'no timestamp'}
        {eas.map((e) => <span key={e.attestationUid}> · <a href={e.explorer} target="_blank" rel="noreferrer">EAS {e.network}</a></span>)}
      </span>
    );
  }
  return (
    <div className="batch">
      <ul className="checks">
        <Check ok={inc.proofOk} label={`In the daily batch of ${b.day}`} detail={`Merkle proof checked here against root ${short(b.root)} (${b.leaves.length} records)`} />
        <Check ok={ots ? ots.state === 'bitcoin' || null : false} label={ots?.state === 'bitcoin' ? 'Batch root timestamped on Bitcoin' : 'Batch root timestamp'} detail={otsText} />
        {eas.length
          ? eas.map((e) => <Check key={e.attestationUid} ok label={`Attested on ${e.network === 'base' ? 'Base' : 'Base Sepolia (testnet)'}`} detail={`${fmt(e.attestedAt)} · EAS ${short(e.attestationUid)}`} />)
          : <Check ok={null} label="Not attested on Base yet" detail="node scripts/attest.mjs" />}
      </ul>
      <div className="btn-row tight">
        {eas.map((e) => <a key={e.attestationUid} className="btn small plain" href={e.explorer} target="_blank" rel="noreferrer">View attestation</a>)}
        <button className="btn small plain" onClick={downloadRoot} title="The batch file, the bytes whose SHA-256 is the root, and the root's .ots proof (ots verify fireseptum-batch-<day>.root.bin.ots).">Download batch proof</button>
      </div>
    </div>
  );
}

// --- Co-signing keys in localStorage (this browser only).

const STORE = 'fireseptum.cosign-keys.v1';
function readKeys(): Partial<Record<CosignRole, RoleKey>> {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '{}'); } catch { return {}; }
}
function writeKeys(k: Partial<Record<CosignRole, RoleKey>>) {
  try { localStorage.setItem(STORE, JSON.stringify(k)); } catch { /* storage blocked: key lives for this session only */ }
}

/**
 * Co-signatures on a record, each verified here, and co-signing as a role with a key kept in
 * this browser. A co-signature attests "I saw and accept this record at this time", not that
 * the numbers are right.
 */
export function CoSign({ hash, cosignatures, onAdd }: { hash: string; cosignatures?: Cosignature[]; onAdd: (list: Cosignature[], added: Cosignature) => void | Promise<void> }) {
  const [keys, setKeys] = useState(readKeys);
  const [role, setRole] = useState<CosignRole>('commander');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [valid, setValid] = useState<boolean[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const list = cosignatures ?? [];
  const key = keys[role];

  useEffect(() => {
    let live = true;
    Promise.all((cosignatures ?? []).map((c) => verifyCosignature(hash, c))).then((v) => { if (live) setValid(v); });
    return () => { live = false; };
  }, [hash, cosignatures]);

  const setKey = (k: RoleKey | undefined) => {
    const next = { ...keys, [role]: k };
    if (!k) delete next[role];
    setKeys(next); writeKeys(next);
  };
  const run = async (f: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await f(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const create = () => run(async () => { setKey(await generateRoleKey(role, name)); setName(''); });
  const sign = () => run(async () => {
    if (!key) return;
    const c = await cosign(key, hash);
    await onAdd(withCosignature(list, c), c);
  });
  const importKey = (f: File) => run(async () => {
    const k = await parseRoleKey(JSON.parse(await f.text()));
    setRole(k.role);
    const next = { ...keys, [k.role]: k };
    setKeys(next); writeKeys(next);
  });

  return (
    <div className="cosign">
      <h3 className="sub-head">Co-signatures</h3>
      <p className="muted small">
        A co-signature says <i>"I saw and accept this record at this time"</i>, signed with a key kept in the signer's browser.
        It does not say the numbers are right; re-running checks those. Names are as the signer typed them.
      </p>
      {list.length > 0 && (
        <ul className="checks">
          {list.map((c, i) => (
            <Check key={`${c.keyId}-${c.role}`} ok={valid[i] ?? null} label={`${COSIGN_ROLE_LABEL[c.role] ?? c.role}: ${c.name}`} detail={`${fmt(c.signedAt)} · key ${c.keyId}`} />
          ))}
        </ul>
      )}
      <div className="cosign-form">
        <label className="inv"><span>Role</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as CosignRole)}>
            {COSIGN_ROLES.map((r) => <option key={r} value={r}>{COSIGN_ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        {key ? (
          <div className="btn-row tight">
            <button className="btn small primary" disabled={busy || list.some((c) => c.keyId === key.keyId && c.role === role)} onClick={sign}>Co-sign as {key.name}</button>
            <button className="btn small plain" onClick={() => save(`fireseptum-key-${role}-${key.keyId}.json`, JSON.stringify(key, null, 1), 'application/json')} title="Contains the private key. Keep it safe; anyone with this file can co-sign as you.">Export key</button>
            <button className="btn small plain" onClick={() => { if (confirm(`Remove the ${COSIGN_ROLE_LABEL[role]} key of ${key.name} from this browser? Export it first to keep it.`)) setKey(undefined); }}>Remove key</button>
          </div>
        ) : (
          <div className="cosign-new">
            <label className="inv"><span>Your name</span><input className="num" value={name} maxLength={80} placeholder="e.g. Budi S., Daops Manggala Agni" onChange={(e) => setName(e.target.value)} /></label>
            <div className="btn-row tight">
              <button className="btn small" disabled={busy || !name.trim()} onClick={create}>Create key</button>
              <button className="btn small plain" disabled={busy} onClick={() => file.current?.click()}>Import key file…</button>
            </div>
          </div>
        )}
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importKey(f); e.target.value = ''; }} />
      </div>
      {key && <p className="muted small">Key {key.keyId}, made {fmt(key.createdAt)}, stored in this browser only.</p>}
      {msg && <p className="note small" role="status">{msg}</p>}
    </div>
  );
}
