---
format: 1920x1080
duration: 244s
message: "SekatApi — peat-fire forecasts that cannot be faked after the fact: sealed on Bitcoin before the satellites see the outcome, then scored in public."
arc: "Hook → Problem → What it does → Honest validation → Pre-registration → Why Bitcoin → Decision support → Impact & honest close"
audience: "Twelve hackathon judges from IEEE Blockchain groups (Türkiye, Estonia, Orange County, Silicon Valley) — blockchain-literate, not fire scientists."
mode: autonomous
---

# Storyboard — SekatApi demo (IEEE ClimateChain Global Hackathon 2026)

**Runtime:** 244 s (4:04) · 1920×1080 · 30 fps · English voice-over with burned-in captions.
**Narration:** `video/SCRIPT.md` — 664 words at ≈163 wpm. One audio file per frame (`video/audio/scene-NN-<slug>.aiff`), macOS `say`, voice "Samantha", rate 165 wpm.
**Frame files:** `video/compositions/<frame-id>.html`, mounted by `video/index.html` as sub-composition slots (one visual track, `data-track-index="1"`; audio on `data-track-index="10"`).
**Durations:** 17 + 19 + 25 + 27 + 33 + 18 + 29 + 21 + 27 + 28 = **244 s**.

## Global style

| Token | Value |
|---|---|
| Surface | `#FFFFFF` cards on a `#F7F8FA` canvas |
| Text | `#1A1A1A` near-black; secondary `#6B7075` |
| Accent | `#E8590C` (fire orange) — outlines, one highlighted bar, one rule. Used sparingly. |
| Type | Inter (bundled), fallback `system-ui`; numerals tabular |
| Captions | bottom-centre, 2 lines max, 34 px, `#FFFFFF` on `#1A1A1AFF` pill, `border-radius: 12px`, centred at y 958–1016 |
| Callout chip | `#FFFFFF` pill, 1 px `#E8590C` border, `#1A1A1A` text, 22 px |
| Screenshot treatment | 1920×1080 assets placed full-bleed with a slow Ken Burns push; 520×720 / 380×843 close-ups placed as a framed panel with 16 px radius and a soft shadow |
| Motion | Calm, Apple-keynote pace. `power2.inOut` on camera, `power3.out` on type, 0.4 s crossfades between frames. No bounce, no overshoot. |

**Camera convention used below:** `scale a→b, anchor (x, y)` = the source pixel (x, y) stays at the centre of the 1920×1080 frame while the source is scaled by `a` then `b`. `Source rect` = the region of the asset that is on screen at the *start* of the move.

---

## Frame 1 — Hook: nobody keeps score

- status: outline
- src: compositions/01-hook.html
- duration: 17s
- start: 0.0s
- transition_in: cut
- scene: Typeset cold open. A single statistic fills the frame, then a thin accent rule draws under it.
- voiceover: "In 2015, Indonesia's peat fires released more carbon dioxide per day than the entire United States economy. That is a World Resources Institute analysis of the Global Fire Emissions Database. Every dry season, fire commanders act on those forecasts, and nobody keeps score of them."
- poster: 6s
- audio: audio/scene-01-hook.aiff

**Narration (exact, from `SCRIPT.md` Line 1)**

> In 2015, Indonesia's peat fires released more carbon dioxide per day than the entire United States economy. That is a World Resources Institute analysis of the Global Fire Emissions Database. Every dry season, fire commanders act on those forecasts, and nobody keeps score of them.

**Visuals**

- **Asset:** none — a typeset card. Background `#F7F8FA` filling 0,0,1920,1080.
- **Type block** (left-aligned at x 140):
  - Eyebrow, 24 px, `#6B7075`, letter-spaced: `IEEE CLIMATECHAIN GLOBAL HACKATHON 2026` at y 150.
  - Headline, 76 px, `#1A1A1A`, max-width 1180 px, line-height 1.12, at y 210–420: `In 2015, Indonesia's peat fires released more carbon dioxide per day than the entire United States economy.`
  - Accent underline: a 4 px `#E8590C` rule, width 420, at y 448, drawn left→right over 0.9 s at t = 3.4 s.
  - Subline, 30 px, `#6B7075`, y 486: `World Resources Institute analysis of the Global Fire Emissions Database (GFED)`.
- **Lower band** (y 820–930): three small type stats separated by 1 px `#E0E3E6` rules at x 140, 700, 1180:
  - `2015` / `the year of the peak emissions
  - `per day` / `emissions, not per year`
  - `Indonesia` / `drained tropical peat`
  - Set the numeral in 64 px `#1A1A1A`, the label in 20 px `#6B7075`.
- **Camera:** no Ken Burns (typeset). Instead a 24 px upward drift on the whole type block, 18 s, `power1.out`, and a 0.25 → 1.0 fade-up per element, staggered 0.35 s.
- **Callout / highlight:** the phrase `Nobody keeps score of those forecasts.` is the last line; it sits alone in its own line at 76 px with `Nobody keeps score` in `#E8590C` and the rest in `#1A1A1A`. No arrows, no boxes.
- **Caption text** (bottom-centre, 2 lines max):
  - 0.0–5.4 s — `In 2015, Indonesia's peat fires released more carbon dioxide per day` / `than the entire United States economy.`
  - 5.4–9.8 s — `A World Resources Institute analysis of the Global Fire Emissions Database.`
  - 9.8–17.0 s — `Every dry season, fire commanders act on those forecasts,` / `and nobody keeps score of them.`

**Transition to next frame:** hard `cut` at 17.0 s (no overlap) — the hook lands on a clean beat, then the problem card is already on screen.

---

## Frame 2 — The problem: fragmented and unverifiable

- status: outline
- src: compositions/02-problem.html
- duration: 19s
- start: 17.0s
- transition_in: crossfade
- scene: Same canvas as Frame 1. A headline, three chips, and a diagram whose last link is dashed and empty.
- voiceover: "This is a Climate Data and Environmental Monitoring track build, and the problem is familiar: environmental data is fragmented and hard to verify. You cannot prove what a model said before the fire spread. And a model can always be tuned until the past looks good. So nobody knows which forecasts deserve trust."
- poster: 8s
- audio: audio/scene-02-problem.aiff

**Narration (exact, from `SCRIPT.md` Line 2)**

> This is a Climate Data and Environmental Monitoring track build, and the problem is familiar: environmental data is fragmented and hard to verify. You cannot prove what a model said before the fire spread. And a model can always be tuned until the past looks good. So nobody knows which forecasts deserve trust.

**Visuals**

- **Asset:** none — typeset on `#F7F8FA`.
- **Track badge**, top-left at x 140, y 120: a `#FFFFFF` pill, 1 px `#E0E3E6` border, 20 px text: `Track · Climate Data & Environmental Monitoring`.
- **Headline**, 60 px, `#1A1A1A`, x 140, y 200–340, max-width 1200: `Environmental data is fragmented and hard to verify.`
- **Three chips** in a row at y 400, each 380×96, `#FFFFFF`, 1 px `#E0E3E6`, radius 14, 26 px text:
  - `Fragmented` — sub-label 18 px `#6B7075`: `hotspots, weather, terrain, roads`
  - `Hard to verify` — sub-label: `no shared, checkable record`
  - `Tunable after the fact` — sub-label: `a hindcast can be made to look good`
