import { useEffect, useRef, useState } from 'react';
import { storeCosignature, storeDecision } from '../data/trust';
import { emissions, fmtTonnes } from '../sim/carbon';
import { observedEmissions, scenarioNow } from '../sim/frp';
import type { SimClient } from '../sim/client';
import { alternativesOf, buildDecision, checkDecision, isDecisionRecord, type Alternative, type DecisionCheck, type DecisionChoice, type DecisionRecord } from '../sim/decision';
import {
  COSIGN_ROLES, COSIGN_ROLE_LABEL, DECISION_SIGNATURE_SCHEME, buildReceipt, canonical, checkRecord, decode, encode, engineLabel, fromB64, isRunRecord, outputsDigest,
  type CheckResult, type Cosignature, type CosignRole, type RunInputs, type RunRecord,
} from '../sim/receipt';
import type { Recommendation } from '../sim/recommend';
import type { Inventory } from '../sim/resources';
import type { Action, EnsembleResult, Scenario, SimParams } from '../sim/types';
import { reducedMotion, useTypewriter } from './motion';
import { BatchStatus, Check, CoSign, save, short } from './Trust';

async function post<T>(path: string, body: object): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

const SEAL_STEPS = ['Hash the inputs: fire, weather, terrain, plan, rates, seeds', 'Hash the outputs: all 40 runs', 'Sign the receipt (Ed25519)', 'Sealed'];
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, reducedMotion() ? 0 : ms));

