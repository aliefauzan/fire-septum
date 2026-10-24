import { describe, expect, it } from 'vitest';
import { DEFAULT_RATES } from './doctrine';
import { EVIDENCE_KIND, buildEvidence } from './evidence';
import { GFAS_BETA, MAX_HOLD_H, tco2ePerTdm } from './frp';
import { canonical, sha256Hex } from './receipt';
import {
  bboxOverlap, dedupe, edgeDistanceM, expandBbox, inPolygon, insideProject, monitorProject, observedInside, place,
  type Detection, type ProjectBoundary,
} from './reversal';

// A synthetic 0.1° square project on the equator (≈ 11.1 × 11.1 km) with a 0.02° hole in the middle.
const SQ: ProjectBoundary = {
  id: 'test', name: 'Test peat project', vcsId: 9999, registryUrl: 'https://registry.verra.org/app/projectDetail/VCS/9999',
  bbox: [100, 0, 100.1, 0.1],
  polygons: [[
    [[100, 0], [100.1, 0], [100.1, 0.1], [100, 0.1], [100, 0]],
    [[100.04, 0.04], [100.06, 0.04], [100.06, 0.06], [100.04, 0.06], [100.04, 0.04]],
  ]],
};
const NOW = Date.parse('2026-10-24T06:00:00Z');
const det = (lon: number, lat: number, hoursAgo: number, frp = 10, satellite = 'N'): Detection => ({
  lat, lon, frp, confidence: 'n', satellite, acquired: new Date(NOW - hoursAgo * 3.6e6).toISOString(), source: 'VIIRS_SNPP_NRT',
  row: { latitude: String(lat), longitude: String(lon), frp: String(frp) },
});
const M_PER_DEG_LON_EQ = 111_320;

describe('geometry', () => {
  it('point in polygon respects holes', () => {
    expect(inPolygon(100.02, 0.02, SQ.polygons[0])).toBe(true);
    expect(inPolygon(100.05, 0.05, SQ.polygons[0])).toBe(false); // in the hole
    expect(insideProject(100.2, 0.05, SQ)).toBe(false);
  });

  it('measures distance to the nearest edge in metres', () => {
    // 0.005° east of the east edge at the equator ≈ 557 m.
    expect(edgeDistanceM(100.105, 0.05, SQ)).toBeCloseTo(0.005 * M_PER_DEG_LON_EQ, -1);
    // Inside, 0.01° from the west edge.
    expect(edgeDistanceM(100.01, 0.05, SQ)).toBeCloseTo(0.01 * M_PER_DEG_LON_EQ, -1);
  });

  it('classifies inside, within 1 km, within 5 km and clear', () => {
    expect(place(det(100.05, 0.02, 1), SQ).status).toBe('inside');
    expect(place(det(100.105, 0.05, 1), SQ).status).toBe('within1km'); // ~560 m east
    expect(place(det(100.13, 0.05, 1), SQ).status).toBe('within5km'); // ~3.3 km east
    expect(place(det(100.2, 0.05, 1), SQ).status).toBe('clear'); // ~11 km east
    // A fire in the hole is outside the project, 0.01° from the hole's edge.
    const hole = place(det(100.05, 0.05, 1), SQ);
    expect(hole.inside).toBe(false);
    expect(hole.status).toBe('within5km');
  });

  it('expands boxes and tests overlap', () => {
    const e = expandBbox(SQ.bbox, 5000);
    expect(e[0]).toBeLessThan(100);
    expect((SQ.bbox[0] - e[0]) * M_PER_DEG_LON_EQ).toBeCloseTo(5000, -1);
    expect(bboxOverlap(SQ.bbox, [100.09, 0.09, 100.2, 0.2])).toBe(true);
    expect(bboxOverlap(SQ.bbox, [100.2, 0.2, 100.3, 0.3])).toBe(false);
  });
});

