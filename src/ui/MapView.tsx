import { useEffect, useRef, useState } from 'react';
import { FUEL_LIST } from '../sim/fuels';
import { slopeAspect } from '../sim/landscape';
import type { ProjectBoundary } from '../sim/reversal';
import type { Action, EnsembleResult, Hotspot, RunResult, Scenario } from '../sim/types';
import { drawMap, drawSavedLayer, type FireView } from './render';
import type { ZoneStatus } from './status';

export type Tool = 'inspect' | 'firebreak' | 'water' | 'crew' | 'inject' | 'wet' | 'ignite';

interface Props {
  title: string;
  subtitle: string;
  scn: Scenario;
  ens: EnsembleResult | null;
  t: number;
  view: FireView;
  sampleRun: RunResult | null;
  actions: Action[];
  ghost: Action[];
  hotspots?: Hotspot[];
  satellite?: HTMLCanvasElement | null;
  zoneLabels: { status: ZoneStatus; p: number; protectedZone: boolean }[];
  tool: Tool;
  interactive: boolean;
  busy?: boolean;
  onPlace?: (kind: Tool, a: [number, number], b?: [number, number]) => void;
  accent: 'base' | 'plan';
  showObserved?: boolean;
  /** No-action ensemble to compare against, so the area the plan saves is drawn and flashed. */
  savedFrom?: EnsembleResult | null;
  /** Changes when a new plan result lands; restarts the flash. */
  flashKey?: number;
  /** Carbon-project boundaries that overlap the map (drawn as dashed outlines). */
  boundaries?: ProjectBoundary[];
}

/** Dashed outlines of carbon-project boundaries over a geo-referenced map, with each project's name. */
function drawBoundaries(ctx: CanvasRenderingContext2D, size: number, scn: Scenario, bs: ProjectBoundary[]) {
  const g = scn.landscape.geo;
  if (!g || !bs.length) return;
  const P = (lon: number, lat: number): [number, number] => [((lon - g.west) / (g.east - g.west)) * size, ((g.north - lat) / (g.north - g.south)) * size];
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, size, size); ctx.clip();
  for (const b of bs) {
    ctx.beginPath();
    for (const poly of b.polygons) for (const ring of poly) ring.forEach(([lon, lat], i) => { const [x, y] = P(lon, lat); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'; ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'; ctx.stroke();
  }
  ctx.setLineDash([]);
  // Bottom right: the zone badges sit top left, the wind top right and the scale bar bottom left.
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  bs.forEach((b, i) => {
    const label = `VCS ${b.vcsId} boundary`;
    const w = ctx.measureText(label).width + 12;
    const y = size - 26 - i * 22;
    ctx.fillStyle = 'rgba(29, 29, 31, 0.78)'; ctx.fillRect(size - w - 8, y, w, 18);
    ctx.fillStyle = '#fff'; ctx.fillText(label, size - w - 2, y + 13);
  });
  ctx.restore();
}

export function MapView(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const saved = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(400);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ from: [number, number]; to: [number, number] } | null>(null);
  const l = p.scn.landscape;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(Math.max(240, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr; c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap(ctx, {
      size, scn: p.scn, ens: p.ens, t: p.t, view: p.view, sampleRun: p.sampleRun,
      actions: p.actions, ghost: p.ghost, hotspots: p.hotspots, satellite: p.satellite, showObserved: p.showObserved,
      zoneLabels: p.zoneLabels, hoverCell: p.interactive && p.tool !== 'inspect' ? hover : null, draft: drag,
    });
    if (p.boundaries?.length) drawBoundaries(ctx, size, p.scn, p.boundaries);
    const sc = saved.current;
    if (sc) {
      sc.width = size * dpr; sc.height = size * dpr;
      const sctx = sc.getContext('2d')!;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (p.savedFrom && p.ens && !p.busy) drawSavedLayer(sctx, size, p.scn, p.savedFrom, p.ens, p.t);
      else sctx.clearRect(0, 0, size, size);
    }
  });

  const cellAt = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    const x = Math.min(l.w - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * l.w)));
    const y = Math.min(l.h - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * l.h)));
    return [x, y];
  };

  const onDown = (e: React.PointerEvent) => {
    if (!p.interactive) return;
    const c = cellAt(e);
    if (p.tool === 'firebreak') { setDrag({ from: c, to: c }); (e.target as HTMLElement).setPointerCapture(e.pointerId); }
    else if (p.tool !== 'inspect') p.onPlace?.(p.tool, c);
  };
  const onMove = (e: React.PointerEvent) => {
    const c = cellAt(e);
    setHover({ x: c[0], y: c[1] });
    if (drag) setDrag({ ...drag, to: c });
  };
  const onUp = () => {
    if (drag) {
      if (Math.abs(drag.to[0] - drag.from[0]) + Math.abs(drag.to[1] - drag.from[1]) >= 2) p.onPlace?.('firebreak', drag.from, drag.to);
      setDrag(null);
    }
  };

  // Tooltip content for the hovered cell.
  let tip: React.ReactNode = null;
  if (hover && p.tool === 'inspect') {
    const k = hover.y * l.w + hover.x;
    const f = FUEL_LIST[l.fuel[k]];
    const { slope } = slopeAspect(l, hover.x, hover.y);
    let pb = 0, med: number | null = null;
    if (p.ens) {
      const times: number[] = [];
      for (const r of p.ens.runs) if (r.ign[k] >= 0) { if (r.ign[k] <= p.t) pb++; times.push(r.ign[k]); }
      pb /= p.ens.runs.length || 1;
      if (times.length * 2 >= p.ens.runs.length) { times.sort((a, b) => a - b); med = times[Math.floor(p.ens.runs.length / 2) - (p.ens.runs.length - times.length)] ?? null; }
    }
    const zone = l.zones[l.zoneOf[k]];
    let ll = '';
    if (l.geo) {
      const lat = l.geo.north - ((hover.y + 0.5) / l.h) * (l.geo.north - l.geo.south);
      const lon = l.geo.west + ((hover.x + 0.5) / l.w) * (l.geo.east - l.geo.west);
      ll = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    }
    tip = (
      <div className="tip" style={{ left: `${((hover.x + 1) / l.w) * 100}%`, top: `${((hover.y + 1) / l.h) * 100}%` }}>
        <b>{zone?.id ? `Zone ${zone.id}` : ''}</b> · {f.label}
        <div>{Math.round(l.elev[k])} m · {slope.toFixed(1)}° slope</div>
        {p.ens && <div>Burned by +{p.t} h in {Math.round(pb * 100)}% of runs</div>}
        {p.ens && <div>Median arrival: {med === null ? 'not reached in most runs' : med <= 0 ? 'already burning' : `+${med} h`}</div>}
        {ll && <div className="muted">{ll}</div>}
      </div>
    );
  }

  return (
    <figure className={`map map-${p.accent}`}>
      {p.title && (
        <figcaption>
          <span className="map-title">{p.title}</span>
          <span className="map-sub">{p.subtitle}</span>
          {p.busy && <span className="spinner" aria-label="simulating" />}
        </figcaption>
      )}
      <div className="canvas-wrap" ref={wrap} style={{ height: size }}>
        <canvas
          ref={canvas}
          style={{ width: size, height: size, cursor: p.interactive && p.tool !== 'inspect' ? 'crosshair' : 'default' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => { setHover(null); }}
          aria-label={`${p.title} map`}
          role="img"
        />
        {p.savedFrom && <canvas key={p.flashKey ?? 0} ref={saved} className="saved-layer" style={{ width: size, height: size }} aria-hidden />}
        {tip}
      </div>
    </figure>
  );
}
