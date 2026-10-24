// One-page A4 PDF brief for commanders, built in the browser with jsPDF. Nothing is sent
// anywhere: the file is generated locally and saved by the browser.
//
// briefPdfData() turns the app state into plain numbers and strings; buildBriefPdf() lays them
// out. Both are free of DOM access (the map image is captured by the caller), so they run in
// tests under Node. The layout is black and greys only, so it survives grayscale printing and
// being forwarded as a photo of a printout.
import { jsPDF } from 'jspdf';
import { emissions } from '../sim/carbon';
import type { ObservedEmissions } from '../sim/frp';
import type { Recommendation, RecommendOutput } from '../sim/recommend';
import { localClock } from '../sim/recommend';
import type { Inventory } from '../sim/resources';
import type { EnsembleResult, Scenario, SimParams } from '../sim/types';
import { burnedBy, peatIsSynthetic } from './Outcome';
import { zoneStatus, type ZoneStatus } from './status';

export type Lang = 'id' | 'en';

export interface SealedInfo {
  receiptSha256: string;
  signedAt?: string;
  keyId?: string;
  anchored: boolean;
  calendar?: string;
  /** False when the record was made for a different scenario than the one on screen. */
  matches: boolean;
}

export interface BriefPdfData {
  lang: Lang;
  generatedAt: string; // ISO
  title: string;
  description: string;
  localStart: string | null;
  location: { lat: number; lon: number } | null;
  synthetic: boolean;
  provenance: { weather: string; hotspots: string; fuel: string };
  horizonH: number;
  runs: number;
  burned: { mean: number; p10: number; p90: number };
  withPlan: { mean: number; p10: number; p90: number; actions: number } | null;
  emissions: { mean: number; p10: number; p90: number; illustrative: boolean; factorLo: number; factorHi: number };
  observed: { tco2e: number; windowH: number; detections: number; peatShare: number } | null;
  zones: { id: string; name: string; status: ZoneStatus; pIgnite: number; etaP10: number | null; etaP90: number | null; planP: number | null }[];
  recommendations: { title: string; where: string; what: string; when: string; impact: string; resources: string; savedHa: number; inPlan: boolean; unknown: boolean }[];
  inventory: { helicopters: number | null; crews: number | null; dozers: number | null; aircraft: number | null; source: Inventory['source'] };
  sealed: SealedInfo | null;
  /** The map as a JPEG data URL (embedded without re-encoding) and what it shows. */
  map: { jpeg: string; caption: string } | null;
}

