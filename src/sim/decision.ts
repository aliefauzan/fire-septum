// Decision records: what was decided, by whom, when, and on which forecast.
//
// A run record seals what the model said. A decision record seals what people did with it:
// the plan chosen (by the hash of its sealed run record), the forecast it rested on, the
// alternatives the recommender showed at that moment, the resources entered, and a note. It is
// hashed as canonical JSON, signed by the server, timestamped with OpenTimestamps, and can be
// co-signed by the forecaster, the incident commander and BPBD.
import type { Recommendation } from './recommend';
import type { Inventory } from './resources';
import {
  DECISION_SIGNATURE_SCHEME, canonical, checkCosignatures, sha256Hex, verifySignature,
  type Anchor, type Cosignature, type CosignRole, type Receipt, type Signature,
} from './receipt';

export const DECISION_KIND = 'fireseptum.decision';
export type DecisionChoice = 'adopt-plan' | 'no-action' | 'other';

export interface Alternative {
  rank: number;
  title: string;
  kind: Recommendation['kind'];
  /** Paired saving the recommender showed (against the plan in place when it ran), ha: ensemble mean and 10th–90th percentile. */
  savedHa: { mean: number; p10: number; p90: number };
  pBetter: number;
  /** Every action of this option is in the decided plan. */
  adopted: boolean;
}

export interface Decision {
  v: 1;
  kind: typeof DECISION_KIND;
  decidedAt: string;
  decision: DecisionChoice;
  /** Short human summary, e.g. "Plan X chosen at 14:00". */
  summary: string;
  /** Receipt hash of the sealed run record of the plan (the forecast alone for no action). */
  planReceiptSha256: string;
  /** The forecast the decision was based on. */
  forecast: {
    scenarioId: string;
    title: string;
    provenance: Receipt['scenario']['provenance'];
    inputsSha256: string;
    outputsSha256: string;
    actions: number;
  };
  /** What the recommender showed at decision time, best first. */
  alternatives: Alternative[];
  inventory: Inventory;
  note: string;
  role: CosignRole;
}

export interface DecisionRecord {
  decision: Decision;
  decisionSha256: string;
  signature?: Signature;
  anchor?: Anchor;
  cosignatures?: Cosignature[];
}

export const isDecisionRecord = (r: unknown): r is DecisionRecord => (r as DecisionRecord | null)?.decision?.kind === DECISION_KIND;

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Top recommendations as alternatives, marking those whose actions are all in the decided plan. */
export function alternativesOf(recs: Recommendation[], planActionIds: Iterable<string>, max = 5): Alternative[] {
  const inPlan = new Set(planActionIds);
  return [...recs].sort((a, b) => a.rank - b.rank).slice(0, max).map((r) => ({
    rank: r.rank, title: r.title, kind: r.kind,
    savedHa: { mean: r1(r.saved.mean), p10: r1(r.saved.p10), p90: r1(r.saved.p90) },
    pBetter: Math.round(r.saved.pBetter * 100) / 100,
    adopted: r.actions.length > 0 && r.actions.every((a) => inPlan.has(a.id)),
  }));
}

export async function buildDecision(d: Omit<Decision, 'v' | 'kind'>): Promise<{ decision: Decision; decisionSha256: string }> {
  if (!/^[0-9a-f]{64}$/.test(d.planReceiptSha256)) throw new Error('A decision must point at a sealed run record.');
  const decision: Decision = { v: 1, kind: DECISION_KIND, ...d, summary: d.summary.trim().slice(0, 200), note: d.note.trim().slice(0, 2000) };
  return { decision, decisionSha256: await sha256Hex(canonical(decision)) };
}

export interface DecisionCheck {
  hash: boolean;
  signature: boolean | null;
  cosignatures: { role: CosignRole; name: string; keyId: string; ok: boolean }[];
}

export async function checkDecision(r: DecisionRecord): Promise<DecisionCheck> {
  const hash = (await sha256Hex(canonical(r.decision))) === r.decisionSha256;
  let signature: boolean | null = null;
  if (r.signature) signature = r.signature.scheme === DECISION_SIGNATURE_SCHEME && await verifySignature(r.decisionSha256, r.signature).catch(() => false);
  return { hash, signature, cosignatures: await checkCosignatures(r.decisionSha256, r.cosignatures) };
}