- **Diagram**, y 560–760, four nodes in a row at x 140, 460, 780, 1100 (each 260×110, `#FFFFFF`, 1 px `#E0E3E6`, radius 14, 24 px label) joined by 2 px `#C9CED2` arrows:
  - `Hotspot map` → `Forecast` → `Decision` → **dashed** node, 2 px dashed `#C9CED2` border, `#8A9096` text: `no record of what was forecast`
  - The dashed node is the point of the frame: it fades in last (t = 8.5 s) and the arrow into it is dashed.
- **Accent line** under the dashed node, 3 px `#E8590C`, width 260, drawn at t = 10.0 s.
- **Camera:** static; elements fade+rise 16 px, staggered 0.3 s.
- **Caption text:**
  - 0.0–6.4 s — `This is a Climate Data and Environmental Monitoring track build,` / `and the problem is familiar: environmental data is fragmented and hard to verify.`
  - 6.4–11.4 s — `You cannot prove what a model said before the fire spread.` / `And a model can always be tuned until the past looks good.`
  - 11.4–19.0 s — `So nobody knows which forecasts deserve trust.`

**Transition to next frame:** `crossfade` 0.5 s, 36.0 s → 36.5 s (Frame 3 fades in over the last 0.5 s of Frame 2).

---

## Frame 3 — What it does: one forecast from live open data

- status: outline
- src: compositions/03-what-it-does.html
- duration: 25s
- start: 36.0s
- transition_in: crossfade
- scene: Four live data sources feed one grid. A drawn arrow carries the eye to an 8×8 cell grid where a few cells catch fire.
- voiceover: "SekatApi joins live open data into one fire-spread forecast. NASA FIRMS satellite hotspots for where fire is now. Open-Meteo for wind, humidity and rain. AWS terrain for slope. OpenStreetMap for rivers and roads. It runs on a six point four by six point four kilometre grid at one hundred metre cells, forty simulated runs, twenty four to forty eight hours ahead. You see the uncertainty, not one confident line."
- poster: 12s
- audio: audio/scene-03-what-it-does.aiff

**Narration (exact, from `SCRIPT.md` Line 3)**

> SekatApi joins live open data into one fire-spread forecast. NASA FIRMS satellite hotspots for where fire is now. Open-Meteo for wind, humidity and rain. AWS terrain for slope. OpenStreetMap for rivers and roads. It runs on a six point four by six point four kilometre grid at one hundred metre cells, forty simulated runs, twenty four to forty eight hours ahead. You see the uncertainty, not one confident line.

**Visuals**

- **Asset:** none — a built diagram, all numbers typeset (no fake app UI).
- **Left column**, x 120–860, four source cards stacked at y 250, 400, 550, 700 (each 740×120, `#FFFFFF`, 1 px `#E0E3E6`, radius 14):
  - `NASA FIRMS` — 30 px bold `#1A1A1A`; sub 22 px `#6B7075`: `satellite hotspots — where fire is now`
  - `Open-Meteo` — `wind, humidity and rain`
  - `AWS terrain` — `elevation and slope`
  - `OpenStreetMap` — `rivers, roads, logistics`
  - A 3 px `#E8590C` bar on the left edge of each card, drawn in as the card lands.
- **Connector**: a 2 px `#C9CED2` line from the four cards' right edge (x 860) converging to (x 1010, y 475), then a 2 px arrow into the forecast card. Drawn over 0.6 s at t = 6.0 s.
- **Right card**, x 1040–1800, y 210–860, `#FFFFFF`, 1 px `#E0E3E6`, radius 16. Inside:
  - Title 28 px `#1A1A1A` at (1072, 246): `One forecast`
  - **8×8 cell grid**, 8 columns × 8 rows, cell 38 px, gap 4 px, at x 1072–1408, y 300–628. Base cells `#EDEFF1`; 9 cells `#E8590C` at 60% opacity and 4 cells at full opacity (the cells that ignite in most runs) fading in last, t = 11–14 s.
  - **Stat column** at x 1450–1780, four rows, each a 34 px numeral + 20 px `#6B7075` label:
    - `6.4 × 6.4 km` / `forecast grid`
    - `100 m` / `cell size`
    - `40` / `simulated runs`
    - `24–48 h` / `horizon`
  - Under the grid, 20 px `#6B7075` at (1072, 660): `6.4 km grid · 100 m cells · 40 runs · 24–48 h horizon` (caption row under the graphic, for legibility at a glance).
  - Chip at (1072, 700), `#FFFFFF`, 1 px `#E8590C`, 22 px: `40 runs, so the uncertainty is visible`
- **Camera:** static diagram; the grid cells pop in with a 0.06 s stagger, the stat column counts up (40 → 0 → 40 is not animated; the four values fade in sequence, 0.25 s apart).
- **Caption text:**
  - 0.0–6.6 s — `SekatApi joins live open data into one fire-spread forecast.` / `NASA FIRMS satellite hotspots for where fire is now.`
  - 6.6–11.0 s — `Open-Meteo for wind, humidity and rain.` / `AWS terrain for slope. OpenStreetMap for rivers and roads.`
  - 11.0–18.0 s — `It runs on a six point four by six point four kilometre grid at one hundred metre cells,` / `forty simulated runs, twenty four to forty eight hours ahead.`
  - 18.0–25.0 s — `You see the uncertainty, not one confident line.`

**Transition to next frame:** `crossfade` 0.5 s at 61.0–61.5 s.

---

## Frame 4 — The recorded fire, and live fires

- status: outline
- src: compositions/04-recorded-fire.html
- duration: 27s
- start: 61.0s
- transition_in: crossfade
- scene: Real app screenshot with a slow push; an accent outline lands on the score card. Then a cut to the live-fires sheet beside a big count.
- voiceover: "Here is a real West Kalimantan fire, frozen at the last satellite pass on the eighteenth of October, twenty twenty six. The next day the satellites found eighteen new fire spots. The forecast caught twelve: a critical success index of point four one, against point one seven for a distance-only baseline. The white rings are what the satellites saw. Live, Kalimantan shows two thousand four hundred fifty two detections in the last day."
- poster: 10s
- audio: audio/scene-04-recorded-fire.aiff

**Narration (exact, from `SCRIPT.md` Line 4)**

> Here is a real West Kalimantan fire, frozen at the last satellite pass on the eighteenth of October, twenty twenty six. The next day the satellites found eighteen new fire spots. The forecast caught twelve: a critical success index of point four one, against point one seven for a distance-only baseline. The white rings are what the satellites saw. Live, Kalimantan shows two thousand four hundred fifty two detections in the last day.

**Visuals**

**Beat A — 61.0 s to 75.0 s (14 s): `video/assets/01-recorded-fire.png`**

