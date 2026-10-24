// Daily batches as the browser sees them (bundled with the code, like data/register/), and the
// local decision store behind /api/decisions.
import type { DailyBatch } from '../sim/batch';
import type { DecisionRecord } from '../sim/decision';
import type { Cosignature } from '../sim/receipt';

const bundledBatches = import.meta.glob<DailyBatch>('../../data/batches/2*.json', { import: 'default' });

let batches: Promise<DailyBatch[]> | null = null;
/** Every sealed daily batch (data/batches/<day>.json), oldest first. */
export function loadBatches(): Promise<DailyBatch[]> {
  batches ??= Promise.all(Object.values(bundledBatches).map((load) => load()))
    .then((bs) => bs.sort((a, b) => a.day.localeCompare(b.day)))
    .catch(() => []);
  return batches;
}

async function post<T>(path: string, body: object): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

/** Store a sealed decision in data/decisions/ (local runs only; the hosted copy is read-only). */
export const storeDecision = (record: DecisionRecord) => post<{ ok: true; file: string }>('/api/decisions', { record });

/** Append a co-signature to a stored decision. */
export const storeCosignature = (decisionSha256: string, cosignature: Cosignature) =>
  post<{ ok: true; record: DecisionRecord }>('/api/decisions/cosign', { decisionSha256, cosignature });
