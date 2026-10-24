// 3D terrain view: the 2D map (fire, zones, actions, satellite) is drawn into a
// canvas and draped on a mesh built from the scenario's own elevation grid, so
// what you see is exactly what the model uses. Burning cells glow via an emissive map.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { weatherAt } from '../sim/model';
import type { Action, EnsembleResult, Hotspot, RunResult, Scenario } from '../sim/types';
import type { Tool } from './MapView';
import { drawMap, glowLayer, type FireView, type ForecastLayer } from './render';
import type { ZoneStatus } from './status';

export interface CamSync {
  listeners: Set<(pos: THREE.Vector3, target: THREE.Vector3, from: object) => void>;
}
export const createCamSync = (): CamSync => ({ listeners: new Set() });

interface Props {
  title: string;
  subtitle: string;
  scn: Scenario;
  ens: EnsembleResult | null;
  t: number;
  view: FireView;
  sampleRun: RunResult | null;
  forecast?: ForecastLayer | null;
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
  sync: CamSync;
}

const TEX = 1024;

/** Vertical exaggeration so flat peatland still reads as terrain without inventing hills. */
export function exaggeration(elev: Float32Array): { ex: number; min: number } {
  let min = Infinity, max = -Infinity;
  for (const v of elev) { if (v < min) min = v; if (v > max) max = v; }
  const range = Math.max(1, max - min);
  return { ex: Math.min(10, Math.max(1.5, 900 / range)), min };
}

