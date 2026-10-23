import { FUEL_LIST } from '../sim/fuels';
import { slopeAspect } from '../sim/landscape';
import { actionDurationH, lineCells, weatherAt } from '../sim/model';
import type { Action, EnsembleResult, Hotspot, RunResult, Scenario } from '../sim/types';
import type { ZoneStatus } from './status';

export type FireView = 'probability' | 'sample';

export interface DrawOptions {
  size: number; // CSS px of the square map
  scn: Scenario;
  ens: EnsembleResult | null;
  t: number;
  view: FireView;
  sampleRun: RunResult | null;
  actions: Action[];
  ghost: Action[];
  hotspots?: Hotspot[];
  satellite?: CanvasImageSource | null;
  zoneLabels: { status: ZoneStatus; p: number; protectedZone: boolean }[];
  hoverCell?: { x: number; y: number } | null;
  draft?: { from: [number, number]; to: [number, number] } | null;
  /** Wind badge and scale bar (off when the map is draped on 3D terrain). */
  overlays?: boolean;
  /** Hindcast: rings where satellites saw fire after the forecast start (off by default, it is a check, not the forecast). */
  showObserved?: boolean;
}

const baseCache = new WeakMap<object, HTMLCanvasElement>();

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Fuel colours with hillshade (light from the north-west), cached per landscape. */
function baseLayer(scn: Scenario): HTMLCanvasElement {
  const l = scn.landscape;
  const hit = baseCache.get(l);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = l.w; c.height = l.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(l.w, l.h);
  const rgb = FUEL_LIST.map((f) => hexToRgb(f.color));
  for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) {
    const k = y * l.w + x;
    const { slope, aspect } = slopeAspect(l, x, y);
    const az = (315 * Math.PI) / 180, alt = (45 * Math.PI) / 180;
    const s = (slope * Math.PI) / 180, a = (aspect * Math.PI) / 180;
    const shade = Math.max(0, Math.cos(alt) * Math.cos(s) + Math.sin(alt) * Math.sin(s) * Math.cos(az - a));
    const m = 0.78 + 0.35 * (shade - 0.7);
    const [r, g, b] = rgb[l.fuel[k]];
    img.data.set([r * m, g * m, b * m, 255], k * 4);
  }
  ctx.putImageData(img, 0, 0);
  baseCache.set(l, c);
  return c;
}

const fireCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function fireLayer(o: DrawOptions): HTMLCanvasElement | null {
  const l = o.scn.landscape;
  if (!fireCanvas) return null;
  fireCanvas.width = l.w; fireCanvas.height = l.h;
  const ctx = fireCanvas.getContext('2d')!;
  const img = ctx.createImageData(l.w, l.h);
  const n = l.w * l.h;
  const put = (k: number, r: number, g: number, b: number, a: number) => img.data.set([r, g, b, a * 255], k * 4);
  if (o.view === 'sample' && o.sampleRun) {
    const r = o.sampleRun;
    for (let k = 0; k < n; k++) {
      const ig = r.ign[k], out = r.out[k];
      if (ig === -2) put(k, 52, 38, 32, 0.85);
      else if (ig >= 0 && ig <= o.t) {
        const burning = out === -1 || out > o.t;
        if (burning) {
          const age = o.t - ig;
          put(k, 255, age < 1 ? 214 : 132, age < 1 ? 92 : 36, 0.95);
        } else if (r.ext[k]) put(k, 92, 112, 138, 0.85);
        else put(k, 45, 32, 28, 0.88);
      }
    }
  } else if (o.ens) {
    const R = o.ens.runs.length || 1;
    for (let k = 0; k < n; k++) {
      let burned = 0, burning = 0, scar = 0;
      for (const r of o.ens.runs) {
        const ig = r.ign[k];
        if (ig === -2) { scar++; continue; }
        if (ig >= 0 && ig <= o.t) {
          burned++;
          const out = r.out[k];
          if (out === -1 || out > o.t) burning++;
        }
      }
      if (scar) { put(k, 52, 38, 32, 0.85); continue; }
      const p = burned / R, pb = burning / R;
      if (p <= 0) continue;
      // Probability of having burned → warm ramp; active burning probability → bright orange.
      const hot = pb / Math.max(p, 1e-6);
      const r = 120 + 135 * hot, g = 40 + 80 * hot * p, b = 24;
      put(k, r, g, b, Math.min(0.92, 0.12 + 0.8 * p));
    }
  }
  ctx.putImageData(img, 0, 0);
  return fireCanvas;
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, angleRad: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleRad);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0, len / 2); ctx.lineTo(0, -len / 2 + 6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -len / 2); ctx.lineTo(-6, -len / 2 + 9); ctx.lineTo(6, -len / 2 + 9); ctx.closePath(); ctx.fill();
  ctx.restore();
}

