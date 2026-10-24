import { useEffect, useRef, useState } from 'react';
import { fetchProjectFires, loadBoundary, loadProjectIndex, peatUnder, type ProjectFires, type ProjectIndex, type ProjectMeta } from '../data/carbonProjects';
import { FirmsKeyMissing } from '../data/firms';
import { fmtTonnes } from '../sim/carbon';
import type { Rates } from '../sim/doctrine';
import type { Scenario } from '../sim/types';
import { EVIDENCE_DISCLAIMER, buildEvidence, type EvidenceBundle } from '../sim/evidence';
import { bboxOverlap, expandBbox, monitorProject, type Detection, type ProjectBoundary, type ProjectReport, type ReversalStatus } from '../sim/reversal';

export const STATUS_TEXT: Record<ReversalStatus, string> = {
  inside: 'Fire inside',
  within1km: 'Fire within 1 km',
  within5km: 'Fire within 5 km',
  clear: 'No fire seen',
};

/** Boundaries of carbon projects that overlap a real (geo-referenced) scenario, for the main map. */
export function useProjectBoundaries(scn: Scenario): ProjectBoundary[] {
  const [bs, setBs] = useState<ProjectBoundary[]>([]);
  const g = scn.landscape.geo;
  useEffect(() => {
    setBs([]);
    if (!g) return;
    let live = true;
    const box: [number, number, number, number] = [g.west, g.south, g.east, g.north];
    loadProjectIndex()
      .then((ix) => Promise.all(ix.projects.filter((m) => bboxOverlap(m.bbox, box)).map(loadBoundary)))
      .then((xs) => { if (live) setBs(xs); })
      .catch(() => { /* the overlay is optional */ });
    return () => { live = false; };
  }, [g]);
  return bs;
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;
const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

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

export function StatusBadge({ status, label }: { status: ReversalStatus; label?: string }) {
  return <span className={`rv-badge rv-${status}`}>{label && <span className="rv-badge-k">{label}</span>}{STATUS_TEXT[status]}</span>;
}

/** The boundary with the 7-day detections: filled dots inside, rings outside, larger for the last 24 h. */
function ProjectMap({ b, fires, nowMs }: { b: ProjectBoundary; fires: Detection[]; nowMs: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = c.clientWidth || 320, H = Math.round(W * 0.62);
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr; c.style.height = `${H}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const box = expandBbox(b.bbox, 5500);
    const kx = Math.cos((((box[1] + box[3]) / 2) * Math.PI) / 180);
    const sx = (box[2] - box[0]) * kx, sy = box[3] - box[1];
    const s = Math.min(W / sx, H / sy) * 0.96;
    const ox = (W - sx * s) / 2, oy = (H - sy * s) / 2;
    const P = (lon: number, lat: number): [number, number] => [ox + (lon - box[0]) * kx * s, oy + (box[3] - lat) * s];
    const css = getComputedStyle(c);
    const ink = css.getPropertyValue('--ink').trim() || '#1d1d1f';
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    for (const poly of b.polygons) for (const ring of poly) ring.forEach(([lon, lat], i) => { const [x, y] = P(lon, lat); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.fillStyle = 'rgba(79, 107, 58, 0.16)';
    ctx.fill('evenodd');
    ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.stroke();
    for (const d of fires) {
      const t = Date.parse(d.acquired);
      if (t <= nowMs - 168 * 3.6e6 || t > nowMs) continue;
      const [x, y] = P(d.lon, d.lat);
      const recent = t > nowMs - 24 * 3.6e6;
      ctx.beginPath(); ctx.arc(x, y, recent ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = recent ? 'rgba(232, 74, 20, 0.95)' : 'rgba(150, 52, 24, 0.6)';
      ctx.fill();
    }
    // 5 km scale bar.
    const bar = 5000 / 111_320 * s;
    ctx.fillStyle = ink; ctx.fillRect(10, H - 12, bar, 2);
    ctx.font = '11px system-ui, sans-serif'; ctx.fillText('5 km', 10, H - 16);
  }, [b, fires, nowMs]);
  return <canvas ref={ref} className="rv-map" role="img" aria-label={`Boundary of ${b.name} with fire detections from the last 7 days`} />;
}

interface Row {
  meta: ProjectMeta;
  b?: ProjectBoundary;
  fires?: ProjectFires;
  report?: ProjectReport;
  peatNote?: string;
  error?: string;
  seal?: { state: 'sealing' | 'done'; bundle?: EvidenceBundle; stored?: string; notes: string[] };
}

function ProjectCard({ row, onSeal }: { row: Row; onSeal: () => void }) {
  const { meta, b, report, fires } = row;
  const o24 = report?.h24.observed, o7 = report?.d7.observed;
  const sealed = row.seal?.bundle;
  return (
    <li className="rv-card">
      <header className="rv-head">
        <div>
          <h3>{meta.name}</h3>
          <p className="muted small"><a href={meta.registryUrl} target="_blank" rel="noreferrer">VCS {meta.vcsId}</a> · {meta.province} · {meta.areaHa.toLocaleString('en-US')} ha as filed</p>
        </div>
      </header>
      {row.error && <p className="note">{row.error}</p>}
      {!row.error && !report && <p className="muted small"><span className="spinner" aria-hidden /> Reading 7 days of satellite passes…</p>}
      {report && b && fires && (
        <>
          <div className="rv-badges">
            <StatusBadge status={report.h24.status} label="24 h" />
            <StatusBadge status={report.d7.status} label="7 days" />
          </div>
          <ProjectMap b={b} fires={fires.detections} nowMs={report.nowMs} />
          <dl className="rv-facts">
            <dt>Detections, 24 h</dt><dd>{report.h24.counts.inside} inside · {report.h24.counts.within1km} within 1 km · {report.h24.counts.within5km} within 5 km</dd>
            <dt>Detections, 7 days</dt><dd>{report.d7.counts.inside} inside · {report.d7.counts.within1km} within 1 km · {report.d7.counts.within5km} within 5 km</dd>
            <dt>Seen burning inside</dt><dd>{o7 ? <>≈ {fmtTonnes(o7.tco2e)} t CO₂e in 7 days{o24 ? <>, {fmtTonnes(o24.tco2e)} t in 24 h</> : ''} ({Math.round(o7.peatShare * 100)}% on peat)</> : 'None in 7 days'}</dd>
          </dl>
          {report.d7.near.length > 0 && (
            <details className="more">
              <summary>Nearest detections</summary>
              <table className="table">
                <thead><tr><th>Seen (UTC)</th><th>Where</th><th>FRP</th></tr></thead>
                <tbody>
                  {report.d7.near.slice(0, 8).map((p, i) => (
                    <tr key={i}><td>{p.d.acquired.slice(5, 16).replace('T', ' ')}</td><td>{p.inside ? `inside, ${km(p.edgeM)} from edge` : `${km(p.outsideM)} outside`}</td><td>{p.d.frp.toFixed(1)} MW</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {row.peatNote && <p className="muted small">{row.peatNote}</p>}
          <button className={`btn wide ${sealed ? '' : 'primary'}`} disabled={row.seal?.state === 'sealing'} onClick={sealed ? () => save(`fireseptum-evidence-${meta.id}-${sealed.evidenceSha256.slice(0, 12)}.json`, JSON.stringify(sealed, null, 1), 'application/json') : onSeal}>
            {row.seal?.state === 'sealing' ? 'Sealing…' : sealed ? 'Download evidence JSON' : 'Seal evidence'}
          </button>
          {sealed && (
            <ul className="checks">
              <li className="check ok"><span className="check-mark" aria-hidden>✓</span><span><span className="check-label">Hashed</span> <code title={sealed.evidenceSha256}>{short(sealed.evidenceSha256)}</code></span></li>
              <li className={`check ${sealed.signature ? 'ok' : 'bad'}`}><span className="check-mark" aria-hidden>{sealed.signature ? '✓' : '✕'}</span><span><span className="check-label">{sealed.signature ? 'Signed' : 'Not signed'}</span>{sealed.signature && <span className="muted small"> key {sealed.signature.keyId} at {sealed.signature.signedAt.slice(0, 16).replace('T', ' ')} UTC</span>}</span></li>
              <li className={`check ${sealed.anchor ? 'ok' : 'bad'}`}><span className="check-mark" aria-hidden>{sealed.anchor ? '✓' : '✕'}</span><span><span className="check-label">{sealed.anchor ? 'Timestamp submitted' : 'Not timestamped'}</span>{sealed.anchor && <span className="muted small"> OpenTimestamps, pending a Bitcoin block</span>}</span></li>
              <li className={`check ${row.seal?.stored ? 'ok' : 'bad'}`}><span className="check-mark" aria-hidden>{row.seal?.stored ? '✓' : '✕'}</span><span><span className="check-label">{row.seal?.stored ? 'Stored' : 'Not stored here'}</span>{row.seal?.stored && <span className="muted small"> {row.seal.stored}</span>}</span></li>
            </ul>
          )}
          {row.seal?.notes.map((n, i) => <p key={i} className="muted small">{n}</p>)}
        </>
      )}
    </li>
  );
}

/**
 * Fire seen by satellite in and around peat carbon projects, as early, tamper-evident evidence of
 * a possible reversal. It reports observed fire only.
 */
export function CarbonProjectsPanel({ rates }: { rates: Rates }) {
  const [index, setIndex] = useState<ProjectIndex | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const update = (id: string, f: (r: Row) => Row) => setRows((rs) => rs.map((r) => (r.meta.id === id ? f(r) : r)));

  const check = async () => {
    setMsg(null);
    let ix: ProjectIndex;
    try { ix = await loadProjectIndex(); } catch (e) { setMsg(`Project boundaries could not be loaded: ${e instanceof Error ? e.message : e}`); return; }
    setIndex(ix);
    setRows(ix.projects.map((meta) => ({ meta })));
    const nowMs = Date.now();
    await Promise.all(ix.projects.map(async (meta) => {
      try {
        const b = await loadBoundary(meta);
        const fires = await fetchProjectFires(b, nowMs);
        // Peat under the detections inside, from the GFW peat map; peat when unreadable.
        const first = monitorProject(b, fires.detections, nowMs, rates);
        const inside = first.d7.near.filter((p) => p.inside).map((p) => p.d);
        let peatNote: string | undefined;
        let report = first;
        if (inside.length) {
          const pm = await peatUnder(inside);
          const isPeat = new Map(inside.map((d, i) => [d, pm.peat[i]]));
          report = monitorProject(b, fires.detections, nowMs, rates, (d) => isPeat.get(d) ?? true);
          const off = pm.peat.filter((x) => !x).length;
          peatNote = `Peat soil under detections inside: Global Forest Watch peatland map${off ? `; ${off} of ${inside.length} not on mapped peat, counted as tropical forest` : ''}${pm.unknown ? `; ${pm.unknown} unreadable, counted as peat` : ''}.`;
        }
        update(meta.id, (r) => ({ ...r, b, fires, report, peatNote }));
      } catch (e) {
        const error = e instanceof FirmsKeyMissing ? 'Needs a NASA FIRMS key (FIRMS_MAP_KEY in .env) to read satellite detections.' : `Could not check this project: ${e instanceof Error ? e.message : e}`;
        update(meta.id, (r) => ({ ...r, error }));
      }
    }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { check(); }, []);

  const seal = async (row: Row) => {
    if (!row.b || !row.report || !row.fires) return;
    const id = row.meta.id;
    update(id, (r) => ({ ...r, seal: { state: 'sealing', notes: [] } }));
    const notes: string[] = [];
    try {
      const bundle = await buildEvidence(row.b, row.report, {
        boundarySource: `${row.meta.source.registry}: ${row.meta.source.name} (document ${row.meta.source.documentId}), retrieved ${row.meta.retrieved}, simplified to ${index?.simplifiedM ?? 20} m`,
        firms: { products: row.fires.products, query: row.fires.query, fetchedAt: row.fires.fetchedAt },
        peat: row.peatNote ?? 'No detections inside the boundary.',
      });
      const h = bundle.evidenceSha256;
      try { bundle.signature = await post('/api/receipt/sign', { receiptSha256: h }); } catch (e) { notes.push(`Not signed: ${e instanceof Error ? e.message : e}`); }
      try { bundle.anchor = await post('/api/receipt/anchor', { receiptSha256: h }); } catch (e) { notes.push(`Not timestamped: ${e instanceof Error ? e.message : e}`); }
      let stored: string | undefined;
      try { stored = (await post<{ file: string }>('/api/evidence', { bundle })).file; } catch (e) { notes.push(`Not stored on this server (${e instanceof Error ? e.message : e}). Download the JSON to keep it.`); }
      update(id, (r) => ({ ...r, seal: { state: 'done', bundle, stored, notes } }));
    } catch (e) {
      update(id, (r) => ({ ...r, seal: { state: 'done', notes: [e instanceof Error ? e.message : String(e)] } }));
    }
  };

  return (
    <div className="carbon">
      <p className="note">Watches for fire that satellites see inside or near peat carbon projects (reversal risk), and seals what was seen so a buffer pool or insurer can check it later. This is observed fire only. It is not an estimate of avoided emissions, not a verification, and says nothing about a project&rsquo;s credits.</p>
      <div className="section-head rv-toolbar">
        <span className="muted small">NASA FIRMS VIIRS, last 24 h and 7 days, within 5 km of each boundary.</span>
        <button className="btn small" onClick={check}>Check again</button>
      </div>
      {msg && <p className="note">{msg}</p>}
      <ul className="rv-list">
        {rows.map((r) => <ProjectCard key={r.meta.id} row={r} onSeal={() => seal(r)} />)}
      </ul>
      <details className="more">
        <summary>Method and limits</summary>
        <p className="muted small">A detection counts as inside when its 375 m pixel centre falls inside the filed boundary; distances are to the nearest boundary edge. Emissions inside use the same fire-radiative-power method as the forecast&rsquo;s satellite number: each VIIRS pass held to the next one for at most 12 h, GFAS factors to dry matter, IPCC factors to CO₂e. {EVIDENCE_DISCLAIMER}</p>
      </details>
      {index && <p className="muted small rv-terms">{index.attribution} Retrieved {index.retrieved}. {index.terms}</p>}
    </div>
  );
}
