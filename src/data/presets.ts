// Scenario presets shown in the picker: one recorded real event first, then the synthetic exercises.
import { decode } from '../sim/receipt';
import { PRESETS } from '../sim/scenarios';
import type { Scenario } from '../sim/types';
import recorded from './events/kalimantan-2026-10-18.json';

/**
 * The most recent Kalimantan event of the hindcast set (docs/hindcast.md), frozen at the last
 * satellite pass of 18 Oct 2026: real FIRMS detections, Open-Meteo archived weather, AWS
 * terrain. It ships with the code, so it works without API keys or a server.
 */
export function recordedScenario(): Scenario {
  const s = decode<Scenario>(recorded);
  return {
    ...s,
    id: 'recorded-kalimantan-2026-10-18',
    title: 'Recorded fire: West Kalimantan, 18 Oct',
    description: `Real satellite detections frozen at 18 Oct 2026, ${s.hindcast!.t0.slice(11, 16)} UTC, so you can check the forecast against what happened next.`,
  };
}

export const ALL_PRESETS = [
  { id: 'recorded', title: 'Recorded: West Kalimantan, 18 Oct', make: recordedScenario },
  ...PRESETS,
];