const STATUS_COLOR: Record<ZoneStatus, string> = {
  burning: '#d9381e',
  likely: '#f07b16',
  'at-risk': '#e8b020',
  'lower-risk': '#7aa35a',
  'not-reached': '#5f8a6e',
};

function drawAction(ctx: CanvasRenderingContext2D, o: DrawOptions, a: Action, cs: number, ghost: boolean) {
  const l = o.scn.landscape;
  const c = (v: number) => (v + 0.5) * cs;
  const active = o.t >= a.startH;
  ctx.save();
  if (a.kind === 'firebreak') {
    const cells = lineCells(l, a.from, a.to);
    const built = ghost ? 0 : Math.max(0, Math.min(cells.length, Math.floor((o.t - a.startH) * a.cellsPerHour)));
    ctx.lineCap = 'round';
    // Planned line (dashed), then the part already cut by time t (solid).
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = ghost ? 'rgba(255,255,255,0.95)' : 'rgba(255,216,77,0.9)';
    ctx.lineWidth = ghost ? 3 : 3.5;
    ctx.beginPath(); ctx.moveTo(c(a.from[0]), c(a.from[1])); ctx.lineTo(c(a.to[0]), c(a.to[1])); ctx.stroke();
    if (built > 0) {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ffd84d';
      ctx.lineWidth = 5;
      ctx.beginPath();
      const k0 = cells[0], kb = cells[built - 1];
      ctx.moveTo(c(k0 % l.w), c((k0 / l.w) | 0)); ctx.lineTo(c(kb % l.w), c((kb / l.w) | 0));
      ctx.stroke();
    }
  } else if (a.kind !== 'seeding' && a.kind !== 'dryice') {
    // Map-wide actions (seeding, dry ice) have no place on the map; they show in the plan and timeline.
    const end = a.startH + actionDurationH(a);
    const live = !ghost && active && o.t <= end + 2;
    ctx.beginPath();
    ctx.arc(c(a.cx), c(a.cy), (a.radius + 0.5) * cs, 0, Math.PI * 2);
    if (a.kind === 'water') {
      ctx.fillStyle = live ? 'rgba(70,150,230,0.42)' : 'rgba(70,150,230,0.14)';
      ctx.fill();
      ctx.strokeStyle = ghost ? 'rgba(255,255,255,0.95)' : '#4a9be8';
    } else {
      ctx.strokeStyle = ghost ? 'rgba(255,255,255,0.95)' : '#e9f0ff';
    }
    ctx.setLineDash(ghost || a.kind !== 'water' ? [5, 4] : []);
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Icon
    ctx.setLineDash([]);
    ctx.fillStyle = a.kind === 'water' ? '#1f5f9e' : a.kind === 'inject' ? '#6b4a2b' : a.kind === 'wet' ? '#2f6f8f' : '#2b3440';
    ctx.beginPath(); ctx.arc(c(a.cx), c(a.cy), 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(a.kind === 'water' ? 'H₂O' : a.kind === 'inject' ? 'I' : a.kind === 'wet' ? 'S' : 'C', c(a.cx), c(a.cy) + 0.5);
  }
  ctx.restore();
}

/** Cells covered by a VIIRS pixel (~375 m, so ~1.9 cells at 100 m) around each detection. */
function footprint(w: number, h: number, hs: { x: number; y: number }[]): Uint8Array {
  const m = new Uint8Array(w * h);
  const r = 1.9;
  for (const p of hs) {
    for (let y = Math.max(0, Math.floor(p.y - r)); y <= Math.min(h - 1, Math.ceil(p.y + r)); y++) {
      for (let x = Math.max(0, Math.floor(p.x - r)); x <= Math.min(w - 1, Math.ceil(p.x + r)); x++) {
        if ((x - p.x) ** 2 + (y - p.y) ** 2 <= r * r) m[y * w + x] = 1;
      }
    }
  }
  return m;
}

/** Trace the boundary of a cell mask: a dark halo under a thin coloured line, legible on any background. */
function outline(ctx: CanvasRenderingContext2D, w: number, h: number, cs: number, m: Uint8Array, color: string, dash: number[]) {
  const path = new Path2D();
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!on(x, y)) continue;
    const x0 = x * cs, y0 = y * cs, x1 = x0 + cs, y1 = y0 + cs;
    if (!on(x, y - 1)) { path.moveTo(x0, y0); path.lineTo(x1, y0); }
    if (!on(x, y + 1)) { path.moveTo(x0, y1); path.lineTo(x1, y1); }
    if (!on(x - 1, y)) { path.moveTo(x0, y0); path.lineTo(x0, y1); }
    if (!on(x + 1, y)) { path.moveTo(x1, y0); path.lineTo(x1, y1); }
  }
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.setLineDash(dash);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3.5; ctx.stroke(path);
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(path);
  ctx.restore();
}