- **Place:** 0, 0, 1920, 1080 (full bleed, native 1920×1080 — no crop needed at rest).
- **Source rect at t=0:** (0, 0)–(1920, 1080), i.e. the whole app.
- **Camera:** `scale 1.00 → 1.06, anchor (960, 500)`, 14 s, `power2.inOut`. At the end the visible source rect is ≈ (25, −9)–(1895, 1009): the title, both maps, the score card and the timeline all stay in frame.
- **Callout 1** (drawn at t = +3.0 s): a 2 px `#E8590C` rounded rectangle (radius 10) around the score block **source rect (1300, 78)–(1676, 226)**, drawn on with a 0.5 s `strokeDashoffset` reveal. A leader line 2 px `#E8590C` runs from (1488, 232) down-left to (1320, 300) ending in a 8 px dot.
- **Callout 2** (drawn at t = +5.0 s): a `#FFFFFF` chip, 1 px `#E8590C` border, 24 px, placed at **source rect (1298, 238)–(1676, 286)**: `12 of 18 new fire spots caught · CSI 0.41 · distance-only 0.17`.
- **Callout 3** (drawn at t = +8.5 s): a `#FFFFFF` chip, 1 px `#E8590C`, 22 px, at **source rect (300, 660)–(700, 702)**: `white rings = what the satellites saw next`, with a 1 px `#E8590C` leader to (520, 610) on the map.
- **Callout 4** (drawn at t = +11.0 s): a 2 px `#E8590C` rounded rect around the page subtitle **source rect (245, 112)–(930, 186)**: `frozen at the last satellite pass of 18 Oct 2026 (19:06 UTC)`.

**Beat B — 75.0 s to 88.0 s (13 s): `video/assets/02-live-fires.png` (520×720)**

- **Place:** scaled ×1.36 → 707×920, at x 1150, y 55 (occupies 1150–1857, 55–975). Radius 16, shadow `0 18 60 rgba(0,0,0,0.14)`.
- **Left block** (x 120–1080, on `#F7F8FA`):
  - Eyebrow 22 px `#6B7075` at y 330: `LIVE`
  - Big numeral 132 px `#1A1A1A` at y 360–500, counts up 0 → **2,452** over 1.2 s from t = 75.6 s.
  - Sub 28 px `#6B7075` at y 520: `fire detections in Kalimantan in the last 24 h`
  - Divider 1 px `#E0E3E6` at y 600, width 760.
  - Body 26 px `#1A1A1A` at y 640–760: `Search Kalimantan returns the most active NASA FIRMS clusters, with detection counts and last-seen times.`
- **Camera:** the sheet scales ×1.36 → ×1.44 (742×1028) anchored at its own top-left corner (1150, 55) over 13 s, `power1.inOut`; the left block fades up 0.4 s.
- **Callout:** a 2 px `#E8590C` rounded rect around the first two cluster rows of the sheet — **source rect (20, 194)–(500, 312)** — plus a `#FFFFFF` chip 1 px `#E8590C` at **source rect (18, 166)–(452, 192)**: `2452 fire detections in Kalimantan in the last 24 h. Pick one:`.
- **Caption text:**
  - 0.0–7.0 s — `Here is a real West Kalimantan fire, frozen at the last satellite pass` / `on the eighteenth of October, twenty twenty six.`
  - 7.0–13.0 s — `The next day the satellites found eighteen new fire spots.` / `The forecast caught twelve: a critical success index of point four one,`
  - 13.0–18.5 s — `against point one seven for a distance-only baseline.` / `The white rings are what the satellites saw.`
  - 18.5–27.0 s — `Live, Kalimantan shows two thousand four hundred fifty two detections in the last day.`

**Transition to next frame:** `cut` at 88.0 s into Frame 5.

---

## Frame 5 — Honest validation: the hindcast

- status: outline
- src: compositions/05-hindcast.html
- duration: 33s
- start: 88.0s
- transition_in: cut
- scene: Two honest bar charts side by side, then a third strip that shows the first model over-forecasting six times too much.
- voiceover: "Now the honest part. We hindcast twelve real fires, eight to eighteen October. The first model spread about six times too much fire: a score of point one seven, no better than a distance-only baseline at point one six. We slowed the spread, choosing the parameter on Kalimantan only. On held-out Sumatra, the score moved from point zero eight to point one one, against point zero nine. Pooled over all twelve: point two two against point one seven. Small — we say so. Re-running it a day later gave identical counts."
- poster: 18s
- audio: audio/scene-05-hindcast.aiff

**Narration (exact, from `SCRIPT.md` Line 5)**

> Now the honest part. We hindcast twelve real fires, eight to eighteen October. The first model spread about six times too much fire: a score of point one seven, no better than a distance-only baseline at point one six. We slowed the spread, choosing the parameter on Kalimantan only. On held-out Sumatra, the score moved from point zero eight to point one one, against point zero nine. Pooled over all twelve: point two two against point one seven. Small — we say so. Re-running it a day later gave identical counts.

**Visuals**

- **Asset:** none — a built chart slide on `#F7F8FA`.
- **Title**, 46 px `#1A1A1A`, x 140, y 96: `Hindcast · 12 real fires · 8–18 Oct 2026`
- **Subtitle**, 24 px `#6B7075`, x 140, y 152: `Scored on new 400 m squares only (about one satellite pixel) · CSI = hits / (hits + misses + false alarms)`
- **Panel A** (x 140–930, y 220–700), `#FFFFFF` card, radius 16:
  - Heading 28 px at (180, 252): `Pooled — all 12 fires`
  - Grouped bars, baseline y = 640, max value 0.25 (bar height = value / 0.25 × 300 px), 2 groups:
    - Group 1 label 22 px `#6B7075` at x 240: `τ = 3 h (first model)` — bars: `#1A1A1A` **0.17**, `#C9CED2` **0.16**
    - Group 2 label at x 560: `τ = 6 h (slowed spread)` — bars: `#E8590C` **0.22**, `#C9CED2` **0.17**
  - Value labels 24 px above each bar: `0.17`, `0.16`, `0.22`, `0.17`
  - Y axis: only 0 and 0.25 ticks, 1 px `#E0E3E6` gridlines.
  - Legend 20 px at (180, 664): `#1A1A1A` square = `SekatApi` · `#E8590C` square = `SekatApi, slowed spread` · `#C9CED2` square = `distance-only baseline`
- **Panel B** (x 1000–1790, y 220–700), `#FFFFFF` card, radius 16:
  - Heading 28 px at (1040, 252): `Sumatra — held out`
  - Same structure, same scale (0–0.25):
    - Group 1 `τ = 3 h`: `#1A1A1A` **0.08**, `#C9CED2` **0.08**
    - Group 2 `τ = 6 h`: `#E8590C` **0.11**, `#C9CED2` **0.09**
  - Value labels: `0.08`, `0.08`, `0.11`, `0.09`
  - Note 20 px `#6B7075` at (1040, 664): `τ was chosen on Kalimantan only.`
