/// <reference lib="webworker" />
import { runEnsemble } from './ensemble';
import { runOnce } from './model';
import { recommend } from './recommend';
import type { Inventory, Logistics } from './resources';
import type { Action, Scenario, SimParams } from './types';

export type WorkerRequest =
  | { id: number; type: 'ensemble'; scn: Scenario; actions: Action[]; params: SimParams }
  | { id: number; type: 'recommend'; scn: Scenario; actions: Action[]; params: SimParams; inventory: Inventory; logistics: Logistics | null }
  | { id: number; type: 'advance'; scn: Scenario; actions: Action[]; params: SimParams; hours: number; seed: number };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'ensemble') {
      const result = runEnsemble(req.scn, req.actions, req.params);
      self.postMessage({ id: req.id, type: 'ensemble', result });
    } else if (req.type === 'recommend') {
      const result = recommend(req.scn, req.params, req.actions, {
        inventory: req.inventory,
        logistics: req.logistics,
        onProgress: (done, total) => self.postMessage({ id: req.id, type: 'progress', done, total }),
      });
      self.postMessage({ id: req.id, type: 'recommend', result });
    } else if (req.type === 'advance') {
      const r = runOnce(req.scn, req.actions, req.params, req.seed, { stopAtH: req.hours, antecedentRainMm: req.scn.antecedentRainMm });
      self.postMessage({ id: req.id, type: 'advance', final: r.final });
    }
  } catch (e) {
    self.postMessage({ id: req.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
