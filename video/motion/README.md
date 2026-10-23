# SekatApi — motion assets (`video/motion`)

The project's motion, rebuilt as code and verified frame by frame with the
[motion2code](https://github.com/lovisdotio/motion2code) skill (video → SVG + GSAP).

Two deliverables, in the same shape as the skill's gallery entries:

| File | What it is |
|------|------------|
| `index.html` | **the replay** — 10 KB, self-contained, inline SVG, one GSAP timeline, `window.anim` contract, loops forever |
| `compare.html` | source vs. code side by side, synced to the source clock (frame stepping, onion skin) — the skill's template, unchanged |
| `site.html` | **the real site** — the same drawings made usable: real scroll, real buttons, keyboard, reduced motion, responsive |
| `source.mp4` | the source clip, 480p, no audio (the gallery asset) |
| `poster.gif` | 5 s, 480 px wide, 58 KB |
| `motion.mp4` | the coded loop rendered frame-exact through `anim.seek` (9.58 s, 24 fps, 1920×1080) |
| `side_by_side.mp4` | the proof: source render left, coded loop right |
| `source-scene02.mp4` | the full 19 s scene render the source clip was cut from |
| `source/` | the HyperFrames project that renders the source (one scene, captions suppressed) and the 1080p source cut |
| `study/` | `study_video.py` output: frames every 0.25 s, contact sheet, palette, loop score |
| `diff/`, `diff-480/` | `frame_diff.py` output: source\|code pairs, per-time scores, sheets; `diff/t-*/` is the frame-by-frame pass over every transition |
| `tools/` | `measure.py` (measures the source scene's text geometry in a browser), `check_site.py` (drives the site), `shots/` (the site's screenshots) |
| `SHOTLIST.md` | the shot list the build follows, with the measured geometry |

## The piece

A seamlessly looping 1920×1080 beat that tells the project's problem in one gesture:
**hotspots → forecast → decision → *no record of what was forecast*.** The chain arrives, the
gap appears as a dashed node, the orange rule draws itself under the gap, and then the chain
unwinds back to the opening frame.

`site.html` puts the same drawing at the top of a real landing page for the project, with a
scroll-scrubbed "sealing is three things" scene, the hindcast numbers, the forecast register
and the honest limits.

## How it was made

```bash
# 1. source: render the project's own scene, narration captions suppressed
cd video/motion/source
npx --yes hyperframes@0.8.181 render --quality high --output ../source-scene02.mp4

# 2. cut the piece out of it (2.9 s -> 12.5 s of the scene)
ffmpeg -i source-scene02.mp4 -ss 2.9 -t 9.6 -c:v libx264 -crf 18 -pix_fmt yuv420p source/source-1080p.mp4
ffmpeg -i source/source-1080p.mp4 -vf scale=854:480 -c:v libx264 -crf 26 -an source.mp4

# 3. study the source
python3 ~/.agents/skills/motion2code/scripts/study_video.py source.mp4 -o study/

# 4. build the code (index.html), then check it against the source
python3 ~/.agents/skills/motion2code/scripts/frame_diff.py source/source-1080p.mp4 index.html -o diff/
python3 ~/.agents/skills/motion2code/scripts/check_anim.py index.html --runtime

# 5. proofs
python3 ~/.agents/skills/motion2code/scripts/render_anim.py index.html -o motion.mp4
python3 ~/.agents/skills/motion2code/scripts/render_anim.py index.html --gif poster.gif \
  --gif-range 0 5 --gif-width 480 --gif-fps 24 --gif-colors 256
python3 ~/.agents/skills/motion2code/scripts/side_by_side.py source/source-1080p.mp4 motion.mp4 \
  -o side_by_side.mp4 --html index.html --left "Source · project render" --right "Code · SVG + GSAP"

# 6. the site
python3 tools/check_site.py
```

## What was checked

**`frame_diff.py` — source vs. code, mean difference per time (0 = identical, 255 = opposite):**

| pass | samples | worst | where |
|------|---------|-------|-------|
| every 0.5 s, whole clip (1080p source) | 20 | **0.95** | 9.5 s |
| frame by frame (1/30 s) over the three node arrivals, 1.05–2.35 s | 40 | **0.45** | 1.15 s |
| frame by frame over the ghost node, 5.55–6.35 s | 25 | **0.44** | 5.82 s |
| frame by frame over the accent bar, 7.05–7.85 s | 25 | **0.43** | 7.12 s |
| frame by frame over the loop seam, 9.30–9.60 s | 10 | **0.95** | 9.5 s |
| every 0.5 s against the 480p gallery source | 20 | 2.49 | 9.5 s |

The body of the piece scores **0.42–0.45** against the 1080p source, i.e. the coded frames are
pixel-identical to the source render apart from antialiasing. Against the 480p source the
score rises to ~2.1, which is the rescaling of the source, not a change in the code. The pairs
in `diff/` were opened and checked by eye, not just scored.

**`check_anim.py index.html --runtime`:**

```
[ok] index.html  duration=9.6  seam_end=0.0  seam_last_frame=0.0  determinism=0.0  start_vs_mid=0.38
   warn:  frame at mid-duration equals frame 0: is anything animating?
```

- `seam_end = 0.0` — the frame at `t = duration` is the frame at `t = 0`.
- `seam_last_frame = 0.0` — the last frame before the wrap is the opening frame too, so nothing jumps.
- `determinism = 0.0` — seeking to the same time always gives the same image.
- The one warning is a false positive: at mid-duration the three small node boxes are the only
  difference from the opening frame, which averages out below the checker's 0.5 threshold. The
  piece is animating (the per-frame diffs above prove it).

**`check_anim.py site.html`** — clean, no external asset outside the allowlist.

**`tools/check_site.py`** — the site driven with Playwright at 1920×1080 and 375×812: every
section scrolled, the pinned scene scrubbed, the menu opened, closed with Escape and closed
with a link click, the card flipped, the tabs moved with the arrow keys, the slider dragged
with the mouse and moved with the arrow keys, the register counter incremented. Result: **no
console errors, no horizontal overflow, every control works** (screenshots in `tools/shots/`).
The test also caught a real bug: the hero is transformed by GSAP, which promoted it into the
positioned paint layer and put it over the fixed menu panel on phones (`nav.panel` now has
`z-index: 30`).

## Honest differences from the source

1. **The return (8.35–9.50 s) has no counterpart in the source.** The source clip holds on the
   finished chain for its last 1.8 s. The coded piece spends that hold unwinding the chain back
   to its opening frame, which is what makes the loop seamless. This is the only intended
   visual difference, and it is where the diff score rises (0.64 at 9.0 s, 0.95 at 9.5 s).
   Everything before 8.35 s matches the source.
2. **The source is 30 fps, the code is frame-exact at any rate.** `motion.mp4` was rendered at
   24 fps through `anim.seek`, so it is 9.58 s, not 9.60 s: 230 frames at 24 fps. The page
   itself is 9.6 s.
3. **Type is Inter from Google Fonts, subset to the letters used.** The source render used the
   project's own bundled Inter. Both are Inter and the glyph positions match, but the source's
   HTML layout rounds each glyph advance to whole pixels while the SVG text does not, so the
   headline ends ~9 px (0.7 %) further right in the source. The code compensates with
   `word-spacing: 2` on the headline, which brings the word positions back in line (measured:
   every text block is now within 1 px of the source).
4. **The burnt-in narration captions are gone.** They belong to the 4:14 demo video; the source
   clip was rendered with `.capwrap` hidden and the loop has no captions.
5. **`site.html` is a new page, not a rebuild of a recording.** The source clip is a motion
   design beat, not a screen recording, so the real site is built from the replay's drawings
   and the project's own facts rather than from a recorded interface. The numbers on it come
   from `video/assets/data.json`; the emissions figure is labelled a model estimate, and the
   register card says out loud that it is a local board.

## How to view it

```bash
cd video/motion
python3 -m http.server 8000
# http://127.0.0.1:8000/index.html     the loop, playing and looping
# http://127.0.0.1:8000/compare.html   source vs. code, synced
# http://127.0.0.1:8000/site.html      the real site
```

`index.html?t=6.5` freezes the piece at 6.5 s; `?external=1` lets a driver take over.