- **Panel C** (x 140–1790, y 730–880), `#FFFFFF` card, radius 16 — a horizontal comparison strip:
  - Heading 24 px at (180, 758): `New 400 m squares forecast — how much fire the model predicted`
  - Three inline bars, each 24 px tall, left-aligned at x 180, max width 900 for 663 squares:
    - `#C9CED2` bar, width 900 (663 squares), label right-aligned: `τ = 3 h — 663 forecast`
    - `#1A1A1A` bar, width 530 (390 squares), label: `τ = 6 h — 390 forecast`
    - `#E8590C` bar, width 155 (114 squares), label: `observed — 114`
  - Right-hand note 22 px `#6B7075` at (1300, 800): `about 6× too much fire` with a 3 px `#E8590C` underline.
- **Footer notes** (22 px `#6B7075`) at y 916 and y 950:
  - `Re-running all 12 hindcasts a day later gave identical counts.`
  - `The margin over distance-only is small. We publish it anyway.`
- **Camera:** static. Bars grow from the baseline, 0.7 s, `power3.out`, staggered 0.25 s; the `#E8590C` bar in each panel is the last to grow.
- **Caption text:**
  - 0.0–5.4 s — `Now the honest part.` / `We hindcast twelve real fires, eight to eighteen October.`
  - 5.4–13.0 s — `The first model spread about six times too much fire: a score of point one seven,` / `no better than a distance-only baseline at point one six.`
  - 13.0–19.6 s — `We slowed the spread, choosing the parameter on Kalimantan only.` / `On held-out Sumatra, the score moved from point zero eight to point one one, against point zero nine.`
  - 19.6–25.2 s — `Pooled over all twelve: point two two against point one seven.` / `Small — we say so.`
  - 25.2–33.0 s — `Re-running it a day later gave identical counts.`

**Transition to next frame:** `crossfade` 0.4 s at 121.0–121.4 s.

---

## Frame 6 — The register rule

- status: outline
- src: compositions/06-register-rule.html
- duration: 18s
- start: 121.0s
- transition_in: crossfade
- scene: Three numbered rules on the left; the real register sheet on the right with an accent box on "6 sealed · 0 scored".
- voiceover: "That is why forecasts now go on the record. The register picks the three most active fires on each island by a fixed rule, applied automatically at issue time. Nobody picks the easy fires. Each gets a live scenario, a twenty-four hour forecast, and a seal."
- poster: 8s
- audio: audio/scene-06-register-rule.aiff

**Narration (exact, from `SCRIPT.md` Line 6)**

> That is why forecasts now go on the record. The register picks the three most active fires on each island by a fixed rule, applied automatically at issue time. Nobody picks the easy fires. Each gets a live scenario, a twenty-four hour forecast, and a seal.

**Visuals**

- **Asset:** `video/assets/03b-register-sheet.png` (520×720 close-up of the Forecast register sheet).
- **Place:** scaled ×1.28 → 666×922, at x 1190, y 79 (occupies 1190–1856, 79–1001). Radius 16, shadow `0 18 60 rgba(0,0,0,0.14)`.
- **Left column** (x 120–1100), on `#F7F8FA`:
  - Eyebrow 22 px `#6B7075` at y 250: `PRE-REGISTRATION`
  - Heading 52 px `#1A1A1A` at y 290–360: `The forecast register`
  - Three numbered rules, each a row with a 44 px `#E8590C` numeral and 28 px text, at y 430, 560, 690:
    - `1` — `Pick the 3 most active fires on each island — a fixed rule, applied automatically at issue time.`
    - `2` — `Forecast the next 24 h from live data.`
    - `3` — `Seal it. Score it 24 h later against NASA FIRMS. Keep it, good or bad.`
  - Closing line 26 px `#1A1A1A` at y 850: `Nobody picks the easy fires.` (`Nobody picks the easy fires` in `#E8590C`.)
- **Callout on the sheet** (drawn at t = +6.0 s): a 2 px `#E8590C` rounded rect (radius 8) around the sheet's `6 sealed · 0 scored` row — **source rect (18, 110)–(340, 136)**, i.e. on-screen (1213, 220)–(1625, 253) — plus a `#FFFFFF` chip 1 px `#E8590C` 22 px at **source rect (18, 136)–(500, 160)**, on-screen (1213, 253)–(1830, 284): `6 sealed · 0 scored — waiting for the first 24 h windows to close`.
- **Second callout** (t = +10.0 s): a 2 px `#E8590C` rounded rect around the first entry's `pending` tag — **source rect (426, 284)–(508, 312)**, on-screen (1735, 443)–(1840, 478) — and a chip at **source rect (30, 312)–(430, 356)**, on-screen (1228, 479)–(1740, 535): `Sealed Oct 21, 12:40 AM · timestamped on Bitcoin · scores after Oct 22, 06:40 AM`.
- **Camera:** the sheet scales ×1.28 → ×1.34 (697×965) anchored at its own top-left (1190, 79) over 18 s, `power1.inOut`; the left column fades up, rules 1–3 staggered 0.4 s.
- **Caption text:**
  - 0.0–6.2 s — `That is why forecasts now go on the record.` / `The register picks the three most active fires on each island by a fixed rule,`
  - 6.2–11.4 s — `applied automatically at issue time.` / `Nobody picks the easy fires.`
  - 11.4–18.0 s — `Each gets a live scenario, a twenty-four hour forecast, and a seal.`

**Transition to next frame:** `cut` at 139.0 s into Frame 7.

---

## Frame 7 — The seal: hash, signature, Bitcoin

- status: outline
- src: compositions/07-seal-bitcoin.html
- duration: 29s
- start: 139.0s
- transition_in: cut
- scene: Three sealing steps, then a typeset terminal showing the reference `ots` client verifying a real Bitcoin transaction.
- voiceover: "Sealing is three things. A SHA-256 hash over every input and every simulated cell. An Ed25519 signature over that hash. And an OpenTimestamps anchor committed to Bitcoin. Six forecasts were sealed on the twenty-first of October — three in Kalimantan, three in Sumatra — before their outcome existed. Twenty-four hours later each one is scored against NASA FIRMS, and stays on the board, good or bad. Here is the reference client verifying one: a real Bitcoin transaction, still waiting for confirmations."
- poster: 20s
- audio: audio/scene-07-seal-bitcoin.aiff

**Narration (exact, from `SCRIPT.md` Line 7)**

> Sealing is three things. A SHA-256 hash over every input and every simulated cell. An Ed25519 signature over that hash. And an OpenTimestamps anchor committed to Bitcoin. Six forecasts were sealed on the twenty-first of October — three in Kalimantan, three in Sumatra — before their outcome existed. Twenty-four hours later each one is scored against NASA FIRMS, and stays on the board, good or bad. Here is the reference client verifying one: a real Bitcoin transaction, still waiting for confirmations.

**Visuals**

**Beat A — 139.0 s to 153.0 s (14 s): the three sealing steps**

