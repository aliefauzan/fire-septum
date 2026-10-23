# Shot list — SekatApi motion loop

**Source:** `source.mp4` — 1920×1080, 30 fps, 9.60 s, cut from the project's own
HyperFrames render of the demo scene "02-problem" (the project demo video, rendered
with the burnt-in narration captions suppressed, cut from 2.9 s to 12.5 s of that scene).

**Stage:** 1920×1080. **Duration:** 9.60 s. **Loop:** the piece returns to its own
opening frame — the last 1.25 s is the return (added in code; the source only holds).

**Palette** (sampled from the render, matches the project tokens):
`#F7F8FA` canvas · `#FFFFFF` surface · `#1A1A1A` ink · `#6B7075` ink-2 ·
`#E0E3E6` hairline · `#C9CED2` arrow / dashed border · `#E8590C` fire accent ·
`#8A9096` ghost text. **Type:** Inter 400 / 500 / 600 / 700.

**Geometry** (measured in the browser from the source DOM, not guessed):
badge 140,116 · 511.36×48 r24 · headline 140,190 two lines, baselines 244.2 / 312.59 ·
chips 140/540/940, 396, 360×100 r14, title baseline 440.1, sub baseline 473.2 ·
diagram origin 140,560 · nodes 140/460/780/1100, 560, 260×110 r14, baseline 623.5
(ghost node two lines 608.5 / 638.5) · orange bar 1100,686, 260×3.

| # | time (s) | what happens | easing |
|---|---------|--------------|--------|
| 1 | 0.00 – 1.10 | **hold** — badge, two-line headline, three problem chips, three arrow marks. No nodes yet: this is the opening frame. | — |
| 2 | 1.10 – 1.70 | node 1 "Hotspot map" fades in and rises 16 px | power3.out |
| 3 | 1.40 – 2.00 | node 2 "Forecast" fades in and rises 16 px | power3.out |
| 4 | 1.70 – 2.30 | node 3 "Decision" fades in and rises 16 px | power3.out |
| 5 | 5.60 – 6.30 | ghost node 4 "no record of what was forecast" (dashed 2 px border, grey text) fades in and rises 16 px; the dashed link into it slides its dash offset 60 → 0 | power3.out / power2.out |
| 6 | 7.10 – 7.80 | the orange bar (#E8590C, 260×3) draws itself under the gap, growing from its left edge | power3.out |
| 7 | 7.80 – 8.35 | **hold** — the full chain: hotspots → forecast → decision → no record | — |
| 8 | 8.35 – 9.50 | **the return (added in code)** — the bar retracts, the ghost node and the dashed link dissolve, then the three nodes dissolve in reverse order | power2.in / power2.inOut |
| 9 | 9.50 – 9.60 | **hold** on the opening frame, so the wrap is invisible | — |

Shot 8 has no counterpart in the source: the source clip holds on the finished chain
from 7.80 s to the end. The return replaces that hold, which is what makes the loop
seamless (`frame(9.60) === frame(0)`).
