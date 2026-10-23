# Devpost submission text (draft)

Paste section by section into the Devpost form. Numbers are as of 21 Oct 2026; update the register status before submitting.

## Track

**Climate Data & Environmental Monitoring.** The track's problem is that environmental data is fragmented and hard to verify. SekatApi joins fragmented open fire data into one forecast. Then it makes every forecast verifiable: it is sealed and timestamped on Bitcoin before the outcome, reproducible bit for bit, and scored in public against NASA satellites. It is a *climate data verification platform* for wildfire forecasts, one of the builds the track lists.

## Inspiration

In 2015, Indonesia's peat fires emitted more CO₂ per day than the entire US economy (WRI, GFED estimates). Every dry season, fire commanders and governments act on hotspot maps and forecasts. Nobody keeps score of those forecasts: you cannot prove what a model said before the fire spread, and a model can always be tuned to look good on the past.

## What it does

- **Forecast.** It joins NASA FIRMS hotspots, Open-Meteo weather, AWS terrain and OpenStreetMap into a 40-run ensemble forecast of fire spread for the next 24–48 h around any active fire in Kalimantan or Sumatra.
- **Seal before the outcome.** It hashes every input and every simulated output (SHA-256), signs the receipt (Ed25519), and timestamps its hash on Bitcoin through OpenTimestamps. No wallet, no token, no fee: Bitcoin is used as a public clock.
- **Score in public.** The *Forecast register* picks the most active fires by a fixed rule, seals forecasts for them, and scores each one after 24 h against what the VIIRS satellites detected. Every forecast stays on the board, good or bad.
- **Reproduce.** The simulation is deterministic. Anyone can re-run a sealed record and must get the same output hash.
- **Plan.** It simulates firefighting options (control lines, helicopter drops, hand crews, peat injection) and ranks them by area saved. It uses only resources the commander says exist, and cites the doctrine behind every rule. Options that rest only on placeholder numbers, such as cloud seeding, are tagged *speculative* and kept out of the plan.

## How we built it

TypeScript, React and Vite, with three.js for 3D terrain. The fire model is the Alexandridis et al. (2008) cellular automaton, with a Horn slope kernel as in Köse et al. (2008, IEEE 3DTV-CON). It runs in Web Workers with common random numbers, so plans are compared run by run. Emissions use the IPCC 2013 Wetlands Supplement Tier 1 factors for tropical peat. Receipts use canonical JSON + SHA-256, Ed25519 signatures (Node crypto / WebCrypto) and OpenTimestamps calendars. 47 automated tests.

## Evidence (what we measured, not claimed)

- **Hindcast, 12 fires, 8–18 Oct 2026.** The first model spread ~6× too much new fire (CSI 0.17, no better than distance alone, 0.16). We slowed spread using Kalimantan events only. On held-out Sumatra, CSI rose from 0.08 to 0.11, against 0.09 for distance-only. Pooled CSI is 0.22 vs 0.17. That is small, and we say so.
- **Reproducibility.** Re-running all 12 hindcasts from scratch a day later gave identical counts.
- **Pre-registered forecasts.** 6 forecasts (3 Kalimantan, 3 Sumatra) were sealed and timestamped on 21 Oct 2026 before their outcome existed. [Update with scores before submitting.]
- **Third-party check.** The `.ots` proofs parse in the reference OpenTimestamps client (`ots info`, `ots verify`), with no SekatApi code involved. At writing they were pending Bitcoin confirmation; run `ots upgrade` and re-check before submitting.

## Who it is for and how it scales

- **BPBD and Manggala Agni commanders:** where and when to act, with uncertainty visible and no invented resources.
- **Provincial governments:** when to request aircraft, on a record that shows what was known at the time.
- **Researchers and agencies:** a public, tamper-evident scoreboard to compare fire models prospectively.
- **Auditors and carbon-project verifiers:** proof of what was forecast and decided, and when (concession holders carry strict liability for fires, UU 32/2009 Pasal 88).

It runs in a browser. It uses free, global open data; FIRMS needs only a free key. It is static-hostable, and every record is a plain JSON file. Adding a region is a bounding box.

## Challenges and limits (honest)

- The fuel and peat map is synthetic outside OpenStreetMap features. Emission numbers are labelled "if the forecast is right" and "illustrative" until a real peat map is integrated.
- The model's skill over a distance-only forecast is small, and the probabilities are not calibrated.
- Bit-identical re-runs are confirmed on V8 (Chromium, Node), not across all browser engines.
- It has not yet been tested with BPBD or Manggala Agni staff.

## What's next

Integrate the 2019 national peat map. Run the register daily through the 2026 dry season and publish the scoreboard. Test the planning view with one Daops unit.

## Built with

typescript, react, vite, three.js, web-workers, nasa-firms, open-meteo, aws-terrain-tiles, openstreetmap, opentimestamps, bitcoin, ed25519, vitest