const T = {
  en: {
    head: 'Fire Septum · Situation brief',
    generated: 'Generated', start: 'Forecast start', where: 'Location', data: 'Data',
    synthetic: 'SYNTHETIC EXERCISE: made-up landscape and weather, not a real fire.',
    live: 'Real data', weather: 'Weather', fires: 'Fires', fuel: 'Fuel and peat',
    burns: (h: number) => `Burns in ${h} h if nothing is done`, range: 'likely', ha: 'ha',
    withPlan: (n: number) => `With the current plan (${n} action${n === 1 ? '' : 's'})`,
    peat: 'Peat emissions, forecast if nothing is done', illustrative: 'illustrative: peat map synthetic',
    factor: (lo: number, hi: number) => `burn depth could make it x${lo.toFixed(1)} to x${hi.toFixed(1)}`,
    observed: (h: number) => `Already released, seen by satellite (last ${h} h)`, noObserved: 'No satellite detections with fire radiative power in the area.',
    zones: 'Zone risk', zone: 'Zone', status: 'Status', share: 'Runs ignited', eta: 'Fire arrives (p10-p90)', plan: 'With plan',
    shareNote: (n: number, h: number) => `Share of ${n} simulated runs in which the zone catches fire within ${h} h. No forecast is a guarantee.`,
    recs: 'Top recommendations (simulated, ranked by area saved)', noRecs: 'No simulated action saves area here.',
    lWhere: 'Where', lWhat: 'What', lWhen: 'When', lImpact: 'Impact', lRes: 'Resources', inPlan: 'in plan', unknownRes: 'resources not confirmed',
    resources: 'Resources entered', heli: 'Helicopters', crews: 'Hand crews', dozers: 'Dozers', aircraft: 'Seeding aircraft', unknown: 'unknown',
    invSource: { synthetic: 'synthetic exercise inventory, not real', user: 'entered by the commander', unknown: 'not entered' },
    record: 'Record', sealed: 'Sealed record', receipt: 'Receipt SHA-256', signed: 'Signed', ts: 'Bitcoin timestamp',
    tsPending: 'submitted to OpenTimestamps, pending a block', tsNone: 'not submitted', mismatch: 'Note: this record was made for a different scenario than this brief.',
    notSealed: 'Not sealed. This brief is not a record; seal the forecast in the Record tab before relying on it later.',
    verify: (h: string) => `To verify: open Fire Septum > Record > "Check a record" with the record file; its receipt hash must start ${h}. Re-running it must give the same output hash.`,
    map: 'Map', noMap: 'Map image not available.',
    disclaimer: 'Research prototype using a simplified fire model. Not firefighting guidance: follow BPBD, Manggala Agni and incident command. Emission numbers are model or satellite estimates, not measurements and not carbon credits.',
    recLang: '',
    page: 'Fire Septum',
  },
  id: {
    head: 'Fire Septum · Ringkasan situasi',
    generated: 'Dibuat', start: 'Awal prakiraan', where: 'Lokasi', data: 'Data',
    synthetic: 'LATIHAN SINTETIS: lanskap dan cuaca rekaan, bukan kebakaran nyata.',
    live: 'Data nyata', weather: 'Cuaca', fires: 'Titik api', fuel: 'Bahan bakar dan gambut',
    burns: (h: number) => `Terbakar dalam ${h} jam jika tidak ada tindakan`, range: 'kemungkinan', ha: 'ha',
    withPlan: (n: number) => `Dengan rencana saat ini (${n} tindakan)`,
    peat: 'Emisi gambut, prakiraan jika tidak ada tindakan', illustrative: 'ilustrasi: peta gambut sintetis',
    factor: (lo: number, hi: number) => `kedalaman bakar bisa x${lo.toFixed(1)} sampai x${hi.toFixed(1)}`,
    observed: (h: number) => `Sudah terlepas, terlihat satelit (${h} jam terakhir)`, noObserved: 'Tidak ada deteksi satelit dengan daya radiasi api di area ini.',
    zones: 'Risiko zona', zone: 'Zona', status: 'Status', share: 'Simulasi terbakar', eta: 'Api tiba (p10-p90)', plan: 'Dengan rencana',
    shareNote: (n: number, h: number) => `Bagian dari ${n} simulasi di mana zona terbakar dalam ${h} jam. Prakiraan bukan jaminan.`,
    recs: 'Rekomendasi utama (disimulasikan, urut menurut luas yang diselamatkan)', noRecs: 'Tidak ada tindakan simulasi yang menyelamatkan lahan di sini.',
    lWhere: 'Di mana', lWhat: 'Apa', lWhen: 'Kapan', lImpact: 'Dampak', lRes: 'Sumber daya', inPlan: 'dalam rencana', unknownRes: 'sumber daya belum dikonfirmasi',
    resources: 'Sumber daya yang dimasukkan', heli: 'Helikopter', crews: 'Regu darat', dozers: 'Buldoser', aircraft: 'Pesawat TMC', unknown: 'tidak diketahui',
    invSource: { synthetic: 'inventaris latihan sintetis, bukan nyata', user: 'dimasukkan oleh komandan', unknown: 'belum dimasukkan' },
    record: 'Rekaman', sealed: 'Rekaman tersegel', receipt: 'SHA-256 tanda terima', signed: 'Ditandatangani', ts: 'Cap waktu Bitcoin',
    tsPending: 'dikirim ke OpenTimestamps, menunggu blok', tsNone: 'belum dikirim', mismatch: 'Catatan: rekaman ini dibuat untuk skenario lain dari ringkasan ini.',
    notSealed: 'Belum disegel. Ringkasan ini bukan rekaman; segel prakiraan di tab Record sebelum diandalkan kemudian.',
    verify: (h: string) => `Cara verifikasi: buka Fire Septum > Record > "Check a record" dengan berkas rekaman; hash tanda terima harus diawali ${h}. Menjalankan ulang harus memberi hash keluaran yang sama.`,
    map: 'Peta', noMap: 'Gambar peta tidak tersedia.',
    disclaimer: 'Prototipe riset dengan model api yang disederhanakan. Bukan panduan pemadaman: ikuti BPBD, Manggala Agni dan komando insiden. Angka emisi adalah perkiraan model atau satelit, bukan pengukuran dan bukan kredit karbon.',
    recLang: ' Teks rekomendasi dalam bahasa Inggris.',
    page: 'Fire Septum',
  },
};

