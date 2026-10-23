# SCRIPT — sekatapi-demo

**Voice:** Samantha (macOS `say`, generated locally to AIFF/WAV — one file per scene, `video/audio/scene-NN-<slug>.aiff`)
**Voice settings:** rate 165 wpm · no music · no sound effects
**Voice direction:** Plain, confident, honest. No hype, no urgency, no "AI". Let the numbers land and pause where a number deserves it. Read numbers as written below (spelled out, not digits) so the pace is predictable.

Total: 664 spoken words · 244 s (4:04) · ≈ 163 wpm.

---

## Line 1 — Hook (Frame 1)

**Time:** 0:00 – 0:17
**Delivery:** Calm and factual. Land "Nobody keeps score" flat, with a beat before it.

    In 2015, Indonesia's peat fires released more carbon dioxide per day than the entire United States economy. That is a World Resources Institute analysis of the Global Fire Emissions Database. Every dry season, fire commanders act on those forecasts, and nobody keeps score of them.

## Line 2 — The problem (Frame 2)

**Time:** 0:17 – 0:36
**Delivery:** Measured. "So nobody knows which forecasts deserve trust" — slower, this is the turn of the video.

    This is a Climate Data and Environmental Monitoring track build, and the problem is familiar: environmental data is fragmented and hard to verify. You cannot prove what a model said before the fire spread. And a model can always be tuned until the past looks good. So nobody knows which forecasts deserve trust.

## Line 3 — What it does (Frame 3)

**Time:** 0:36 – 1:01
**Delivery:** Even, listing rhythm on the four data sources; lift slightly on "You see the uncertainty".

    SekatApi joins live open data into one fire-spread forecast. NASA FIRMS satellite hotspots for where fire is now. Open-Meteo for wind, humidity and rain. AWS terrain for slope. OpenStreetMap for rivers and roads. It runs on a six point four by six point four kilometre grid at one hundred metre cells, forty simulated runs, twenty four to forty eight hours ahead. You see the uncertainty, not one confident line.

## Line 4 — The recorded fire (Frame 4)

**Time:** 1:01 – 1:28
**Delivery:** Point at the screen. "Twelve of them" — mild satisfaction, nothing more. "The white rings are what the satellites saw" — factual, a little wry.

    Here is a real West Kalimantan fire, frozen at the last satellite pass on the eighteenth of October, twenty twenty six. The next day the satellites found eighteen new fire spots. The forecast caught twelve: a critical success index of point four one, against point one seven for a distance-only baseline. The white rings are what the satellites saw. Live, Kalimantan shows two thousand four hundred fifty two detections in the last day.

## Line 5 — Honest validation (Frame 5)

**Time:** 1:28 – 2:01
**Delivery:** No spin. "Now the honest part" is a deliberate downshift. Let "Small — we say so" be the most emphatic sentence in the scene, because it is the honest one.

    Now the honest part. We hindcast twelve real fires, eight to eighteen October. The first model spread about six times too much fire: a score of point one seven, no better than a distance-only baseline at point one six. We slowed the spread, choosing the parameter on Kalimantan only. On held-out Sumatra, the score moved from point zero eight to point one one, against point zero nine. Pooled over all twelve: point two two against point one seven. Small — we say so. Re-running it a day later gave identical counts.

## Line 6 — The register rule (Frame 6)

**Time:** 2:01 – 2:19
**Delivery:** Deliberate, slightly slower than the rest. This is the one sentence the whole video is for.

    That is why forecasts now go on the record. The register picks the three most active fires on each island by a fixed rule, applied automatically at issue time. Nobody picks the easy fires. Each gets a live scenario, a twenty-four hour forecast, and a seal.

## Line 7 — The seal (Frame 7)

**Time:** 2:19 – 2:48
**Delivery:** Three short beats on "hash", "signature", "anchor" — let the terminal read itself in silence for a second before the last line.

    Sealing is three things. A SHA-256 hash over every input and every simulated cell. An Ed25519 signature over that hash. And an OpenTimestamps anchor committed to Bitcoin. Six forecasts were sealed on the twenty-first of October — three in Kalimantan, three in Sumatra — before their outcome existed. Twenty-four hours later each one is scored against NASA FIRMS, and stays on the board, good or bad. Here is the reference client verifying one: a real Bitcoin transaction, still waiting for confirmations.

## Line 8 — Why Bitcoin (Frame 8)

**Time:** 2:48 – 3:09
**Delivery:** Short sentences, one breath each. "A deterministic re-run can" lands with quiet conviction.

    Bitcoin here is a public clock and nothing more. One hash per forecast. No token, no wallet, no fee. A smart contract cannot make a fire model more correct — a deterministic re-run can. So the record shows four things: the receipt is unchanged, the inputs are unchanged, the signature is valid, and re-running gives the same result.

## Line 9 — Decision support (Frame 9)

**Time:** 3:09 – 3:36
**Delivery:** Practical, operational. Stress "only plans with resources the commander says exist" and "speculative". Call the emissions number a model estimate — do not let it sound like a claim.

    The same sealed engine compares firefighting plans: control lines, helicopter drops, hand crews, peat injection. It only plans with resources the commander says exist. Options resting on placeholder numbers, like cloud seeding, are tagged speculative and kept out. In the exercise scenario, five hundred seventy-eight hectares burn with the plan against eight hundred forty-seven without: thirty-two percent less. That difference is a model estimate of about two hundred ten thousand tonnes of carbon dioxide equivalent.

## Line 10 — Impact and close (Frame 10)

**Time:** 3:36 – 4:04
**Delivery:** Warm but plain. The two limits get the same weight as the achievements. Final line is a statement, not a sales pitch.

    Who is it for? Disaster managers, Manggala Agni fire commanders, provincial governments, researchers comparing fire models, and auditors checking what was known. It runs in a browser on free open data; adding a region is a bounding box. Two honest limits: the peat map is synthetic, so carbon numbers are illustrative, and the model's edge is small. That is why every forecast is now on the record. SekatApi — forecasts on the record.
