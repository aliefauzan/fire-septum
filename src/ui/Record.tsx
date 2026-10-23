import { useRef, useState } from 'react';
import { emissions, fmtTonnes } from '../sim/carbon';
import type { SimClient } from '../sim/client';
import {
  buildReceipt, canonical, checkRecord, decode, encode, engineLabel, fromB64, outputsDigest,
  type CheckResult, type RunInputs, type RunRecord,
} from '../sim/receipt';
import type { Action, EnsembleResult, Scenario, SimParams } from '../sim/types';

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;

function save(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function post<T>(path: string, body: object): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <li className={`check ${ok === null ? 'pending' : ok ? 'ok' : 'bad'}`}>
      <span className="check-mark" aria-hidden>{ok === null ? '…' : ok ? '✓' : '✕'}</span>
      <span><span className="check-label">{label}</span>{detail && <span className="muted small"> {detail}</span>}</span>
    </li>
  );
}

/**
 * Seal the current forecast and plan as a signed, timestamped record, and check
 * records (yours or someone else's) by re-running them.
 */
export function RecordPanel(p: {
  client: SimClient; scn: Scenario; actions: Action[]; params: SimParams;
  base: EnsembleResult | null; plan: EnsembleResult | null; busy: boolean;
  onOpen: (r: RunInputs) => void;
}) {
  const [rec, setRec] = useState<RunRecord | null>(null);
  const [checks, setChecks] = useState<CheckResult | null>(null);
  const [state, setState] = useState<'idle' | 'sealing' | 'anchoring' | 'checking'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const ready = !!p.base && !!p.plan && !p.busy;
  const name = rec ? `sekatapi-${rec.receiptSha256.slice(0, 12)}` : '';

  const seal = async () => {
    if (!p.base || !p.plan) return;
    setState('sealing'); setMsg(null); setChecks(null);
    try {
      const inputs: RunInputs = { scenario: p.scn, actions: p.actions, params: p.params, seeds: p.base.seeds };
      const em = emissions(p.scn.landscape, p.base, p.actions.length ? p.plan : null, p.params.rates, p.scn.horizonH);
      const { receipt, receiptSha256 } = await buildReceipt(inputs, p.base, p.plan, em, engineLabel());
      const r: RunRecord = { receipt, receiptSha256, inputs: encode(inputs) };
      try { r.signature = await post('/api/receipt/sign', { receiptSha256 }); }
      catch (e) { setMsg(`Not signed: ${e instanceof Error ? e.message : e}`); }
      setRec(r);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally { setState('idle'); }
  };

  const anchor = async () => {
    if (!rec) return;
    setState('anchoring'); setMsg(null);
    try {
      const a = await post<NonNullable<RunRecord['anchor']>>('/api/receipt/anchor', { receiptSha256: rec.receiptSha256 });
      setRec({ ...rec, anchor: a });
    } catch (e) {
      setMsg(`Timestamp failed: ${e instanceof Error ? e.message : e}`);
    } finally { setState('idle'); }
  };

  const check = async (r: RunRecord) => {
    setState('checking'); setMsg(null);
    try {
      const c = await checkRecord(r);
      setChecks(c);
      const inputs = decode<RunInputs>(r.inputs);
      const out = await p.client.rerun(inputs.scenario, inputs.actions, inputs.params);
      setChecks({ ...c, outputsHash: (await outputsDigest(out.base, out.plan)) === r.receipt.outputsSha256 });
    } catch (e) {
      setMsg(`Check failed: ${e instanceof Error ? e.message : e}`);
    } finally { setState('idle'); }
  };

  const openFile = async (f: File) => {
    try {
      const r = JSON.parse(await f.text()) as RunRecord;
      if (r.receipt?.kind !== 'sekatapi.run-receipt') throw new Error('Not a SekatApi record.');
      setRec(r);
      await check(r);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const res = rec?.receipt.results;
  return (
    <div className="record">
      <section className="section" aria-label="Seal">
        <header className="section-head">
          <h2>Record</h2>
          {state !== 'idle' && <span className="status"><span className="spinner" aria-hidden />{state === 'sealing' ? 'Sealing' : state === 'anchoring' ? 'Timestamping' : 'Re-running'}</span>}
        </header>
        <p className="muted small">Seal this forecast and plan so anyone can check later that it was not changed, and re-run it to get the same numbers.</p>
        <button className="btn primary wide" disabled={!ready || state !== 'idle'} onClick={seal}>Seal and sign</button>
      </section>

      {rec && res && (
        <section className="section" aria-label="Sealed record">
          <header className="section-head"><h2>{rec.receipt.scenario.title}</h2></header>
          <dl className="kv">
            <dt>Record</dt><dd><code title={rec.receiptSha256}>{short(rec.receiptSha256)}</code></dd>
            <dt>Inputs</dt><dd><code title={rec.receipt.inputsSha256}>{short(rec.receipt.inputsSha256)}</code></dd>
            <dt>Outputs</dt><dd><code title={rec.receipt.outputsSha256}>{short(rec.receipt.outputsSha256)}</code> · {rec.receipt.runs} runs</dd>
            <dt>Result</dt><dd>{res.burnedHa.plan} ha burned{rec.receipt.actions ? `, ${res.savedHa.mean} ha saved` : ''}{res.tco2e.avoided !== null ? `, ${fmtTonnes(res.tco2e.avoided)} t CO₂e less (model estimate)` : `, ${fmtTonnes(res.tco2e.base)} t CO₂e (model estimate)`}</dd>
            <dt>Signed</dt><dd>{rec.signature ? <>{new Date(rec.signature.signedAt).toLocaleString()} · key <code>{rec.signature.keyId}</code></> : 'No'}</dd>
            <dt>Bitcoin</dt><dd>{rec.anchor ? <>Submitted {new Date(rec.anchor.submittedAt).toLocaleString()}. Confirmed in a block within a few hours.</> : 'Not timestamped'}</dd>
          </dl>
          <div className="btn-row">
            {!rec.anchor && <button className="btn small" disabled={state !== 'idle'} onClick={anchor} title="Sends only the 64-character record hash to the public OpenTimestamps calendars.">Timestamp on Bitcoin</button>}
            <button className="btn small" disabled={state !== 'idle'} onClick={() => check(rec)}>Check by re-running</button>
            <button className="btn small" onClick={() => save(`${name}.json`, JSON.stringify(rec), 'application/json')}>Download</button>
            {rec.anchor && (
              <button className="btn small" onClick={() => { save(`${name}.receipt.json`, canonical(rec.receipt), 'application/json'); save(`${name}.receipt.json.ots`, fromB64(rec.anchor!.otsB64), 'application/octet-stream'); }} title="The exact receipt bytes and their OpenTimestamps proof, for `ots verify`.">
                Download proof
              </button>
            )}
            <button className="btn small plain" onClick={() => p.onOpen(decode<RunInputs>(rec.inputs))}>Open in map</button>
          </div>
        </section>
      )}

      {checks && (
        <section className="section" aria-label="Checks">
          <header className="section-head"><h2>Checks</h2></header>
          <ul className="checks">
            <Check ok={checks.receiptHash} label="Receipt unchanged" />
            <Check ok={checks.inputsHash} label="Inputs unchanged" detail="scenario, weather, fire, plan, rates, seeds" />
            <Check ok={checks.signature} label={checks.signature === null ? 'Not signed' : 'Signature valid'} detail={rec?.signature ? `key ${rec.signature.keyId}` : undefined} />
            <Check ok={checks.outputsHash} label="Re-run gives the same result" detail={checks.outputsHash === false ? `recorded on ${rec?.receipt.engine}; this is ${engineLabel()}` : undefined} />
          </ul>
        </section>
      )}

      <section className="section" aria-label="Open a record">
        <header className="section-head"><h2>Check a record</h2></header>
        <p className="muted small">Open a record file to check its hashes and signature and re-run it here.</p>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} />
        <button className="btn wide" disabled={state !== 'idle'} onClick={() => file.current?.click()}>Open record…</button>
        {msg && <p className="muted small" role="status">{msg}</p>}
      </section>
    </div>
  );
}