- **Asset:** none — typeset on `#F7F8FA`.
- Heading 44 px `#1A1A1A` at x 140, y 100: `Sealing a forecast`
- Three steps stacked at x 140, y 240 / 430 / 620, each a `#FFFFFF` card 1560×150, radius 16, 1 px `#E0E3E6`, with a 4 px `#E8590C` left bar:
  - `1` `SHA-256 hash` — sub 24 px `#6B7075`: `over every input and every simulated cell`
  - `2` `Ed25519 signature` — sub: `over that hash`
  - `3` `OpenTimestamps anchor` — sub: `committed to Bitcoin`
  - A 2 px `#C9CED2` vertical connector runs down the left of the three cards.
- **Stat strip** at y 830–930, four stats in a row:
  - `6` / `forecasts sealed`
  - `3` / `in Kalimantan`
  - `3` / `in Sumatra`
  - `21 Oct 2026` / `before the outcome existed`
- **Camera:** static; cards rise 18 px and fade in, 0.35 s apart.

**Beat B — 153.0 s to 168.0 s (15 s): the terminal**

- **Asset:** `video/assets/07-ots-terminal.txt` — **typeset as a terminal panel, not a screenshot.**
- **Panel:** `#111418` rounded rect (radius 14) at x 220–1700, y 150–880, 2 px `#2A3038` border. Monospace 22 px, line-height 1.55, `#D7DBDE` body text, `#8AB4F8` prompt, `#7FD1A0` `ok` lines, `#E8590C` transaction hash.
- **Exact panel text** (verbatim from `video/assets/07-ots-terminal.txt`):

```
  $ node scripts/export-proofs.mjs
  ok  2026-10-20T16:38:43.516Z  -2.964, 112.151  sekatapi-278f58dc6960.receipt.json + .ots
  ok  2026-10-20T16:38:09.494Z  -3.335, 112.671  sekatapi-445e7ddd7292.receipt.json + .ots
  ok  2026-10-20T16:39:37.890Z  -3.400, 105.229  sekatapi-5ff72728fced.receipt.json + .ots
  ok  2026-10-20T16:40:11.756Z  -2.979, 105.162  sekatapi-8b3757efb8aa.receipt.json + .ots
  ok  2026-10-20T16:38:26.453Z  -3.832, 115.073  sekatapi-8f48c87dffb9.receipt.json + .ots
  ok  2026-10-20T16:39:54.798Z  -3.509, 105.287  sekatapi-fb2db4de00fe.receipt.json + .ots
  6 forecast(s) exported to proofs/

  $ ots verify proofs/sekatapi-278f58dc6960.receipt.json.ots
  Assuming target filename is 'proofs/sekatapi-278f58dc6960.receipt.json'
  Calendar https://alice.btc.calendar.opentimestamps.org: Timestamped by transaction
  fc6c351623a80b15c8559b9937688b7a0de5606e3520772bbfc3d38b4a8e838f; waiting for 6 confirmations
```

- **Callout:** a 2 px `#E8590C` rounded rect (radius 6) around the final transaction line — panel-relative (28, 342)–(1310, 372) — and a `#FFFFFF` chip 1 px `#E8590C` 22 px above it at panel-relative (28, 300): `Real Bitcoin transaction · fc6c3516… · waiting for 6 confirmations`.
- **Motion:** the terminal types on line by line (18 ms/char capped at 60 ms/line), finishing at t = +8.5 s; the callout draws at t = +10.0 s.
- **Caption text:**
  - 0.0–6.6 s — `Sealing is three things.` / `A SHA-256 hash over every input and every simulated cell.`
  - 6.6–11.4 s — `An Ed25519 signature over that hash.` / `And an OpenTimestamps anchor committed to Bitcoin.`
  - 11.4–17.4 s — `Six forecasts were sealed on the twenty-first of October — three in Kalimantan,` / `three in Sumatra — before their outcome existed.`
  - 17.4–22.0 s — `Twenty-four hours later each one is scored against NASA FIRMS,` / `and stays on the board, good or bad.`
  - 22.0–29.0 s — `Here is the reference client verifying one: a real Bitcoin transaction,` / `still waiting for confirmations.`

**Transition to next frame:** `crossfade` 0.4 s at 168.0–168.4 s.

---

## Frame 8 — Why Bitcoin: a public clock

- status: outline
- src: compositions/08-why-bitcoin.html
- duration: 21s
- start: 168.0s
- transition_in: crossfade
- scene: The argument on the left, the real Record panel on the right with the four green checks outlined.
- voiceover: "Bitcoin here is a public clock and nothing more. One hash per forecast. No token, no wallet, no fee. A smart contract cannot make a fire model more correct — a deterministic re-run can. So the record shows four things: the receipt is unchanged, the inputs are unchanged, the signature is valid, and re-running gives the same result."
- poster: 12s
- audio: audio/scene-08-why-bitcoin.aiff

**Narration (exact, from `SCRIPT.md` Line 8)**

> Bitcoin here is a public clock and nothing more. One hash per forecast. No token, no wallet, no fee. A smart contract cannot make a fire model more correct — a deterministic re-run can. So the record shows four things: the receipt is unchanged, the inputs are unchanged, the signature is valid, and re-running gives the same result.

**Visuals**

- **Asset:** `video/assets/05b-record-checks.png` (380×843 close-up of the Record panel with the four checks).
- **Place:** scaled ×1.067 → 406×900, at x 1330, y 90 (occupies 1330–1736, 90–990). Radius 16, shadow `0 18 60 rgba(0,0,0,0.14)`.
- **Left column** (x 120–1230), on `#F7F8FA`:
  - Heading 48 px `#1A1A1A` at y 200: `Bitcoin is a public clock`
  - Sub 28 px `#6B7075` at y 270: `and nothing more`
  - Three bullets at y 360 / 430 / 500, 28 px, each with a 6 px `#E8590C` square marker:
    - `One hash per forecast`
    - `No token, no wallet, no fee`
    - `Verified by anyone with the public ots client`
  - A pull-quote block at y 610–760, `#FFFFFF` card radius 14, 1 px `#E0E3E6`, left bar 4 px `#E8590C`:
    - 34 px `#1A1A1A`: `A smart contract cannot make a fire model more correct.`
    - 34 px `#E8590C`: `A deterministic re-run can.`
- **Callout on the panel** (drawn at t = +9.0 s): a 2 px `#E8590C` rounded rect (radius 8) around the four check rows — **source rect (14, 512)–(368, 652)**, on-screen (1345, 636)–(1723, 786) — and a `#FFFFFF` chip 1 px `#E8590C` 22 px at **source rect (16, 486)–(200, 510)**, on-screen (1347, 608)–(1543, 634): `Checks`.
- **Build chip**, bottom-left of the frame at (120, 880), `#FFFFFF`, 1 px `#E0E3E6`, 22 px `#6B7075`: `47 automated tests pass`.
- **Camera:** the panel scales ×1.067 → ×1.12 (426×945) anchored at (1330, 90) over 21 s, `power1.inOut`; the left column fades up.
- **Caption text:**
  - 0.0–6.0 s — `Bitcoin here is a public clock and nothing more.` / `One hash per forecast. No token, no wallet, no fee.`
  - 6.0–11.4 s — `A smart contract cannot make a fire model more correct —` / `a deterministic re-run can.`
  - 11.4–21.0 s — `So the record shows four things: the receipt is unchanged, the inputs are unchanged,` / `the signature is valid, and re-running gives the same result.`

