// Promise wrapper around the simulation Web Worker. Each new request of a given
// type supersedes the previous one, so dragging a slider never queues stale work.
import type { RecommendOutput } from './recommend';
import type { Inventory, Logistics } from './resources';
import type { Action, EnsembleResult, FireState, Scenario, SimParams } from './types';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (d: number, t: number) => void };

export class SimClient {
  // Two workers: the slow recommender search never blocks interactive plan updates.
  private fast = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private slow = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private pending = new Map<number, Pending>();
  private latest = new Map<string, number>();

  constructor() {
    this.fast.onmessage = this.slow.onmessage = (ev) => {
      const msg = ev.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') { p.onProgress?.(msg.done, msg.total); return; }
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg.type === 'advance' ? msg.final : msg.result);
    };
  }

  private call<T>(channel: string, type: string, payload: object, onProgress?: (d: number, t: number) => void): Promise<T> {
    const id = ++this.seq;
    this.latest.set(channel, id);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      (type === 'recommend' ? this.slow : this.fast).postMessage({ id, type, ...payload });
    }).then((v) => {
      if (this.latest.get(channel) !== id) throw new Superseded();
      return v;
    });
  }

  ensemble(scn: Scenario, actions: Action[], params: SimParams) {
    return this.call<EnsembleResult>('plan', 'ensemble', { scn, actions, params });
  }
  /** Separate channel so the baseline and the plan ensembles never supersede each other. */
  baseline(scn: Scenario, params: SimParams) {
    return this.call<EnsembleResult>('base', 'ensemble', { scn, actions: [], params });
  }
  /** Re-run for checking a record, on its own channels so it never supersedes the live view. */
  async rerun(scn: Scenario, actions: Action[], params: SimParams) {
    const base = await this.call<EnsembleResult>('verify-base', 'ensemble', { scn, actions: [], params });
    const plan = actions.length ? await this.call<EnsembleResult>('verify-plan', 'ensemble', { scn, actions, params }) : base;
    return { base, plan };
  }
  /** No-action forecast for the register, on its own channel (call one at a time). */
  forecast(scn: Scenario, params: SimParams) {
    return this.call<EnsembleResult>('register', 'ensemble', { scn, actions: [], params });
  }
  recommend(scn: Scenario, actions: Action[], params: SimParams, res: { inventory: Inventory; logistics: Logistics | null }, onProgress?: (d: number, t: number) => void) {
    return this.call<RecommendOutput>('recommend', 'recommend', { scn, actions, params, ...res }, onProgress);
  }
  advance(scn: Scenario, actions: Action[], params: SimParams, hours: number, seed: number) {
    return this.call<FireState>('advance', 'advance', { scn, actions, params, hours, seed });
  }
}

export class Superseded extends Error {
  constructor() { super('superseded'); }
}
