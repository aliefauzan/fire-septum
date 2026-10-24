# Questions a skeptical judge will ask, and the evidence that answers them

| Question | Short answer | Show |
|---|---|---|
| Where is the blockchain? Why not a smart contract? | The only trust question is "was this said before the fire spread?". A Bitcoin timestamp answers exactly that, for free, with no token. A smart contract cannot make a fire simulation more correct; a re-run does that. | `ots verify` output on a register proof; README "What blockchain is used for" |
| Isn't OpenTimestamps trivial? | The cryptography is simple on purpose. The new part is what gets timestamped: a full reproducible forecast (inputs + every simulated cell), sealed before the outcome exists and scored after. That is pre-registration for climate models. | Forecast register sheet; one entry's receipt hash, proof and score |
| Is your model any good? | Barely better than "fire grows outward". Hindcast CSI is 0.23 vs 0.18 pooled with the real peat and land-cover map (0.22 vs 0.17 with the synthetic one), and 0.12 vs 0.11 on held-out Sumatra. We publish that, and the register now measures it on forecasts we could not tune. | `docs/hindcast.md` tables; register scoreboard |
| Couldn't you just pick the fires you predict well? | No. The register picks the top 3 FIRMS clusters per island by a fixed rule, at issue time, and keeps every forecast. | `rule` field in each `data/register/*.json` |
| Couldn't you edit a forecast after the fact? | The receipt hash is in a Bitcoin block. Changing one input, one rate or one simulated cell changes the hash. | Change a rate, then *Check by re-running* fails |
| Your CO₂ numbers? | IPCC Tier 1 factors (verified tables), applied to the simulated burn on a synthetic peat map. They are labelled "if the forecast is right" and "illustrative". They are not credits and not avoided emissions anyone could claim. | Outcome card caveat; README "Emissions" |
| Why not just SiPongi or BMKG's fire danger rating? | SiPongi shows hotspots; SPARTAN (FWI) shows dryness. Neither forecasts spread at a location, and neither publishes forecasts that can be held to account. SekatApi uses the same satellite data and adds forecast + proof + score. | Live fires sheet; register |
| Who has used it? | Nobody operational yet. The first users are researchers and auditors; Daops testing is next. | — |
| Does it work without your server? | The static build runs the recorded fire and shows the register read-only. Proofs verify with the public `ots` client. | `npm run build`; `scripts/export-proofs.mjs` |
| What about AI? | The core is a physical-statistical simulation, not a black box. An optional LLM only rewrites the simulated numbers as a brief for commanders, and it is off by default. We did not add AI for show. | Brief tab (optional) |
| Does it reproduce on other machines? | Same output hashes on Chromium and Node (both V8). Other engines may differ in the last floating-point bit; the receipt records the engine. | Receipt `engine` field |