**Transition to next frame:** `crossfade` 0.4 s at 189.0–189.4 s.

---

## Frame 9 — Decision support: comparing plans

- status: outline
- src: compositions/09-decision-support.html
- duration: 27s
- start: 189.0s
- transition_in: crossfade
- scene: The exercise scenario's before/after numbers, the plan panel with the speculative note, then the 3D terrain.
- voiceover: "The same sealed engine compares firefighting plans: control lines, helicopter drops, hand crews, peat injection. It only plans with resources the commander says exist. Options resting on placeholder numbers, like cloud seeding, are tagged speculative and kept out. In the exercise scenario, five hundred seventy-eight hectares burn with the plan against eight hundred forty-seven without: thirty-two percent less. That difference is a model estimate of about two hundred ten thousand tonnes of carbon dioxide equivalent."
- poster: 14s
- audio: audio/scene-09-decision-support.aiff

**Narration (exact, from `SCRIPT.md` Line 9)**

> The same sealed engine compares firefighting plans: control lines, helicopter drops, hand crews, peat injection. It only plans with resources the commander says exist. Options resting on placeholder numbers, like cloud seeding, are tagged speculative and kept out. In the exercise scenario, five hundred seventy-eight hectares burn with the plan against eight hundred forty-seven without: thirty-two percent less. That difference is a model estimate of about two hundred ten thousand tonnes of carbon dioxide equivalent.

**Visuals**

**Beat A — 189.0 s to 201.0 s (12 s): `video/assets/04-plan-before-after.png`**

- **Place:** 0, 0, 1920, 1080 (full bleed, native 1920×1080).
- **Source rect at t=0:** (0, 0)–(1920, 1080).
- **Camera:** `scale 1.00 → 1.08, anchor (1420, 330)`, 12 s, `power2.inOut`. At the end the visible source rect is ≈ (531, −170)–(1789, 830): the score card, the plan panel and the right map stay in frame.
- **Callout 1** (t = +2.0 s): 2 px `#E8590C` rounded rect (radius 10) around **source rect (1300, 80)–(1676, 176)** — the `578 ha` / `−32%` / `847 ha if nothing is done` block. A `#FFFFFF` chip 1 px `#E8590C` 24 px at **source rect (1300, 180)–(1676, 226)**: `578 ha with your plan · 847 ha if nothing is done · −32%`.
- **Callout 2** (t = +5.0 s): 2 px `#E8590C` rounded rect around **source rect (1300, 196)–(1660, 246)** — the `210,000 t CO₂e` line — with a `#FFFFFF` chip 1 px `#E8590C` 22 px at **source rect (1300, 246)–(1676, 292)**: `Peat emissions difference — a model estimate, not a measurement`.
- **Callout 3** (t = +8.0 s): 2 px `#E8590C` rounded rect around the grey caveat **source rect (1306, 312)–(1658, 388)**, plus a chip at **source rect (1306, 392)–(1660, 438)**: `The peat map here is synthetic — illustrative only`.

**Beat B — 201.0 s to 212.0 s (11 s): the same asset, panned to the plan panel**

- **Place:** 0, 0, 1920, 1080.
- **Camera:** `scale 1.08, anchor (1420, 330)` → `scale 1.14, anchor (1440, 640)`, 11 s, `power2.inOut`. The visible source rect moves from ≈(531, −170)–(1789, 830) to ≈(520, 66)–(1400, 1013) — the right-hand `Your plan` and `Suggestions` panels fill the frame.
- **Callout 4** (t = +2.0 s into the beat): 2 px `#E8590C` rounded rect around **source rect (1300, 515)–(1660, 745)** — the `Hand crews #1` and `Control line #2` cards — with a chip at **source rect (1300, 748)–(1660, 794)**: `Only resources the commander says exist`.
- **Callout 5** (t = +5.5 s into the beat): 2 px `#E8590C` rounded rect around **source rect (1300, 876)–(1668, 952)** — the cloud-seeding note — with a chip at **source rect (1300, 700)–(1660, 746)**: `Cloud seeding: speculative — kept out of the combined strategy`.

**Beat C — 212.0 s to 216.0 s (4 s): `video/assets/06-3d-terrain.png`**

- **Place:** 0, 0, 1920, 1080 (full bleed).
- **Camera:** `scale 1.00 → 1.07, anchor (760, 520)`, 4 s, `power2.inOut`. Visible source rect ends ≈(263, 15)–(1657, 1024) — both 3D terrain panes stay in frame.
- **Callout:** 2 px `#E8590C` rounded rect around the left terrain plane **source rect (286, 392)–(742, 706)**, plus a chip at **source rect (300, 712)–(740, 758)**: `Same map, draped on real elevation`.
- **Caption text:**
  - 0.0–6.6 s — `The same sealed engine compares firefighting plans:` / `control lines, helicopter drops, hand crews, peat injection.`
  - 6.6–11.8 s — `It only plans with resources the commander says exist.` / `Options resting on placeholder numbers, like cloud seeding, are tagged speculative and kept out.`
  - 11.8–19.6 s — `In the exercise scenario, five hundred seventy-eight hectares burn with the plan` / `against eight hundred forty-seven without: thirty-two percent less.`
  - 19.6–27.0 s — `That difference is a model estimate of about two hundred ten thousand tonnes` / `of carbon dioxide equivalent.`

**Transition to next frame:** `crossfade` 0.5 s at 216.0–216.5 s.

---

## Frame 10 — Impact, honest limits, close

- status: outline
- src: compositions/10-impact-close.html
- duration: 28s
- start: 216.0s
- transition_in: crossfade
- scene: Who it is for, then the two honest limits, then a plain end card.
- voiceover: "Who is it for? Disaster managers, Manggala Agni fire commanders, provincial governments, researchers comparing fire models, and auditors checking what was known. It runs in a browser on free open data; adding a region is a bounding box. Two honest limits: the peat map is synthetic, so carbon numbers are illustrative, and the model's edge is small. That is why every forecast is now on the record. SekatApi — forecasts on the record."
- poster: 24s
- audio: audio/scene-10-impact-close.aiff

**Narration (exact, from `SCRIPT.md` Line 10)**

> Who is it for? Disaster managers, Manggala Agni fire commanders, provincial governments, researchers comparing fire models, and auditors checking what was known. It runs in a browser on free open data; adding a region is a bounding box. Two honest limits: the peat map is synthetic, so carbon numbers are illustrative, and the model's edge is small. That is why every forecast is now on the record. SekatApi — forecasts on the record.

**Visuals**

**Beat A — 216.0 s to 232.0 s (16 s): who it is for**