const STATUS_TEXT: Record<Lang, Record<ZoneStatus, string>> = {
  en: { burning: 'Burning', likely: 'Likely to ignite', 'at-risk': 'At risk', 'lower-risk': 'Lower risk', 'not-reached': 'Not reached' },
  id: { burning: 'Terbakar', likely: 'Kemungkinan besar terbakar', 'at-risk': 'Berisiko', 'lower-risk': 'Risiko lebih rendah', 'not-reached': 'Tidak terjangkau' },
};

/** The standard PDF fonts only cover Latin-1; replace the few symbols the app's text uses. */
export function pdfText(s: string): string {
  return s
    .replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080))
    .replace(/≈/g, '~').replace(/[→⟶]/g, '->').replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, '...').replace(/↓/g, 'v').replace(/≥/g, '>=').replace(/≤/g, '<=')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '');
}

const r2 = (t: number) => {
  if (Math.abs(t) < 1) return '0';
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(t))) - 1);
  return (Math.round(t / mag) * mag).toLocaleString('en-US');
};
const ha = (x: number) => Math.round(x).toLocaleString('en-US');
const pct = (p: number) => `${Math.round(p * 100)}%`;
const hour = (h: number | null) => (h === null ? '-' : `+${Number.isInteger(h) ? h : h.toFixed(1)} h`);

/** Plain data for the brief from the app state. */
export function briefPdfData(o: {
  lang: Lang; scn: Scenario; base: EnsembleResult; plan: EnsembleResult | null; hasPlan: boolean; actions: number;
  rec: RecommendOutput | null; applied?: Set<string>; params: SimParams; inventory: Inventory;
  observed: ObservedEmissions | null; sealed?: SealedInfo | null; map?: BriefPdfData['map']; now?: Date;
}): BriefPdfData {
  const { scn, base } = o;
  const H = scn.horizonH;
  const g = scn.landscape.geo;
  const em = emissions(scn.landscape, base, null, o.params.rates, H);
  const p = o.hasPlan && o.plan ? burnedBy(o.plan, H) : null;
  const recs = [...(o.rec?.recommendations ?? [])]
    .filter((r: Recommendation) => r.saved.mean >= 1)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3);
  return {
    lang: o.lang,
    generatedAt: (o.now ?? new Date()).toISOString(),
    title: scn.title,
    description: scn.description,
    localStart: localClock(scn, 0) ?? scn.weather[0]?.time ?? null,
    location: g ? { lat: (g.north + g.south) / 2, lon: (g.east + g.west) / 2 } : null,
    synthetic: scn.provenance.kind === 'synthetic',
    provenance: { weather: scn.provenance.weather, hotspots: scn.provenance.hotspots, fuel: scn.provenance.fuel },
    horizonH: H,
    runs: base.runs.length,
    burned: burnedBy(base, H),
    withPlan: p ? { ...p, actions: o.actions } : null,
    emissions: { mean: em.base.mean, p10: em.base.p10, p90: em.base.p90, illustrative: peatIsSynthetic(scn), factorLo: em.factorRange[0], factorHi: em.factorRange[1] },
    observed: o.observed ? { tco2e: o.observed.tco2e, windowH: o.observed.windowH, detections: o.observed.detections, peatShare: o.observed.peatShare } : null,
    zones: scn.landscape.zones.map((z, i) => {
      const s = base.zoneStats[i];
      return {
        id: z.id, name: z.asset ?? z.name.replace(/^Zone \w+\s*·?\s*/, ''), status: zoneStatus(s), pIgnite: s.pIgnite, etaP10: s.etaP10, etaP90: s.etaP90,
        planP: o.hasPlan && o.plan ? o.plan.zoneStats[i].pIgnite : null,
      };
    }),
    recommendations: recs.map((r) => ({
      title: r.title, where: r.where, what: r.what, when: r.when, impact: r.impact, resources: r.resources,
      savedHa: r.saved.mean, inPlan: !!o.applied?.has(r.id), unknown: r.availability === 'unknown',
    })),
    inventory: { helicopters: o.inventory.helicopters, crews: o.inventory.crews, dozers: o.inventory.dozers, aircraft: o.inventory.aircraft, source: o.inventory.source },
    sealed: o.sealed ?? null,
    map: o.map ?? null,
  };
}

