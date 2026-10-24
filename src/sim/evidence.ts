// Reversal evidence records: a tamper-evident snapshot of what the satellites saw in and around
// a carbon project in one window. Same sealing as run receipts (receipt.ts): canonical JSON →
// SHA-256 → the instance's Ed25519 signature → an OpenTimestamps proof anchored in Bitcoin.
// The record carries the raw FIRMS rows, so anyone can check the classification and the
// emission number against NASA's archive without trusting this app.
import { GFAS_BETA, MAX_HOLD_H } from './frp';
import { canonical, sha256Hex, type Anchor, type Signature } from './receipt';
import type { ProjectBoundary, ProjectReport, ReversalStatus, WindowSummary } from './reversal';

export const EVIDENCE_KIND = 'fireseptum.reversal-evidence';
export const EVIDENCE_VERSION = 1;

export const EVIDENCE_METHOD = `Inside/near: VIIRS 375 m detection centres against the filed project boundary (even-odd point in polygon; distance to the nearest edge, local flat earth). Emissions: VIIRS FRP per pass held to the next pass (max ${MAX_HOLD_H} h) x GFAS beta (peat ${GFAS_BETA.peat}, tropical forest ${GFAS_BETA.tropicalForest} kg/MJ; Kaiser et al. 2012) x IPCC emission factors (peat: 2013 Wetlands Supplement; forest: 2006 Vol. 4 Table 2.5), CH4 at GWP-100.`;

export const EVIDENCE_DISCLAIMER = 'Monitors fire observed by satellite. It is not an estimate of avoided emissions, not a verification, and not a statement about the project’s credits, buffer contributions or compliance. Detection centres carry about 375 m of position uncertainty; clouds and haze hide fires; smouldering peat radiates little, so the emission number is a floor.';

export interface EvidenceWindow {
  hours: number;
  from: string;
  to: string;
  status: ReversalStatus;
  counts: WindowSummary['counts'];
  observed: null | { tco2e: number; freMJ: number; dryMatterT: number; detections: number; passes: number; peatShare: number };
}

export interface ReversalEvidence {
  kind: typeof EVIDENCE_KIND;
  v: typeof EVIDENCE_VERSION;
  createdAt: string;
  project: { id: string; name: string; vcsId: number; registryUrl: string; boundarySha256: string; boundarySource: string };
  windows: { h24: EvidenceWindow; d7: EvidenceWindow };
  /** Every detection inside or within 5 km in the 7-day window, with the FIRMS CSV row verbatim. */
  detections: { product: string | null; row: Record<string, string> | null; lat: number; lon: number; acquired: string; frp: number; inside: boolean; distanceOutsideM: number; edgeM: number }[];
  firms: { products: string[]; query: string; fetchedAt: string };
  peat: string;
  method: string;
  disclaimer: string;
}

/** A sealed record: the evidence, its hash and the proofs over that hash. */
export interface EvidenceBundle {
  evidence: ReversalEvidence;
  evidenceSha256: string;
  signature?: Signature;
  anchor?: Anchor;
}

const r = (x: number, dp = 0) => Math.round(x * 10 ** dp) / 10 ** dp;

function win(w: WindowSummary): EvidenceWindow {
  const o = w.observed;
  return {
    hours: w.hours, from: new Date(w.fromMs).toISOString(), to: new Date(w.toMs).toISOString(), status: w.status, counts: w.counts,
    observed: o ? { tco2e: r(o.tco2e), freMJ: r(o.freMJ), dryMatterT: r(o.dryMatterT, 1), detections: o.detections, passes: o.passes, peatShare: r(o.peatShare, 2) } : null,
  };
}

/** Hash of the boundary geometry as used, so a record says exactly which polygon it was checked against. */
export const boundaryDigest = (b: ProjectBoundary) => sha256Hex(canonical(b.polygons));

export async function buildEvidence(b: ProjectBoundary, report: ProjectReport, o: { boundarySource: string; firms: ReversalEvidence['firms']; peat: string; createdAt?: string }): Promise<EvidenceBundle> {
  const evidence: ReversalEvidence = {
    kind: EVIDENCE_KIND, v: EVIDENCE_VERSION,
    createdAt: o.createdAt ?? new Date().toISOString(),
    project: { id: b.id, name: b.name, vcsId: b.vcsId, registryUrl: b.registryUrl, boundarySha256: await boundaryDigest(b), boundarySource: o.boundarySource },
    windows: { h24: win(report.h24), d7: win(report.d7) },
    detections: report.d7.near.map((p) => ({
      product: p.d.source ?? null, row: p.d.row ?? null, lat: p.d.lat, lon: p.d.lon, acquired: p.d.acquired, frp: p.d.frp,
      inside: p.inside, distanceOutsideM: r(p.outsideM), edgeM: r(p.edgeM),
    })),
    firms: o.firms,
    peat: o.peat,
    method: EVIDENCE_METHOD,
    disclaimer: EVIDENCE_DISCLAIMER,
  };
  return { evidence, evidenceSha256: await sha256Hex(canonical(evidence)) };
}

export const isEvidence = (x: unknown): x is EvidenceBundle => (x as EvidenceBundle | null)?.evidence?.kind === EVIDENCE_KIND;