- **Asset:** none — typeset on `#F7F8FA`.
- Heading 46 px `#1A1A1A` at x 140, y 110: `Who it is for`
- Four cards in a 2×2 grid, x 140 / 1010, y 220 / 400, each 830×150, `#FFFFFF`, radius 14, 1 px `#E0E3E6`, 30 px label + 22 px `#6B7075` sub-label:
  - `Disaster managers` / `national and provincial response`
  - `Manggala Agni commanders` / `where and when to act`
  - `Provincial governments` / `deciding when to act`
  - `Researchers and auditors` / `comparing models; checking what was known`
- Line at y 620, 30 px `#1A1A1A`: `It runs in a browser on free open data.` and at y 670: `Adding a region is a bounding box.`
- **Two honest limits**, y 760–920, two columns at x 140 and x 1010, each with a 4 px `#E8590C` left bar and 26 px text:
  - `The peat map is synthetic, so carbon numbers are illustrative.`
  - `The model's edge over a distance-only forecast is small.`
  - Under them, 24 px `#6B7075`: `That is exactly why every forecast is now on the record.`
- **Camera:** static; cards fade+rise, staggered 0.25 s.

**Beat B — 232.0 s to 244.0 s (12 s): end card**

- **Background:** `#F7F8FA`.
- **Logo:** the real SekatApi mark cropped from `video/assets/01-recorded-fire.png` **source rect (20, 12)–(52, 44)** (32×32), placed at 64×64 at (960, 300) so it is centred on the 1920 canvas. No invented logo.
- **Title**, 96 px `#1A1A1A`, centred, y 400–500: `SekatApi`
- **Tagline**, 40 px `#E8590C`, centred, y 530–580: `Forecasts on the record.`
- **Accent rule**, 3 px `#E8590C`, 240 px wide, centred at (960, 630), drawn left→right over 0.8 s.
- **Footer block**, 26 px `#6B7075`, centred, y 690–830:
  - `Track · Climate Data & Environmental Monitoring`
  - `IEEE ClimateChain Global Hackathon 2026`
  - `[Team]`
  - `[repo URL]`
  - (`[Team]` and `[repo URL]` stay as placeholders until the team supplies them.)
- **Camera:** 0.4 s fade up, title at t = 0.6 s, tagline at t = 1.8 s, rule at t = 2.8 s, footer at t = 3.6 s. The whole card holds, then fades to `#F7F8FA` over the final 0.5 s (no black frame).
- **Caption text:**
  - 0.0–7.2 s — `Who is it for? Disaster managers, Manggala Agni fire commanders,` / `provincial governments, researchers comparing fire models,`
  - 7.2–11.6 s — `and auditors checking what was known.` / `It runs in a browser on free open data; adding a region is a bounding box.`
  - 11.6–19.0 s — `Two honest limits: the peat map is synthetic, so carbon numbers are illustrative,` / `and the model's edge is small.`
  - 19.0–23.0 s — `That is why every forecast is now on the record.`
  - 23.0–28.0 s — `SekatApi — forecasts on the record.`

**Transition out:** fade the last 0.5 s to `#F7F8FA`; end of video at 244.0 s.

---

## Fact check

Every number, claim and label used in the video, and where it comes from. Sources: `video/BRIEF.md` (line numbers as written) and `video/assets/data.json` (JSON paths). Anything not on this list was removed.

