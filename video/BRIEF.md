---
workflow: general-video
flow: autonomous
---

# Brief: SekatApi demo video (IEEE ClimateChain Global Hackathon 2026)

## Deliverable
- One MP4, 1920×1080, 30 fps, **3:30 to 4:15 long** (the rules require a 3–5 min demo video).
- English narration (voice-over) with burned-in captions.
- Output: `video/out/sekatapi-demo.mp4`.

## Audience
Twelve hackathon judges from IEEE Blockchain groups (Türkiye, Estonia, Orange County, Silicon Valley). They know blockchain well, but not fire science. They judge five things:
1. climate impact;
2. innovation (blockchain or emerging tech);
3. technical execution;
4. practical usefulness;
5. presentation: the problem, how it works, and the real-world impact.

## One-line pitch
**"Peat-fire forecasts that cannot be faked after the fact."** SekatApi seals every fire-spread forecast on Bitcoin before the satellites see the outcome, then scores it in public.

## Narrative beats (in this order; you write the exact words and timing)
1. **Hook, ~20 s.** Indonesia's peat fires: in 2015 their daily emissions exceeded the entire US economy's (WRI analysis of GFED data). Every dry season, commanders act on forecasts, and nobody keeps score of them.
2. **Problem, ~25 s.** Environmental data is fragmented and hard to verify; that is our track, Climate Data & Environmental Monitoring. You cannot prove what a model said before the fire spread, and a model can always be tuned to look good on the past.
3. **What it does, ~40 s.** The app joins live open data into one forecast: NASA FIRMS satellite hotspots, Open-Meteo weather, AWS terrain and OpenStreetMap. It runs 40 simulated runs, so the uncertainty is visible. Show the recorded West Kalimantan fire and the Live fires search.
4. **Honest validation, ~35 s.** Hindcast on 12 real fires, 8–18 Oct 2026. The first model spread ~6× too much fire: CSI 0.17, no better than a "fire grows outward" baseline (0.16). We slowed spread using Kalimantan only. On held-out Sumatra, CSI went from 0.08 to 0.11, vs 0.09 for the baseline. Pooled: 0.22 vs 0.17. Small, and we say so.
5. **The core idea: pre-registration, ~50 s.** The Forecast register picks the 3 most active fires per island by a fixed rule. It forecasts the next 24 h, then seals the forecast: SHA-256 over every input and every simulated cell, an Ed25519 signature, and an OpenTimestamps anchor in Bitcoin. Six forecasts were sealed on 21 Oct 2026 (3 Kalimantan, 3 Sumatra) before their outcome existed. They are scored after 24 h against NASA FIRMS, and every one stays on the board, good or bad. Show the register sheet and the terminal: `ots verify` reports a real Bitcoin transaction.
6. **Why this is the right use of blockchain, ~25 s.** Bitcoin is a public clock: one hash per forecast, no token, no wallet, no fee. A smart contract cannot make a fire model more correct; a deterministic re-run can. Show the Record checks: receipt unchanged, inputs unchanged, signature valid, re-run gives the same result.
7. **Decision support, ~30 s.** The same sealed engine compares firefighting plans: control lines, helicopter drops, hand crews, peat injection. It plans only with resources the commander says exist, and tags placeholder-only options such as cloud seeding *speculative*. Show the before/after maps (−32% area in the exercise scenario) and the 3D terrain briefly.
8. **Impact and users, ~25 s.** BPBD and Manggala Agni commanders, provincial governments, researchers comparing fire models, auditors and carbon-project verifiers. It runs in a browser on free open data; adding a region is a bounding box.
9. **Honest limits and close, ~20 s.** The peat map is still synthetic, so CO₂ numbers are labelled illustrative. The model's edge is small. That is exactly why every forecast is now on the record. End card: "SekatApi — forecasts on the record." Track name, team name placeholder `[Team]`, repo link placeholder `[repo URL]`.

## Facts you may use (exact; do not invent others)
- See `video/assets/data.json` for the hindcast numbers and the register status.
- Grid: 6.4 × 6.4 km at 100 m cells; 40 ensemble runs; 24–48 h horizon.
- Emissions factor: about 800 t CO₂e per hectare of burned tropical peat (IPCC 2013 Wetlands Supplement, Tier 1). **It must always be called a model estimate, never "avoided emissions" or credits.**
- Tests: 47 automated tests pass.
- Re-running all 12 hindcasts a day later gave identical counts.
- `ots verify` output: see `video/assets/07-ots-terminal.txt` (Bitcoin transaction fc6c3516…, waiting for confirmations).
- The register forecasts were **not yet scored** when this video was made. Say "scored after 24 hours" or "results pending"; never show or invent a score for them.

## Forbidden
- No claims of safety, guarantees, deployment by agencies, partnerships, or users who have used it.
- No invented numbers, logos of real organizations, or fake UI.
- Do not say "AI predicts". The model is a cellular-automaton fire simulation; the optional LLM brief is not part of the story.
- Do not call the result "avoided emissions", "carbon credits" or "offsets".

## Visual style
- Match the app: white and light grey surfaces, near-black text, one warm accent (fire orange, about #E8590C) used sparingly. Clean sans-serif (Inter or system UI). Calm, Apple-keynote-like pacing.
- Mostly real screenshots, with slow Ken Burns pans and zooms, callout boxes and highlights on the relevant UI parts. Add simple animated charts for the hindcast numbers, and a typeset terminal panel for the `ots` output.
- Captions: bottom-centre, high contrast, two lines max.

## Assets (all in `video/assets/`, 1920×1080 unless noted)
| File | Shows |
|---|---|
| `01-recorded-fire.png` | Default view: recorded West Kalimantan fire 18 Oct 2026. Forecast vs. satellites card (12 of 18 new fire spots caught, CSI 0.41 vs distance-only 0.17); white rings = what satellites saw next |
| `02-live-fires.png` (close-up) | Live fires sheet after "Search Kalimantan": active NASA FIRMS clusters |
| `03-forecast-register.png` | Forecast register sheet over the app |
| `03b-register-sheet.png` (close-up) | Register: 6 sealed, each "timestamped on Bitcoin", "pending" |
| `04-plan-before-after.png` | Exercise scenario: no action vs with plan, 578 ha with the plan vs 847 ha without (−32%); the speculative cloud-seeding note |
| `05-record-sealed.png` | Record tab: sealed receipt, signature, Bitcoin submission |
| `05b-record-checks.png` (close-up) | Four green checks incl. "Re-run gives the same result" |
| `06-3d-terrain.png` | 3D terrain view of both maps |
| `07-ots-terminal.txt` | Real terminal output of export-proofs + `ots verify` |
| `data.json` | Numbers for charts |

## Audio
- Voice-over: generate it locally with macOS `say` (e.g. voice "Samantha" or "Daniel", rate about 165 wpm) to AIFF/WAV. Keep one file per scene so the timing can follow the narration.
- No music needed. If you add music, it must be generated or royalty-free and quiet under the voice.