describe('project monitor', () => {
  it('takes the most severe status per window and separates 24 h from 7 days', () => {
    const dets = [
      det(100.05, 0.02, 30), // inside, 30 h ago: only in the 7-day window
      det(100.105, 0.05, 2), // within 1 km, recent
      det(100.2, 0.05, 2), // clear
      det(100.05, 0.02, 200), // older than 7 days: ignored
    ];
    const r = monitorProject(SQ, dets, NOW, DEFAULT_RATES);
    expect(r.h24.status).toBe('within1km');
    expect(r.h24.counts).toEqual({ inside: 0, within1km: 1, within5km: 0 });
    expect(r.h24.observed).toBeNull();
    expect(r.d7.status).toBe('inside');
    expect(r.d7.counts.inside).toBe(1);
    expect(r.d7.near.map((p) => p.status)).toEqual(['inside', 'within1km']);
    expect(r.d7.observed?.detections).toBe(1);
  });

  it('is clear with no detections', () => {
    const r = monitorProject(SQ, [], NOW, DEFAULT_RATES);
    expect(r.h24.status).toBe('clear');
    expect(r.d7.status).toBe('clear');
    expect(r.d7.nearestOutsideM).toBeNull();
  });

  it('computes emissions inside with the FRP method, peat unless the peat map says otherwise', () => {
    // Two passes 2 h apart inside the project: 10 MW held 2 h, 20 MW held to now (1 h).
    const inside = [det(100.02, 0.02, 3, 10, 'N'), det(100.03, 0.02, 1, 20, 'N20')];
    const peat = observedInside(inside, NOW, DEFAULT_RATES, 24)!;
    expect(peat.freMJ).toBeCloseTo(10 * 7200 + 20 * 3600, 0);
    expect(peat.peatShare).toBe(1);
    expect(peat.tco2e).toBeCloseTo(((144_000 * GFAS_BETA.peat) / 1000) * tco2ePerTdm('peat', DEFAULT_RATES), 1);
    // The peat map says mineral soil: counted as tropical forest, far lower per MJ.
    const forest = observedInside(inside, NOW, DEFAULT_RATES, 24, () => false)!;
    expect(forest.peatShare).toBe(0);
    expect(forest.tco2e).toBeCloseTo(((144_000 * GFAS_BETA.tropicalForest) / 1000) * tco2ePerTdm('tropicalForest', DEFAULT_RATES), 1);
    // A lone pass holds at most 12 h.
    expect(observedInside([det(100.02, 0.02, 30, 5)], NOW, DEFAULT_RATES, 168)!.freMJ).toBeCloseTo(5 * MAX_HOLD_H * 3600, 0);
  });

  it('drops duplicate detections from overlapping requests', () => {
    const a = det(100.02, 0.02, 3);
    expect(dedupe([a, { ...a }, det(100.03, 0.02, 3)]).length).toBe(2);
  });
});

describe('evidence record', () => {
  it('hashes canonically and keeps the raw FIRMS rows', async () => {
    const dets = [det(100.05, 0.02, 3, 12), det(100.105, 0.05, 2, 4)];
    const report = monitorProject(SQ, dets, NOW, DEFAULT_RATES);
    const b = await buildEvidence(SQ, report, {
      boundarySource: 'synthetic test square', peat: 'assumed peat', createdAt: '2026-10-24T06:00:00.000Z',
      firms: { products: ['VIIRS_SNPP_NRT'], query: 'test', fetchedAt: '2026-10-24T06:00:00.000Z' },
    });
    expect(b.evidence.kind).toBe(EVIDENCE_KIND);
    expect(b.evidenceSha256).toBe(await sha256Hex(canonical(b.evidence)));
    expect(b.evidence.detections).toHaveLength(2);
    expect(b.evidence.detections[0].row?.frp).toBe('12');
    expect(b.evidence.windows.h24.status).toBe('inside');
    expect(b.evidence.windows.d7.observed?.tco2e).toBeGreaterThan(0);
    expect(b.evidence.disclaimer).toMatch(/not an estimate of avoided emissions/);
    // Same inputs, same hash; any change, a different hash.
    const again = await buildEvidence(SQ, report, { boundarySource: 'synthetic test square', peat: 'assumed peat', createdAt: '2026-10-24T06:00:00.000Z', firms: b.evidence.firms });
    expect(again.evidenceSha256).toBe(b.evidenceSha256);
    const tampered = { ...b.evidence, windows: { ...b.evidence.windows, h24: { ...b.evidence.windows.h24, status: 'clear' as const } } };
    expect(await sha256Hex(canonical(tampered))).not.toBe(b.evidenceSha256);
  });
});