/** The sealing steps, ticked off one by one so what "seal" means is seen, not just named. */
function SealSteps({ stage }: { stage: number }) {
  return (
    <ol className="seal-steps" aria-label="Sealing">
      {SEAL_STEPS.slice(0, Math.min(SEAL_STEPS.length, stage + 1)).map((label, i) => (
        <li key={label} className={`seal-step ${i < stage ? 'done' : 'active'}`}>
          <span className="check-mark" aria-hidden>{i < stage ? '✓' : i + 1}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** A hash written out character by character, then shown whole. */
function Hash({ value }: { value: string }) {
  const shown = useTypewriter(value, 12);
  return <code className="hash" title={value}>{shown}{shown.length < value.length && <span className="caret" aria-hidden />}</code>;
}

/**
 * Seal the current forecast and plan as a signed, timestamped record, and check
 * records (yours or someone else's) by re-running them.
 */
export function RecordPanel(p: {
  client: SimClient; scn: Scenario; actions: Action[]; params: SimParams;
  base: EnsembleResult | null; plan: EnsembleResult | null; busy: boolean;
  /** What the recommender currently shows and the entered inventory (for decision records). */
  recommendations: Recommendation[]; inventory: Inventory;
  onOpen: (r: RunInputs) => void;
}) {
  const [rec, setRec] = useState<RunRecord | null>(null);
  const [checks, setChecks] = useState<CheckResult | null>(null);
  const [state, setState] = useState<'idle' | 'sealing' | 'anchoring' | 'checking'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const [stage, setStage] = useState(-1);
  const [dec, setDec] = useState<DecisionRecord | null>(null);
  const file = useRef<HTMLInputElement>(null);
  // Tick the steps while the (fast) sealing runs, so each one is visible for a moment.
  useEffect(() => {
    if (state !== 'sealing') return;
    setStage(0);
    let i = 0;
    const id = window.setInterval(() => { i = Math.min(SEAL_STEPS.length - 2, i + 1); setStage(i); }, reducedMotion() ? 1 : 450);
    return () => window.clearInterval(id);
  }, [state]);
  const ready = !!p.base && !!p.plan && !p.busy;
  const name = rec ? `fireseptum-${rec.receiptSha256.slice(0, 12)}` : '';

  const seal = async () => {
    if (!p.base || !p.plan) return;
    setState('sealing'); setMsg(null); setChecks(null);
    try {
      const inputs: RunInputs = { scenario: p.scn, actions: p.actions, params: p.params, seeds: p.base.seeds };
      const em = emissions(p.scn.landscape, p.base, p.actions.length ? p.plan : null, p.params.rates, p.scn.horizonH);
      const started = performance.now();
      const obs = observedEmissions(p.scn.landscape, p.scn.hotspots ?? [], scenarioNow(p.scn), p.params.rates);
      const { receipt, receiptSha256 } = await buildReceipt(inputs, p.base, p.plan, em, engineLabel(), obs);
      const r: RunRecord = { receipt, receiptSha256, inputs: encode(inputs) };
      try { r.signature = await post('/api/receipt/sign', { receiptSha256 }); }
      catch (e) { setMsg(`Not signed: ${e instanceof Error ? e.message : e}`); }
      // Let every step be seen before the sealed record replaces them.
      await wait(Math.max(0, 450 * (SEAL_STEPS.length - 1) - (performance.now() - started)));
      setStage(SEAL_STEPS.length);
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
      const r = JSON.parse(await f.text()) as unknown;
      if (isDecisionRecord(r)) { setDec(r); return; }
      if (!isRunRecord(r)) throw new Error('Not a Fire Septum record.');
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
        {state === 'sealing' && <SealSteps stage={stage} />}
      </section>

      {rec && res && (
        <section className="section" aria-label="Sealed record">
          <header className="section-head"><h2>{rec.receipt.scenario.title}</h2></header>
          <div className={`sealed-badge ${rec.anchor ? 'anchored' : ''}`} role="status">
            <span className="lock" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
            </span>
            <span>
              <b>{rec.anchor ? 'Timestamped on Bitcoin' : rec.signature ? 'Sealed and signed' : 'Sealed'}</b>
              {rec.anchor
                ? <>Only the 64-character hash left this machine, via OpenTimestamps. Confirmed in a block within a few hours; then it cannot be backdated.</>
                : <>Change one byte of the inputs and the hash below changes. Timestamp it so the date cannot be disputed either.</>}
            </span>
          </div>
          <dl className="kv">
            <dt>Record</dt><dd><Hash value={rec.receiptSha256} /></dd>
            <dt>Inputs</dt><dd><code title={rec.receipt.inputsSha256}>{short(rec.receipt.inputsSha256)}</code></dd>
            <dt>Outputs</dt><dd><code title={rec.receipt.outputsSha256}>{short(rec.receipt.outputsSha256)}</code> · {rec.receipt.runs} runs</dd>
            <dt>Result</dt><dd>{res.burnedHa.plan} ha burned{rec.receipt.actions ? `, ${res.savedHa.mean} ha saved` : ''}{res.tco2e.avoided !== null ? `, ${fmtTonnes(res.tco2e.avoided)} t CO₂e less (model estimate)` : `, ${fmtTonnes(res.tco2e.base)} t CO₂e (model estimate)`}{res.observed ? `; satellites had seen ≈ ${fmtTonnes(res.observed.tco2e)} t CO₂e in the ${res.observed.windowH} h before` : ''}</dd>
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
          <h3 className="sub-head">Daily batch</h3>
          <BatchStatus hash={rec.receiptSha256} sealedAt={rec.receipt.createdAt} />
          <CoSign hash={rec.receiptSha256} cosignatures={rec.cosignatures} onAdd={(cosignatures) => setRec({ ...rec, cosignatures })} />
        </section>
      )}

      {rec && (
        <DecisionSection
          key={rec.receiptSha256} rec={rec} dec={dec && dec.decision.planReceiptSha256 === rec.receiptSha256 ? dec : null} setDec={setDec}
          recommendations={rec.receipt.scenario.id === p.scn.id ? p.recommendations : []} inventory={p.inventory}
        />
      )}
      {dec && (!rec || dec.decision.planReceiptSha256 !== rec.receiptSha256) && <DecisionView dec={dec} setDec={setDec} />}

      {checks && (
        <section className="section" aria-label="Checks">
          <header className="section-head"><h2>Checks</h2></header>
          <ul className="checks">
            <Check ok={checks.receiptHash} label="Receipt unchanged" />
            <Check ok={checks.inputsHash} label="Inputs unchanged" detail="scenario, weather, fire, plan, rates, seeds" />
            <Check ok={checks.signature} label={checks.signature === null ? 'Not signed' : 'Signature valid'} detail={rec?.signature ? `key ${rec.signature.keyId}` : undefined} />
            {checks.cosignatures.length > 0 && <Check ok={checks.cosignatures.every((c) => c.ok)} label={`${checks.cosignatures.filter((c) => c.ok).length} of ${checks.cosignatures.length} co-signatures valid`} detail={checks.cosignatures.map((c) => c.role).join(', ')} />}
            <Check ok={checks.outputsHash} label="Re-run gives the same result" detail={checks.outputsHash === false ? `recorded on ${rec?.receipt.engine}; this is ${engineLabel()}` : undefined} />
          </ul>
        </section>
      )}

      <section className="section" aria-label="Open a record">
        <header className="section-head"><h2>Check a record</h2></header>
        <p className="muted small">Open a run record or a decision record to check its hashes, signatures and daily batch, and re-run it here.</p>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} />
        <button className="btn wide" disabled={state !== 'idle'} onClick={() => file.current?.click()}>Open record…</button>
        {msg && <p className="muted small" role="status">{msg}</p>}
      </section>
    </div>
  );
}

const DECISIONS: { id: DecisionChoice; label: string }[] = [
  { id: 'adopt-plan', label: 'Adopt this plan' },
  { id: 'no-action', label: 'No action' },
  { id: 'other', label: 'Other (say what in the note)' },
];
const hhmm = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function autoSummary(choice: DecisionChoice, rec: RunRecord, adopted: string[], at: Date): string {
  if (choice === 'no-action') return `No action taken at ${hhmm(at)}`;
  if (choice === 'other') return `Decision taken at ${hhmm(at)}`;
  const what = adopted.length ? `${adopted[0]}${adopted.length > 1 ? ` + ${adopted.length - 1} more` : ''}` : `Plan of ${rec.receipt.actions} action${rec.receipt.actions === 1 ? '' : 's'}`;
  return `${what} chosen at ${hhmm(at)}`;
}

function invText(i: Inventory) {
  const n = (v: number | null) => (v === null ? '?' : String(v));
  return `${n(i.helicopters)} helicopters, ${n(i.crews)} crews, ${n(i.dozers)} dozers, ${n(i.aircraft)} aircraft (${i.source})`;
}

/**
 * Seal the decision taken on this record: what was chosen, by which role, on which forecast,
 * among which alternatives, with which resources. Signed, timestamped, co-signable.
 */
function DecisionSection(p: {
  rec: RunRecord; dec: DecisionRecord | null; setDec: (d: DecisionRecord | null) => void;
  recommendations: Recommendation[]; inventory: Inventory;
}) {
  const [choice, setChoice] = useState<DecisionChoice>(p.rec.receipt.actions ? 'adopt-plan' : 'no-action');
  const [summary, setSummary] = useState('');
  const [role, setRole] = useState<CosignRole>('commander');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Actions are plain JSON in the encoded inputs; no need to decode the whole scenario.
  const planIds = ((p.rec.inputs as { actions?: Action[] }).actions ?? []).map((a) => a.id);
  const alternatives = alternativesOf(p.recommendations, choice === 'adopt-plan' ? planIds : []);
  const adopted = alternatives.filter((a) => a.adopted).map((a) => a.title);

  if (p.dec) return <DecisionView dec={p.dec} setDec={p.setDec} note={msg} />;

  const sealDecision = async () => {
    setBusy(true); setMsg(null);
    const notes: string[] = [];
    try {
      const at = new Date();
      const r = p.rec.receipt;
      const { decision, decisionSha256 } = await buildDecision({
        decidedAt: at.toISOString(), decision: choice, summary: summary.trim() || autoSummary(choice, p.rec, adopted, at),
        planReceiptSha256: p.rec.receiptSha256,
        forecast: { scenarioId: r.scenario.id, title: r.scenario.title, provenance: r.scenario.provenance, inputsSha256: r.inputsSha256, outputsSha256: r.outputsSha256, actions: r.actions },
        alternatives, inventory: p.inventory, note, role,
      });
      const d: DecisionRecord = { decision, decisionSha256 };
      try { d.signature = await post('/api/receipt/sign', { receiptSha256: decisionSha256, scheme: DECISION_SIGNATURE_SCHEME }); }
      catch (e) { notes.push(`Not signed: ${e instanceof Error ? e.message : e}.`); }
      try { d.anchor = await post('/api/receipt/anchor', { receiptSha256: decisionSha256 }); }
      catch (e) { notes.push(`Not timestamped: ${e instanceof Error ? e.message : e}.`); }
      try { const s = await storeDecision(d); notes.push(`Stored as ${s.file}.`); }
      catch (e) { notes.push(`Not stored: ${e instanceof Error ? e.message : e} Download it to keep it.`); }
      setMsg(notes.join(' '));
      p.setDec(d);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <section className="section" aria-label="Decision">
      <header className="section-head"><h2>Decision</h2>{busy && <span className="status"><span className="spinner" aria-hidden />Sealing</span>}</header>
      <p className="muted small">Seal what was decided on this record, by whom and when, with the alternatives on screen now. It is hashed, signed, timestamped on Bitcoin and can be co-signed.</p>
      <div className="decision-form">
        <label className="inv"><span>Decision</span>
          <select className="select" value={choice} onChange={(e) => setChoice(e.target.value as DecisionChoice)}>
            {DECISIONS.map((d) => <option key={d.id} value={d.id} disabled={d.id === 'adopt-plan' && !p.rec.receipt.actions}>{d.label}</option>)}
          </select>
        </label>
        <label className="inv"><span>Summary</span><input className="num" value={summary} maxLength={200} placeholder={autoSummary(choice, p.rec, adopted, new Date())} onChange={(e) => setSummary(e.target.value)} /></label>
        <label className="inv"><span>Decided by</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as CosignRole)}>
            {COSIGN_ROLES.map((r) => <option key={r} value={r}>{COSIGN_ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        <label className="inv"><span>Note</span><textarea className="num" value={note} maxLength={2000} placeholder="Why this, what was ruled out, when to revisit" onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {alternatives.length > 0
        ? <><h3 className="sub-head">Options the recommender shows now</h3><Alternatives list={alternatives} /></>
        : <p className="muted small">No recommendations on screen for this record; the decision is sealed without alternatives.</p>}
      <p className="muted small">Resources entered: {invText(p.inventory)}</p>
      <button className="btn primary wide" disabled={busy} onClick={sealDecision}>Seal this decision</button>
      {msg && <p className="note small" role="status">{msg}</p>}
    </section>
  );
}

function Alternatives({ list }: { list: Alternative[] }) {
  return (
    <ol className="alts" aria-label="Alternatives considered">
      {list.map((a) => (
        <li key={`${a.rank}-${a.title}`} className={a.adopted ? 'adopted' : ''}>
          <span aria-label={a.adopted ? 'adopted' : `rank ${a.rank}`}>{a.adopted ? '✓' : a.rank}</span>
          <span>{a.title}</span>
          <span className="muted">{a.savedHa.mean} ha saved ({a.savedHa.p10}–{a.savedHa.p90})</span>
        </li>
      ))}
    </ol>
  );
}

/** A sealed decision record: its content, checks, daily batch and co-signatures. */
function DecisionView({ dec, setDec, note }: { dec: DecisionRecord; setDec: (d: DecisionRecord | null) => void; note?: string | null }) {
  const [checks, setChecks] = useState<DecisionCheck | null>(null);
  const [msg, setMsg] = useState<string | null>(note ?? null);
  useEffect(() => {
    let live = true;
    checkDecision(dec).then((c) => { if (live) setChecks(c); });
    return () => { live = false; };
  }, [dec]);
  const d = dec.decision;
  const name = `fireseptum-decision-${dec.decisionSha256.slice(0, 12)}`;
  const addCosig = async (cosignatures: Cosignature[], added: Cosignature) => {
    setDec({ ...dec, cosignatures });
    try { await storeCosignature(dec.decisionSha256, added); setMsg('Co-signature added to the stored decision.'); }
    catch (e) { setMsg(`Co-signed here, not in a stored copy (${e instanceof Error ? e.message : e}). Download the record to keep it.`); }
  };
  return (
    <section className="section" aria-label="Sealed decision">
      <header className="section-head"><h2>Decision</h2></header>
      <div className={`sealed-badge ${dec.anchor ? 'anchored' : ''}`} role="status">
        <span><b>{d.summary}</b>{COSIGN_ROLE_LABEL[d.role]} · {new Date(d.decidedAt).toLocaleString()}</span>
      </div>
      <dl className="kv">
        <dt>Decision</dt><dd><code title={dec.decisionSha256}>{short(dec.decisionSha256)}</code> · {DECISIONS.find((x) => x.id === d.decision)?.label ?? d.decision}</dd>
        <dt>Plan record</dt><dd><code title={d.planReceiptSha256}>{short(d.planReceiptSha256)}</code> · {d.forecast.actions} action{d.forecast.actions === 1 ? '' : 's'}</dd>
        <dt>Forecast</dt><dd>{d.forecast.title} · inputs <code title={d.forecast.inputsSha256}>{short(d.forecast.inputsSha256)}</code></dd>
        <dt>Resources</dt><dd>{invText(d.inventory)}</dd>
        {d.note && <><dt>Note</dt><dd>{d.note}</dd></>}
        <dt>Signed</dt><dd>{dec.signature ? <>{new Date(dec.signature.signedAt).toLocaleString()} · key <code>{dec.signature.keyId}</code></> : 'No'}</dd>
        <dt>Bitcoin</dt><dd>{dec.anchor ? <>Submitted {new Date(dec.anchor.submittedAt).toLocaleString()}. Confirmed in a block within a few hours.</> : 'Not timestamped'}</dd>
      </dl>
      {d.alternatives.length > 0 && <><h3 className="sub-head">Options the recommender showed</h3><Alternatives list={d.alternatives} /></>}
      {checks && (
        <ul className="checks decision-checks">
          <Check ok={checks.hash} label="Decision unchanged" />
          <Check ok={checks.signature} label={checks.signature === null ? 'Not signed' : 'Signature valid'} detail={dec.signature ? `key ${dec.signature.keyId}` : undefined} />
        </ul>
      )}
      <div className="btn-row">
        <button className="btn small" onClick={() => save(`${name}.json`, JSON.stringify(dec), 'application/json')}>Download</button>
        {dec.anchor && (
          <button className="btn small" onClick={() => { save(`${name}.decision.json`, canonical(dec.decision), 'application/json'); save(`${name}.decision.json.ots`, fromB64(dec.anchor!.otsB64), 'application/octet-stream'); }} title="The exact decision bytes and their OpenTimestamps proof, for `ots verify`.">Download proof</button>
        )}
        <button className="btn small plain" onClick={() => setDec(null)}>Close</button>
      </div>
      <h3 className="sub-head">Daily batch</h3>
      <BatchStatus hash={dec.decisionSha256} sealedAt={d.decidedAt} />
      <CoSign hash={dec.decisionSha256} cosignatures={dec.cosignatures} onAdd={addCosig} />
      {msg && <p className="note small" role="status">{msg}</p>}
    </section>
  );
}