/** Lay the brief out on one A4 page. */
export function buildBriefPdf(d: BriefPdfData): jsPDF {
  const L = T[d.lang];
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.setProperties({ title: pdfText(`${L.head}: ${d.title}`), creator: 'Fire Septum (research prototype)', subject: 'Situation brief' });
  const W = 210, M = 12, CW = W - 2 * M, BOTTOM = 297 - 20;
  let y = M;

  const text = (s: string, x: number, yy: number, o: { size?: number; bold?: boolean; gray?: number; maxW?: number; lh?: number } = {}): number => {
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
    doc.setFontSize(o.size ?? 9);
    doc.setTextColor(o.gray ?? 0);
    const lines = doc.splitTextToSize(pdfText(s), o.maxW ?? CW) as string[];
    const lh = o.lh ?? (o.size ?? 9) * 0.42;
    doc.text(lines, x, yy, { baseline: 'top' });
    return yy + lines.length * lh;
  };
  const rule = (yy: number, gray = 180) => { doc.setDrawColor(gray); doc.setLineWidth(0.2); doc.line(M, yy, W - M, yy); };
  const heading = (s: string) => { y = text(s.toUpperCase(), M, y, { size: 8, bold: true, gray: 70 }) + 1.2; };

  // Header
  doc.setFillColor(20, 20, 20); doc.rect(0, 0, W, 9, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255);
  doc.text(pdfText(L.head), M, 6);
  doc.setFont('helvetica', 'normal');
  doc.text(pdfText(`${L.generated} ${d.generatedAt.slice(0, 16).replace('T', ' ')} UTC`), W - M, 6, { align: 'right' });
  y = 13;
  y = text(d.title, M, y, { size: 15, bold: true }) + 0.5;
  const meta = [
    d.localStart ? `${L.start}: ${d.localStart}` : null,
    d.location ? `${L.where}: ${d.location.lat.toFixed(4)}, ${d.location.lon.toFixed(4)}` : null,
  ].filter(Boolean).join('   ');
  if (meta) y = text(meta, M, y, { size: 9, gray: 60 }) + 0.5;
  if (d.synthetic) {
    doc.setDrawColor(0); doc.setLineWidth(0.6); doc.rect(M, y, CW, 6.5);
    text(L.synthetic, M + 2, y + 1.6, { size: 9, bold: true });
    y += 8;
  } else {
    y = text(`${L.data}: ${L.live}. ${L.weather}: ${d.provenance.weather}. ${L.fires}: ${d.provenance.hotspots}.`, M, y, { size: 7.5, gray: 70 }) + 0.3;
    y = text(`${L.fuel}: ${d.provenance.fuel}.`, M, y, { size: 7.5, gray: 70 }) + 1;
  }
  rule(y); y += 3;

  // Map (left) and key numbers (right)
  const mapW = 84;
  const top = y;
  if (d.map) {
    try { doc.addImage(d.map.jpeg, 'JPEG', M, y, mapW, mapW); }
    catch { text(L.noMap, M, y + 30, { size: 8, gray: 90, maxW: mapW }); }
    doc.setDrawColor(150); doc.setLineWidth(0.2); doc.rect(M, y, mapW, mapW);
    text(d.map.caption, M, y + mapW + 1, { size: 6.8, gray: 90, maxW: mapW });
  } else {
    doc.setDrawColor(190); doc.rect(M, y, mapW, mapW);
    text(L.noMap, M + 4, y + mapW / 2, { size: 8, gray: 110, maxW: mapW - 8 });
  }
  const rx = M + mapW + 6, rw = CW - mapW - 6;
  let ry = top;
  const block = (label: string, big: string, sub?: string) => {
    ry = text(label, rx, ry, { size: 8, gray: 80, maxW: rw }) + 0.3;
    ry = text(big, rx, ry, { size: 16, bold: true, maxW: rw, lh: 6.5 });
    if (sub) ry = text(sub, rx, ry, { size: 8, gray: 60, maxW: rw }) + 0.2;
    ry += 2.2;
  };
  block(L.burns(d.horizonH), `${ha(d.burned.mean)} ${L.ha}`, `${L.range} ${ha(d.burned.p10)}-${ha(d.burned.p90)} ${L.ha}`);
  if (d.withPlan) block(L.withPlan(d.withPlan.actions), `${ha(d.withPlan.mean)} ${L.ha}`, `${L.range} ${ha(d.withPlan.p10)}-${ha(d.withPlan.p90)} ${L.ha}`);
  block(L.peat, `~${r2(d.emissions.mean)} t CO2e`, `${L.range} ${r2(d.emissions.p10)}-${r2(d.emissions.p90)} t; ${L.factor(d.emissions.factorLo, d.emissions.factorHi)}${d.emissions.illustrative ? `; ${L.illustrative}` : ''}`);
  if (d.observed) block(L.observed(d.observed.windowH), `~${r2(d.observed.tco2e)} t CO2e`, `VIIRS FRP, ${d.observed.detections} detections, ${Math.round(d.observed.peatShare * 100)}% peat; a floor for smouldering peat`);
  else { ry = text(L.noObserved, rx, ry, { size: 8, gray: 80, maxW: rw }) + 2.2; }
  // Resources entered
  ry = text(L.resources, rx, ry, { size: 8, bold: true, gray: 40, maxW: rw }) + 0.4;
  const n = (v: number | null) => (v === null ? L.unknown : String(v));
  ry = text(`${L.heli} ${n(d.inventory.helicopters)} · ${L.crews} ${n(d.inventory.crews)} · ${L.dozers} ${n(d.inventory.dozers)} · ${L.aircraft} ${n(d.inventory.aircraft)}`, rx, ry, { size: 8, maxW: rw }) + 0.2;
  ry = text(`(${L.invSource[d.inventory.source]})`, rx, ry, { size: 7.5, gray: 90, maxW: rw });
  y = Math.max(top + mapW + (d.map ? 8 : 3), ry) + 2;
  rule(y); y += 3;

  // Zone table
  heading(L.zones);
  const cols = [M, M + 50, M + 100, M + 128, M + 158];
  const hdr = [L.zone, L.status, L.share, d.zones.some((z) => z.planP !== null) ? L.plan : '', L.eta];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(80);
  hdr.forEach((h, i) => h && doc.text(pdfText(h), cols[i], y, { baseline: 'top' }));
  y += 4;
  const rows = d.zones.length > 9 ? d.zones.filter((z) => z.status !== 'not-reached').slice(0, 9) : d.zones;
  rows.forEach((z, i) => {
    if (i % 2 === 0) { doc.setFillColor(242, 242, 242); doc.rect(M, y - 0.8, CW, 4.4, 'F'); }
    doc.setFont('helvetica', z.status === 'likely' || z.status === 'burning' ? 'bold' : 'normal'); doc.setFontSize(8); doc.setTextColor(0);
    const name = (doc.splitTextToSize(pdfText(`${z.id}  ${z.name}`), cols[1] - cols[0] - 3) as string[])[0] ?? z.id;
    doc.text(name, cols[0], y, { baseline: 'top' });
    doc.text(pdfText(STATUS_TEXT[d.lang][z.status]), cols[1], y, { baseline: 'top' });
    doc.text(z.status === 'burning' ? '-' : pct(z.pIgnite), cols[2], y, { baseline: 'top' });
    if (z.planP !== null) doc.text(z.status === 'burning' ? '-' : pct(z.planP), cols[3], y, { baseline: 'top' });
    doc.text(z.status === 'burning' ? '-' : z.etaP10 === null ? '-' : `${hour(z.etaP10)} - ${hour(z.etaP90)}`, cols[4], y, { baseline: 'top' });
    y += 4.4;
  });
  y = text(L.shareNote(d.runs, d.horizonH), M, y + 0.5, { size: 7, gray: 100 }) + 1.5;
  rule(y); y += 3;

  // Recommendations
  heading(L.recs);
  if (!d.recommendations.length) y = text(L.noRecs, M, y, { size: 8.5, gray: 60 }) + 2;
  // Reserve room for the record block and footer.
  const recLimit = BOTTOM - 24;
  d.recommendations.forEach((r, i) => {
    if (y > recLimit - 12) return;
    const tag = [r.inPlan ? L.inPlan : '', r.unknown ? L.unknownRes : ''].filter(Boolean).join(', ');
    y = text(`${i + 1}. ${r.title}  (-${ha(r.savedHa)} ${L.ha}${tag ? `; ${tag}` : ''})`, M, y, { size: 9, bold: true }) + 0.6;
    for (const [k, v] of [[L.lWhere, r.where], [L.lWhat, r.what], [L.lWhen, r.when], [L.lImpact, r.impact], [L.lRes, r.resources]] as const) {
      if (!v || y > recLimit) continue;
      text(k, M + 3, y, { size: 7.5, bold: true, gray: 70 });
      y = text(v, M + 24, y, { size: 7.5, maxW: CW - 24 }) + 0.4;
    }
    y += 1.4;
  });
  if (L.recLang && d.recommendations.length) y = text(L.recLang.trim(), M, y, { size: 7, gray: 110 }) + 1;
  y = Math.min(y, recLimit) + 1;
  rule(y); y += 3;

  // Record
  heading(L.record);
  if (d.sealed) {
    const s = d.sealed;
    y = text(`${L.receipt}: ${s.receiptSha256}`, M, y, { size: 7.5 }) + 0.3;
    y = text(`${L.signed}: ${s.signedAt ? `${s.signedAt.slice(0, 16).replace('T', ' ')} UTC${s.keyId ? `, key ${s.keyId}` : ''}` : '-'}   ${L.ts}: ${s.anchored ? L.tsPending : L.tsNone}`, M, y, { size: 7.5 }) + 0.3;
    if (!s.matches) y = text(L.mismatch, M, y, { size: 7.5, bold: true }) + 0.3;
    y = text(L.verify(s.receiptSha256.slice(0, 16)), M, y, { size: 7.5, gray: 60 });
  } else {
    y = text(L.notSealed, M, y, { size: 7.5, gray: 40 });
  }

  // Footer
  rule(BOTTOM + 2, 120);
  text(L.disclaimer, M, BOTTOM + 3.5, { size: 7.2, bold: true, gray: 30 });
  return doc;
}

export const briefFileName = (d: BriefPdfData) =>
  `fireseptum-brief-${d.lang}-${d.generatedAt.slice(0, 16).replace(/[-:T]/g, '')}.pdf`;