export function Map3D(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(400);
  const three = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    mesh: THREE.Mesh; tex: THREE.CanvasTexture; glow: THREE.CanvasTexture; texCanvas: HTMLCanvasElement; glowCanvas: HTMLCanvasElement;
    arrow: THREE.ArrowHelper; landscape: object | null; ex: number; raf: number; applying: boolean;
  } | null>(null);
  const [drag, setDrag] = useState<{ from: [number, number]; to: [number, number] } | null>(null);
  const l = p.scn.landscape;
  const W = (l.w * l.cellM) / 1000; // km

  // Set up renderer once.
  useEffect(() => {
    const el = wrap.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f5f5f7');
    scene.fog = new THREE.Fog('#f5f5f7', 12, 26);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
    camera.position.set(-0.6, 7.4, 9.8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.minDistance = 0.6;
    controls.maxDistance = 16;
    // Zoom toward the point under the pointer, and pan along the ground (right-drag / two fingers).
    controls.zoomToCursor = true;
    controls.screenSpacePanning = false;
    controls.target.set(0, 0, 0);
    scene.add(new THREE.HemisphereLight('#fff6e8', '#2a2018', 1.4));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(-6, 8, -4); // from the north-west, like the 2D hillshade
    scene.add(sun);
    const texCanvas = document.createElement('canvas');
    texCanvas.width = TEX; texCanvas.height = TEX;
    const glowCanvas = document.createElement('canvas');
    const tex = new THREE.CanvasTexture(texCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const glow = new THREE.CanvasTexture(glowCanvas);
    glow.magFilter = THREE.LinearFilter;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: glow, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.1, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    scene.add(mesh);
    // A grey plinth so the tile reads as a physical block.
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#c7c7cc', roughness: 1 }));
    plinth.name = 'plinth';
    scene.add(plinth);
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1.2, 0), 1, 0x1d1d1f, 0.3, 0.18);
    scene.add(arrow);

    const state = { renderer, scene, camera, controls, mesh, tex, glow, texCanvas, glowCanvas, arrow, landscape: null as object | null, ex: 1, raf: 0, applying: false };
    three.current = state;

    const onSync = (pos: THREE.Vector3, target: THREE.Vector3, from: object) => {
      if (from === state) return;
      state.applying = true;
      camera.position.copy(pos); controls.target.copy(target); controls.update();
      state.applying = false;
    };
    p.sync.listeners.add(onSync);
    controls.addEventListener('change', () => {
      // Keep the orbit centre over the tile so panning can't lose the map.
      const half = plinth.scale.x / 2;
      const tx = THREE.MathUtils.clamp(controls.target.x, -half, half), tz = THREE.MathUtils.clamp(controls.target.z, -half, half);
      if (tx !== controls.target.x || tz !== controls.target.z) {
        camera.position.x += tx - controls.target.x; camera.position.z += tz - controls.target.z;
        controls.target.x = tx; controls.target.z = tz;
      }
      if (state.applying) return;
      for (const f of p.sync.listeners) f(camera.position, controls.target, state);
    });

    const loop = () => { controls.update(); renderer.render(scene, camera); state.raf = requestAnimationFrame(loop); };
    loop();
    const ro = new ResizeObserver(() => setSize(Math.max(240, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => {
      cancelAnimationFrame(state.raf);
      ro.disconnect();
      p.sync.listeners.delete(onSync);
      controls.dispose(); renderer.dispose(); mesh.geometry.dispose(); mat.dispose(); tex.dispose(); glow.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = three.current;
    if (!s) return;
    s.renderer.setSize(size, size, false);
    s.renderer.domElement.style.width = `${size}px`;
    s.renderer.domElement.style.height = `${size}px`;
    s.camera.aspect = 1; s.camera.updateProjectionMatrix();
  }, [size]);

  // Rebuild terrain geometry when the landscape changes.
  useEffect(() => {
    const s = three.current;
    if (!s || s.landscape === l) return;
    s.landscape = l;
    const seg = 127;
    const g = new THREE.PlaneGeometry(W, W, seg, seg);
    g.rotateX(-Math.PI / 2);
    const { ex, min } = exaggeration(l.elev);
    s.ex = ex;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const sample = (fx: number, fy: number) => {
      const x = Math.min(l.w - 1.001, Math.max(0, fx)), y = Math.min(l.h - 1.001, Math.max(0, fy));
      const x0 = Math.floor(x), y0 = Math.floor(y), dx = x - x0, dy = y - y0;
      const e = (xx: number, yy: number) => l.elev[yy * l.w + xx];
      return e(x0, y0) * (1 - dx) * (1 - dy) + e(x0 + 1, y0) * dx * (1 - dy) + e(x0, y0 + 1) * (1 - dx) * dy + e(x0 + 1, y0 + 1) * dx * dy;
    };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const fx = ((x + W / 2) / W) * l.w - 0.5, fy = ((z + W / 2) / W) * l.h - 0.5;
      pos.setY(i, ((sample(fx, fy) - min) * ex) / 1000);
    }
    g.computeVertexNormals();
    s.mesh.geometry.dispose();
    s.mesh.geometry = g;
    const plinth = s.scene.getObjectByName('plinth') as THREE.Mesh;
    plinth.scale.set(W, 0.25, W);
    plinth.position.set(0, -0.126, 0);
  }, [l, W]);

  // Redraw the draped texture whenever anything visible changes.
  useEffect(() => {
    const s = three.current;
    if (!s) return;
    const ctx = s.texCanvas.getContext('2d')!;
    // Draw at half resolution scaled ×2 so labels and lines keep their 2D proportions.
    const opts = {
      size: TEX / 2, scn: p.scn, ens: p.ens, t: p.t, view: p.view, sampleRun: p.sampleRun, forecast: p.forecast,
      actions: p.actions, ghost: p.ghost, hotspots: p.hotspots, satellite: p.satellite, showObserved: p.showObserved,
      zoneLabels: p.zoneLabels, draft: drag, overlays: false,
    };
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    drawMap(ctx, opts);
    s.tex.needsUpdate = true;
    glowLayer(opts, s.glowCanvas);
    s.glow.needsUpdate = true;
    const w = weatherAt(p.scn.weather, p.t);
    const toward = (((w.windFromDeg + 180) % 360) * Math.PI) / 180;
    s.arrow.setDirection(new THREE.Vector3(Math.sin(toward), 0, -Math.cos(toward)).normalize());
    // Wind arrow floats above the tile's north-east corner, length ∝ wind speed.
    const len = 0.35 + Math.min(1.1, w.windKmh / 20);
    s.arrow.setLength(len, 0.22, 0.14);
    s.arrow.position.set(W / 2 - 0.6 - (Math.sin(toward) * len) / 2, 1.0, -W / 2 + 0.6 + (Math.cos(toward) * len) / 2);
  });

  useEffect(() => {
    const s = three.current;
    if (s) s.controls.enabled = !(p.interactive && p.tool !== 'inspect');
  }, [p.interactive, p.tool]);

  const cellAt = (e: React.PointerEvent): [number, number] | null => {
    const s = three.current;
    if (!s) return null;
    const r = s.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, s.camera);
    const hit = ray.intersectObject(s.mesh)[0];
    if (!hit?.uv) return null;
    return [Math.min(l.w - 1, Math.floor(hit.uv.x * l.w)), Math.min(l.h - 1, Math.floor((1 - hit.uv.y) * l.h))];
  };
  const active = p.interactive && p.tool !== 'inspect';
  const onDown = (e: React.PointerEvent) => {
    if (!active) return;
    const c = cellAt(e);
    if (!c) return;
    if (p.tool === 'firebreak') { setDrag({ from: c, to: c }); (e.target as HTMLElement).setPointerCapture(e.pointerId); }
    else p.onPlace?.(p.tool, c);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const c = cellAt(e);
    if (c) setDrag({ ...drag, to: c });
  };
  const onUp = () => {
    if (drag && Math.abs(drag.to[0] - drag.from[0]) + Math.abs(drag.to[1] - drag.from[1]) >= 2) p.onPlace?.('firebreak', drag.from, drag.to);
    setDrag(null);
  };

  return (
    <figure className={`map map-${p.accent}`}>
      {p.title && (<figcaption>
        <span className="map-title">{p.title}</span>
        <span className="map-sub">{p.subtitle}</span>
        {p.busy && <span className="spinner" aria-label="simulating" />}
      </figcaption>)}
      <div
        className="canvas-wrap three"
        ref={wrap}
        style={{ height: size, cursor: active ? 'crosshair' : 'grab' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        role="img"
        aria-label={`${p.title} 3D terrain view`}
      >
        <div className="three-hint">Drag to rotate · right-drag to move · scroll to zoom where you point</div>
      </div>
    </figure>
  );
}