| # | Used in the video | Scene | Source |
|---|---|---|---|
| 1 | "In 2015, Indonesia's peat fires released more carbon dioxide per day than the entire United States economy" | 1 | BRIEF.md line 25 ("in 2015 their daily emissions exceeded the entire US economy's (WRI analysis of GFED data)") |
| 2 | "World Resources Institute analysis of the Global Fire Emissions Database" (GFED) | 1 | BRIEF.md line 25 (WRI analysis of GFED data) |
| 3 | "Every dry season, fire commanders act on those forecasts" | 1 | BRIEF.md line 25 ("Every dry season, commanders act on forecasts") |
| 4 | "and nobody keeps score of them" | 1 | BRIEF.md line 25 ("nobody keeps score of them") |
| 5 | Track = Climate Data & Environmental Monitoring | 2, 10 | BRIEF.md line 26 |
| 6 | "Environmental data is fragmented and hard to verify" | 2 | BRIEF.md line 26 |
| 7 | "You cannot prove what a model said before the fire spread" | 2 | BRIEF.md line 26 |
| 8 | "A model can always be tuned until the past looks good" | 2 | BRIEF.md line 26 ("a model can always be tuned to look good on the past") |
| 9 | "nobody knows which forecasts deserve trust" | 2 | **Restatement** of BRIEF.md line 26 |
| 10 | NASA FIRMS, Open-Meteo, AWS terrain, OpenStreetMap as the four sources | 3 | BRIEF.md line 27 |
| 11 | `6.4 × 6.4 km` forecast grid | 3 | BRIEF.md line 37 ("Grid: 6.4 × 6.4 km at 100 m cells") |
| 12 | `100 m` cell size | 3 | BRIEF.md line 37 |
| 13 | `40` simulated runs / 40-run ensemble | 3 | BRIEF.md lines 27 and 37 ("40 ensemble runs") |
| 14 | `24–48 h` horizon | 3 | BRIEF.md line 37 |
| 15 | "the uncertainty is visible" (not one confident line) | 3 | BRIEF.md line 27 ("It runs 40 simulated runs, so the uncertainty is visible") |
| 16 | Recorded West Kalimantan fire, 18 Oct 2026, frozen at the last satellite pass | 4 | BRIEF.md lines 27, 58 (assets table, `01-recorded-fire.png`) |
| 17 | `12 of 18` new fire spots caught | 4 | BRIEF.md line 58; data.json `events[5].newSquares 18`, `events[5].csi 0.41` (Kalimantan, 2026-10-18) |
| 18 | `CSI 0.41` | 4 | BRIEF.md line 58; data.json `events[5].csi 0.41` |
| 19 | `distance-only 0.17` | 4 | BRIEF.md line 58; data.json `events[5].distanceCsi 0.17` |
| 20 | "The white rings are what the satellites saw next" | 4 | BRIEF.md line 58 ("white rings = what satellites saw next") |
| 21 | `2,452` fire detections in Kalimantan in the last 24 h | 4 | BRIEF.md line 59; the figure is on-screen in `video/assets/02-live-fires.png` ("2452 fire detections in Kalimantan in the last 24 h") |
| 22 | Hindcast on `12` real fires, `8–18 Oct 2026` | 5 | BRIEF.md line 28; data.json `events` — 12 entries, `day` values 2026-10-08 … 2026-10-18 |
| 23 | First model spread `~6×` too much fire | 5 | BRIEF.md line 28 ("The first model spread ~6× too much fire") |
| 24 | First model score `0.17` | 5 | BRIEF.md line 28; data.json `pooled.tau3.csi 0.168` |
| 25 | First model distance-only baseline `0.16` | 5 | BRIEF.md line 28; data.json `pooled.tau3.distanceCsi 0.16` |
| 26 | Spread slowed with the parameter chosen on **Kalimantan only** | 5 | BRIEF.md line 28 ("We slowed spread using Kalimantan only") |
| 27 | Held-out Sumatra `0.08` → `0.11` | 5 | BRIEF.md line 28; data.json `heldOutSumatra.tau3.csi 0.076`, `heldOutSumatra.tau6.csi 0.114` |
| 28 | Held-out Sumatra baseline `0.09` | 5 | BRIEF.md line 28; data.json `heldOutSumatra.tau6.distanceCsi 0.093` |
| 29 | Pooled `0.22` vs `0.17` | 5 | BRIEF.md line 28; data.json `pooled.tau6.csi 0.217`, `pooled.tau6.distanceCsi 0.17` |
| 30 | "Small — we say so" (margin over distance-only) | 5 | BRIEF.md line 28 ("Small, and we say so") |
| 31 | `663` squares forecast at τ = 3 h | 5 | data.json `pooled.tau3.forecastSquares 663` |
| 32 | `390` squares forecast at τ = 6 h | 5 | data.json `pooled.tau6.forecastSquares 390` |
| 33 | `114` new squares observed | 5 | data.json `pooled.tau3.observed 114`, `pooled.tau6.observed 114` |
| 34 | "Re-running all 12 hindcasts a day later gave identical counts" | 5 | BRIEF.md line 40 |
| 35 | The register picks the `3` most active fires per island by a fixed rule, applied automatically at issue time | 6 | BRIEF.md line 29; data.json `register.kalimantan 3`, `register.sumatra 3` |
| 36 | "Nobody picks the easy fires" | 6 | **Restatement** of BRIEF.md line 29 ("by a fixed rule") |
| 37 | Each forecast: live scenario, `24 h` forecast, then sealed | 6 | BRIEF.md line 29 |
| 38 | Scored after `24 h` against NASA FIRMS; every forecast stays on the board, good or bad | 7 | BRIEF.md line 29; data.json `register.status "pending"`, `register.scoring "after 2026-10-21 22:40 UTC"` |
| 39 | `SHA-256` hash over every input and every simulated cell | 7 | BRIEF.md line 29 |
| 40 | `Ed25519` signature | 7 | BRIEF.md line 29 |
| 41 | `OpenTimestamps` anchor in Bitcoin | 7 | BRIEF.md line 29 |
| 42 | `6` forecasts sealed on `21 Oct 2026`, `3` Kalimantan + `3` Sumatra, before the outcome existed | 7 | BRIEF.md line 29; data.json `register.sealed 6`, `register.kalimantan 3`, `register.sumatra 3`, `register.sealedAt "2026-10-20T16:38Z to 16:40Z (21 Oct 00:38-00:40 WITA)"` |
| 43 | Terminal text: 6 `ok` lines, `6 forecast(s) exported to proofs/`, `ots verify`, transaction `fc6c3516…`, `waiting for 6 confirmations` | 7 | `video/assets/07-ots-terminal.txt` (referenced by BRIEF.md line 41) |
| 44 | "Bitcoin is a public clock" / "one hash per forecast" | 8 | BRIEF.md line 30 |
| 45 | "No token, no wallet, no fee" | 8 | BRIEF.md line 30 |
| 46 | "A smart contract cannot make a fire model more correct; a deterministic re-run can" | 8 | BRIEF.md line 30 |
| 47 | Four checks: receipt unchanged, inputs unchanged, signature valid, re-run gives the same result | 8 | BRIEF.md line 30; on-screen in `video/assets/05b-record-checks.png` |
| 48 | `47 automated tests pass` (chip, scene 8) | 8 | BRIEF.md line 39 |
| 49 | Plan options: control lines, helicopter drops, hand crews, peat injection | 9 | BRIEF.md line 31 |
| 50 | "Plans only with resources the commander says exist" | 9 | BRIEF.md line 31 |
| 51 | Cloud seeding tagged `speculative` | 9 | BRIEF.md line 31; on-screen in `video/assets/04-plan-before-after.png` |
| 52 | `578 ha` with the plan vs `847 ha` without = `−32%` | 9 | BRIEF.md line 31 and line 62 (assets table, `04-plan-before-after.png`) |
| 53 | `210,000 t CO₂e` difference, described as a **model estimate** | 9 | BRIEF.md line 62; on-screen in `video/assets/04-plan-before-after.png` ("Peat emissions difference, if the forecast is right — 210,000 t CO₂e") |
| 54 | `~800 t CO₂e per hectare` of burned tropical peat, IPCC 2013 Wetlands Supplement, Tier 1 (chart annotation) | 9 | BRIEF.md line 38 |
| 55 | 3D terrain view draped on the scenario's own elevation grid | 9 | BRIEF.md line 62 (assets table, `06-3d-terrain.png`) |
| 56 | Users: disaster managers (BPBD), Manggala Agni commanders, provincial governments, researchers comparing fire models, auditors and carbon-project verifiers | 10 | BRIEF.md line 32 |
| 57 | "Runs in a browser on free open data; adding a region is a bounding box" | 10 | BRIEF.md line 32 |
| 58 | "The peat map is still synthetic, so CO₂ numbers are labelled illustrative" | 10 | BRIEF.md line 33 |
| 59 | "The model's edge is small" | 10 | BRIEF.md line 33 |
| 60 | End card: `SekatApi — forecasts on the record.`, track name, `[Team]`, `[repo URL]` | 10 | BRIEF.md line 33 |
| 61 | SekatApi wordmark used on the end card | 10 | Cropped from `video/assets/01-recorded-fire.png` source rect (20, 12)–(52, 44) — the real app mark, not a redrawn logo |
| 62 | On-screen `376 ha` and `300,000 t CO₂e` in the Frame 4 screenshot (not narrated) | 4 | `video/assets/01-recorded-fire.png`; the screenshot itself states "The peat map here is synthetic, so this number is illustrative only. A model estimate, not a measurement and not a carbon credit." |
| 63 | On-screen `577.7 ha burned, 269.6 ha saved` and key `b9b38e6eeb1111b3` in the Frame 8 screenshot (not narrated) | 8 | `video/assets/05b-record-checks.png` |

**Removed for lack of a source (BRIEF.md / data.json):**

- The exact register selection formula ("ranked by detections + FRP/50") — dropped from the narration and the Frame 6 typeset card; only "a fixed rule" (BRIEF.md line 29) is said. The formula is visible in the register entries themselves, not asserted by the voice-over.
- Any score for the six sealed register forecasts — never stated or shown. `data.json` `register.status` is `"pending"`; the video says "scored after 24 hours" and "results pending" only (BRIEF.md lines 29 and 42).
- "Avoided emissions", "carbon credits", "offsets" — not used anywhere (BRIEF.md lines 38 and 48). The CO₂ figure is always "a model estimate".
- "Requesting aircraft" as a specific provincial-government action — not stated in BRIEF.md, so the users are named from BRIEF.md line 32 without added detail.
- Any claim of safety, guarantees, agency deployment, partnerships, or real users (BRIEF.md line 45).
- Any "AI predicts" framing — the model is a cellular-automaton simulation (BRIEF.md line 47).