/** Detections from the 24 h before the forecast start; older ones are burn scars on the map already. */
function recentDetections(o: DrawOptions): Hotspot[] {
  const hs = o.hotspots ?? [];
  if (!hs.length) return [];
  const ref = o.scn.hindcast ? Date.parse(o.scn.hindcast.t0) : Math.max(...hs.map((h) => Date.parse(h.acquired) || 0));
  return hs.filter((h) => !(ref - Date.parse(h.acquired) > 24 * 3.6e6));
}

export function drawMap(ctx: CanvasRenderingContext2D, o: DrawOptions) {
  const l = o.scn.landscape;
  const S = o.size;
  const cs = S / l.w;
  ctx.clearRect(0, 0, S, S);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (o.satellite) {
    ctx.drawImage(o.satellite, 0, 0, S, S);
    ctx.globalAlpha = 0.28;
    ctx.drawImage(baseLayer(o.scn), 0, 0, S, S);
    ctx.globalAlpha = 1;
  } else {
    ctx.drawImage(baseLayer(o.scn), 0, 0, S, S);
  }

  const fire = fireLayer(o);
  if (fire) ctx.drawImage(fire, 0, 0, S, S);

  // Zones: a hairline grid and a compact badge. Colour says the status; text only where there is a number.
  ctx.save();
  l.zones.forEach((z, zi) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(z.x0 * cs + 0.5, z.y0 * cs + 0.5, (z.x1 - z.x0) * cs - 1, (z.y1 - z.y0) * cs - 1);
    const lab = o.zoneLabels[zi];
    if (!lab) return;
    const x = z.x0 * cs + 8, y = z.y0 * cs + 8;
    const text = lab.status === 'burning' ? '' : `${Math.round(lab.p * 100)}%${lab.protectedZone ? ' ↓' : ''}`;
    ctx.font = '600 11px -apple-system, system-ui, sans-serif';
    const tw = text ? ctx.measureText(text).width + 10 : 0;
    ctx.fillStyle = 'rgba(20,18,16,0.62)';
    ctx.beginPath(); ctx.roundRect(x, y, 22 + tw, 22, 11); ctx.fill();
    ctx.fillStyle = STATUS_COLOR[lab.status];
    ctx.beginPath(); ctx.arc(x + 11, y + 11, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(z.id, x + 11, y + 11.5);
    if (text) {
      ctx.textAlign = 'left';
      ctx.font = '600 11px -apple-system, system-ui, sans-serif';
      ctx.fillText(text, x + 24, y + 11.5);
    }
    if (lab.protectedZone) {
      ctx.strokeStyle = '#7fd1ff'; ctx.lineWidth = 2; ctx.setLineDash([8, 5]);
      ctx.strokeRect(z.x0 * cs + 4, z.y0 * cs + 4, (z.x1 - z.x0) * cs - 8, (z.y1 - z.y0) * cs - 8);
      ctx.setLineDash([]);
    }
  });
  ctx.restore();

  // Satellite detections: one outline around the area seen burning, recent passes only (older
  // ones are already drawn as burn scars). Hundreds of markers would hide the forecast.
  outline(ctx, l.w, l.h, cs, footprint(l.w, l.h, recentDetections(o)), 'rgba(255,255,255,0.95)', []);

  // Hindcast: what satellites saw after the forecast start (rings, so the forecast stays visible).
  if (o.showObserved) outline(ctx, l.w, l.h, cs, footprint(l.w, l.h, o.scn.hindcast?.observed ?? []), '#7fd1ff', [5, 4]);

  for (const a of o.actions) drawAction(ctx, o, a, cs, false);
  for (const a of o.ghost) drawAction(ctx, o, a, cs, true);

  if (o.draft) {
    ctx.save();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo((o.draft.from[0] + 0.5) * cs, (o.draft.from[1] + 0.5) * cs);
    ctx.lineTo((o.draft.to[0] + 0.5) * cs, (o.draft.to[1] + 0.5) * cs);
    ctx.stroke();
    ctx.restore();
  }

  if (o.hoverCell) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(o.hoverCell.x * cs, o.hoverCell.y * cs, cs, cs);
  }

  if (o.overlays === false) return;
  // Wind indicator
  const w = weatherAt(o.scn.weather, o.t);
  const wx = S - 46, wy = 46;
  ctx.fillStyle = 'rgba(20,18,16,0.72)';
  ctx.beginPath(); ctx.arc(wx, wy, 32, 0, Math.PI * 2); ctx.fill();
  arrow(ctx, wx, wy - 4, 34, (((w.windFromDeg + 180) % 360) * Math.PI) / 180, '#fff');
  ctx.fillStyle = '#fff';
  ctx.font = '600 10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${Math.round(w.windKmh)} km/h`, wx, wy + 24);

  // Scale bar (1 km)
  const km = (1000 / l.cellM) * cs;
  ctx.fillStyle = 'rgba(20,18,16,0.72)';
  ctx.fillRect(10, S - 28, km + 16, 20);
  ctx.fillStyle = '#fff';
  ctx.fillRect(18, S - 16, km, 3);
  ctx.font = '600 10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('1 km', 20, S - 19);
}

/** Emissive layer for 3D: share of runs (or the sample run) where each cell is burning at t. */
export function glowLayer(o: DrawOptions, target: HTMLCanvasElement): HTMLCanvasElement {
  const l = o.scn.landscape;
  target.width = l.w; target.height = l.h;
  const ctx = target.getContext('2d')!;
  const img = ctx.createImageData(l.w, l.h);
  const n = l.w * l.h;
  const runs = o.view === 'sample' && o.sampleRun ? [o.sampleRun] : o.ens?.runs ?? [];
  const R = runs.length || 1;
  for (let k = 0; k < n; k++) {
    let b = 0;
    for (const r of runs) {
      const ig = r.ign[k], out = r.out[k];
      if (ig >= 0 && ig <= o.t && (out === -1 || out > o.t)) b++;
    }
    const v = b / R;
    img.data.set([255 * v, 120 * v, 30 * v, 255], k * 4);
  }
  ctx.putImageData(img, 0, 0);
  return target;
}
