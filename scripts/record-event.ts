// Record a hindcast scenario (the app's opening fire) from Node.
//
//   npx tsx scripts/record-event.ts                          # Kalimantan 18 Oct 2026 → src/data/events/kalimantan-2026-10-18.json
//   npx tsx scripts/record-event.ts -2.8179 110.6934 2026-10-18 src/data/events/kalimantan-2026-10-18.json
//
// Uses the default scenario options (OSM snapshot barriers and the drained-peat term).
import { writeFileSync } from 'node:fs';
import { recordEvent } from '../src/data/hindcastBatch.ts';
import { nodeEnv } from './lib/node-env.ts';

const [lat = '-2.8179', lon = '110.6934', date = '2026-10-18', out = 'src/data/events/kalimantan-2026-10-18.json'] = process.argv.slice(2);
const json = await recordEvent(Number(lat), Number(lon), date, {}, nodeEnv({ log: console.log }));
writeFileSync(out, json);
const s = JSON.parse(json);
console.log(`wrote ${out}: ${s.provenance.fuel}`);
