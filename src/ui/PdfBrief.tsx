import { useRef, useState } from 'react';
import { observedEmissions, scenarioNow } from '../sim/frp';
import type { RecommendOutput } from '../sim/recommend';
import type { Inventory } from '../sim/resources';
import type { Action, EnsembleResult, Scenario, SimParams } from '../sim/types';
import type { Lang, SealedInfo } from './briefPdf';

/**
 * The map as shown, as a PNG: the forecast canvas with the "saved by the plan" layer on top.
 * Uses the right-hand map ("with your plan", or the only map before there is a plan).
 */
function captureMap(): string | null {
  const wrap = document.querySelector('.map-plan .canvas-wrap');
  const layers = wrap ? [...wrap.querySelectorAll('canvas')] : [];
  if (!layers.length) return null;
  try {
    const W = Math.min(1200, layers[0].width);
    const c = document.createElement('canvas');
    c.width = W; c.height = W;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, W);
    for (const l of layers) if (l.width && l.height) ctx.drawImage(l, 0, 0, W, W);
    return c.toDataURL('image/png');
  } catch {
    return null; // a tainted or WebGL canvas without a kept buffer
  }
}

const LABEL = {
  en: { btn: 'Download PDF brief', busy: 'Making PDF…', note: 'One A4 page for sharing: map, zone risk, top actions, resources, emissions and the record hash. Made in this browser; nothing is uploaded.', attach: 'Add a sealed record', attached: 'Record attached', clear: 'Remove' },
  id: { btn: 'Unduh ringkasan PDF', busy: 'Membuat PDF…', note: 'Satu halaman A4 untuk dibagikan: peta, risiko zona, tindakan utama, sumber daya, emisi dan hash rekaman. Dibuat di peramban ini; tidak ada yang diunggah.', attach: 'Lampirkan rekaman tersegel', attached: 'Rekaman terlampir', clear: 'Hapus' },
};

/** "Download PDF brief": a one-page A4 PDF built locally with jsPDF (loaded on first use). */
export function PdfBriefButton(p: {
  lang: Lang; scn: Scenario; base: EnsembleResult | null; plan: EnsembleResult | null; rec: RecommendOutput | null;
  actions: Action[]; params: SimParams; inventory: Inventory; mapCaption: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sealed, setSealed] = useState<(SealedInfo & { scenarioId: string }) | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const L = LABEL[p.lang];

  // A record downloaded from the Record tab: its hash and timestamp status go on the page.
  const attach = async (f: File) => {
    setErr(null);
    try {
      const r = JSON.parse(await f.text());
      const h = String(r?.receiptSha256 ?? '');
      if (!/^[0-9a-f]{64}$/.test(h) || !r.receipt) throw new Error('not a Fire Septum record');
      setSealed({ receiptSha256: h, signedAt: r.signature?.signedAt, keyId: r.signature?.keyId, anchored: !!r.anchor, calendar: r.anchor?.calendar, matches: true, scenarioId: String(r.receipt?.scenario?.id ?? '') });
    } catch (e) {
      setErr(`${e instanceof Error ? e.message : e}`);
    }
  };

  const make = async () => {
    if (!p.base) return;
    setBusy(true); setErr(null);
    try {
      const { briefPdfData, buildBriefPdf, briefFileName } = await import('./briefPdf');
      const png = captureMap();
      const hasPlan = p.actions.length > 0;
      const d = briefPdfData({
        lang: p.lang, scn: p.scn, base: p.base, plan: p.plan, hasPlan, actions: p.actions.length, rec: p.rec, params: p.params, inventory: p.inventory,
        observed: observedEmissions(p.scn.landscape, p.scn.hotspots ?? [], scenarioNow(p.scn), p.params.rates),
        sealed: sealed ? { ...sealed, matches: !sealed.scenarioId || sealed.scenarioId === p.scn.id } : null,
        map: png ? { png, caption: p.mapCaption } : null,
      });
      buildBriefPdf(d).save(briefFileName(d));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="pdf-row">
      <button className="btn wide" disabled={busy || !p.base} onClick={make}>{busy ? L.busy : L.btn}</button>
      <p className="muted small">{L.note}</p>
      <div className="btn-row">
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = ''; }} />
        {sealed
          ? <span className="muted small">{L.attached}: <code>{sealed.receiptSha256.slice(0, 12)}…</code> <button className="btn plain small" onClick={() => setSealed(null)}>{L.clear}</button></span>
          : <button className="btn small" onClick={() => file.current?.click()}>{L.attach}</button>}
      </div>
      {err && <p className="note">{err}</p>}
    </div>
  );
}
