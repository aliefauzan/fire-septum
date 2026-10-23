# SekatApi demo video — build & render report

**Deliverable:** `video/out/sekatapi-demo.mp4`
**Final duration:** **254.70 s (4:14.7)** — inside the brief's 3:30–4:15 window and the task's 210–270 s gate
**Resolution / rate:** 1920×1080, 30 fps, H.264 (2.57 Mbps)
**Audio:** AAC stereo 48 kHz, one continuous voice-over track, no music
**Size:** 81.8 MB
**Captions:** burned in, bottom-centre, ≤2 lines, 33 px white on a `#1A1A1A` pill (bottom edge at y 1018)

Verified with `ffprobe` after the final render:

```
duration=254.700000
stream 0  h264  1920x1080  30/1  duration=254.700000
stream 1  aac   2ch 48 kHz            duration=254.700000
```

Audio was level-checked at ten points (one per scene): mean −15.1 to −16.9 dBFS, max ≈ −2 dBFS, no silent passages.

---

## Scene list and timings

`video/hf/compositions/<id>.html` holds one sub-composition per scene, mounted as a clip in `video/hf/index.html`
(visual track `data-track-index="1"`, narration on `data-track-index="10"`).

| # | Scene | Composition | Start | End | Duration | Storyboard | Narration (WAV) |
|---|-------|-------------|-------|-----|----------|------------|-----------------|
| 1 | Hook — nobody keeps score | `01-hook.html` | 0.0 s | 18.2 s | 18.2 s | 17 s | 17.85 s |
| 2 | The problem — fragmented and unverifiable | `02-problem.html` | 18.2 s | 37.2 s | 19.0 s | 19 s | 17.63 s |
| 3 | What it does — one forecast from live open data | `03-what-it-does.html` | 37.2 s | 63.9 s | 26.7 s | 25 s | 26.37 s |
| 4 | The recorded fire, and live fires | `04-recorded-fire.html` | 63.9 s | 90.9 s | 27.0 s | 27 s | 26.01 s |
| 5 | Honest validation — the hindcast | `05-hindcast.html` | 90.9 s | 123.9 s | 33.0 s | 33 s | 31.88 s |
| 6 | The register rule | `06-register-rule.html` | 123.9 s | 141.9 s | 18.0 s | 18 s | 15.40 s |
| 7 | The seal: hash, signature, Bitcoin | `07-seal-bitcoin.html` | 141.9 s | 174.4 s | 32.5 s | 29 s | 32.20 s |
| 8 | Why Bitcoin — a public clock | `08-why-bitcoin.html` | 174.4 s | 195.4 s | 21.0 s | 21 s | 20.43 s |
| 9 | Decision support — comparing plans | `09-decision-support.html` | 195.4 s | 226.7 s | 31.3 s | 27 s | 30.96 s |
| 10 | Impact, honest limits, close | `10-impact-close.html` | 226.7 s | 254.7 s | 28.0 s | 28 s | 26.28 s |
| | **Total** | | | | **254.7 s** | **244 s** | |

Crossfades (0.4–0.5 s, as per the storyboard) are implemented on the **root** timeline: the outgoing scene's slot
holds its final frame while the incoming scene's slot fades in, so no scene-local timing was shifted.

---

## Commands run

```bash
# 1. scaffold
HYPERFRAMES_SKIP_SKILLS=1 npx --yes hyperframes@latest init video/hf \
  --non-interactive --example=blank --resolution=landscape --skill=general-video

# 2. narration (one file per scene)
cd video/hf/audio
for f in text/scene-*.txt; do
  n=$(basename "$f" .txt)
  say -v Samantha -r 165 -o "$n.aiff" -f "$f"
  ffmpeg -y -i "$n.aiff" -ar 44100 -ac 1 "$n.wav"
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$n.wav"
done
# trailing silence trimmed from each WAV:
ffmpeg -y -i "$n.wav" -af "areverse,silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB,areverse" out.wav

# 3. composition (scenes are generated from one source of truth)
cd video/hf && node tools/build.mjs        # writes index.html + compositions/*.html

# 4. gates
cd video/hf && npx --yes hyperframes@0.8.181 lint          # 0 errors, 0 warnings
cd video/hf && npx --yes hyperframes@0.8.181 check --samples 12   # Check passed (lint/runtime/layout/motion/contrast)
cd video/hf && npx --yes hyperframes@0.8.181 snapshot --at 8,26,50,70,82,100,130,150,168,180,205,218,228,240,250

# 5. render
cd video/hf && npx --yes hyperframes@0.8.181 render --quality high --output ../out/sekatapi-demo.mp4
#   → video/out/sekatapi-demo.mp4 · 4m 14.7s · 2m 2.1s

# 6. verify
ffprobe -v error -show_entries format=duration,size -of default=nw=1 video/out/sekatapi-demo.mp4
ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,channels \
  -of default=nw=1 video/out/sekatapi-demo.mp4
ffmpeg -y -ss <t> -i video/out/sekatapi-demo.mp4 -frames:v 1 video/out/frame-<p>pct.png   # 10/35/60/90 %
ffmpeg -hide_banner -nostats -ss <t> -t 3 -i video/out/sekatapi-demo.mp4 -af volumedetect -f null -
```

Extracted proof frames: `video/out/frame-10pct.png` (25.47 s), `frame-35pct.png` (89.14 s),
`frame-60pct.png` (152.82 s), `frame-90pct.png` (229.23 s). All four were inspected: no blank frames, no
overflowing type, captions legible and inside the frame.

---

## Facts used

Every number on screen comes from `video/assets/data.json`, `video/assets/07-ots-terminal.txt` or `video/BRIEF.md`;
the storyboard's fact-check table was followed line by line.

- Hindcast: pooled τ=3 h → 0.17 (distance-only 0.16); τ=6 h → 0.22 (distance-only 0.17).
  Held-out Sumatra: 0.08 → 0.11, baseline 0.09. Forecast squares 663 / 390, observed 114.
- Recorded West Kalimantan fire, 18 Oct 2026: 12 of 18 new fire spots caught, CSI 0.41 vs distance-only 0.17.
- Live Kalimantan detections: 2,452 in the last 24 h.
- Register: 6 sealed (3 Kalimantan, 3 Sumatra) on 21 Oct 2026; **no score is shown or claimed** — the video says
  "scored after 24 h / waiting for the first 24 h windows to close", matching `register.status: "pending"`.
- Terminal panel reproduces `07-ots-terminal.txt` verbatim (including `fc6c3516…` and "waiting for 6 confirmations").
- Grid 6.4 × 6.4 km / 100 m cells / 40 runs / 24–48 h; 47 automated tests pass.
- Plan scenario: 578 ha with the plan vs 847 ha without (−32 %); ~210,000 t CO₂e always described as a
  **model estimate**, never as avoided emissions or credits.
- No safety, guarantee, deployment, partnership or "AI predicts" claim appears anywhere.

---

## Deviations from the storyboard

**Timing (as instructed in step 2 — narration longer than the slot ⇒ lengthen the scene):**

1. Scenes 1, 3, 7 and 9 were stretched to fit their narration: 17→18.2 s, 25→26.7 s, 29→32.5 s, 27→31.3 s
   (+10.7 s total, 244 s → 254.7 s). Scene 6's narration is 2.6 s shorter than its slot; that silence is kept as a beat.

**Layout (all driven by the burned-in caption band at y 917–1018):**

2. Content the storyboard placed below y ≈ 915 was moved up so nothing sits under a caption:
   scene 1's lower stat band (820–930 → 776–887); scene 5's footer notes (916/950 → one row at 882, two items side by side);
   scene 6's register sheet (×1.28 → ×1.12–×1.18, so its lower edge clears the band);
   scene 8's record panel (×1.067 → ×0.96–×1.02).
3. Scene 1 headline set to 68 px over a 1400 px measure (storyboard: 76 px / 1180 px) so the three-line headline
   clears the accent rule at y 448; rule and sub-line flow below it.
4. Scene 5's "about 6× too much fire" note moved to the right of the bar labels (it would otherwise overlap "τ = 3 h — 663 forecast").
5. Scene 9's Beat A camera re-anchored: the storyboard's `scale 1.00 → 1.08, anchor (1420, 330)` slices the app's own
   header bar off the top of the frame at the end of the beat. The video uses the same anchor convention with
   anchor (1420, 430) and scale 1.00 → 1.05, so the title bar stays readable; Beat B then pushes into the
   "Your plan" panel (scale 1.05 → 1.14) and Beat C's 3-D terrain camera was recomputed for anchor (760, 520).
6. Scene 9 callouts 4 and 5 keep the storyboard's +2.0 s / +5.5 s offsets but sit at source y 754 / 790 so they
   clear the caption band once the camera has settled.
7. Scene 10: the closing line "That is exactly why every forecast is now on the record." moved from the foot of
   Beat A onto the end card, where it matches caption 4 (19–23 s). End-card footer moved 690 → 712 to make room.
8. Scene 2: the dashed "no record of what was forecast" node is excluded from the node stagger so it fades in
   last, at 8.5 s, exactly as the storyboard specifies.
9. Scene 6 / scene 8 callout chips are set at 17–22 px rather than a flat 22 px: the storyboard's chip boxes
   (434–630 px wide) cannot hold the full chip text at 22 px, so the chips extend past the sheet onto the canvas.
10. Scene 3's 8×8 grid is a schematic: base cells `#EDEFF1`, 9 cells `#E8590C` at 60 % opacity and 4 at full opacity,
    arranged as a spread. The storyboard does not say which cells ignite.

**Narration text:**

11. For the TTS only, "SHA-256" and "Ed25519" are written as "SHA two hundred fifty six" and "Ed twenty-five
    nineteen" so the voice reads them predictably. The burned-in captions and all on-screen type use the
    standard spellings "SHA-256" and "Ed25519".

**Tooling notes:**

12. The scene HTML is generated from `video/hf/tools/build.mjs` + `tools/scenes.mjs` (one source of truth for the
    timeline, captions and layout) so timings stay consistent between the composition and the render.
    The generated `index.html` and `compositions/*.html` are the delivered artefacts.
13. The storyboard's "visible source rect" figures for the scene 4 and scene 9 cameras are approximate and
    internally inconsistent (e.g. the x half-width corresponds to a different scale than the y half-width).
    The video uses the convention the storyboard defines for them — *the source pixel (x, y) stays at the centre
    of the 1920×1080 frame* — and every callout still lands on the UI element it names.
14. `inter` is bundled locally (`video/hf/assets/fonts/`) so the render never depends on a font CDN.
15. Post-review fix (Claude Code, 21 Oct): the scene 1 label under "2015" said "the year of the peak
    emissions", which BRIEF.md does not support. It now reads "the fire season measured". Re-rendered with
    the same command; nothing else changed.
16. Known, accepted: about 2.6 s without narration at 139.3–141.9 s (the cut from scene 6 into scene 7).

---

## Project layout

```
video/
  BRIEF.md  STORYBOARD.md  SCRIPT.md            (inputs, unmodified)
  assets/                                      (inputs, unmodified)
  hf/                                           (HyperFrames project — scaffold + build)
    index.html                                  10 sub-composition slots + narration audio track
    compositions/01-hook.html … 10-impact-close.html
    tools/build.mjs, tools/scenes.mjs           scene generator
    audio/scene-NN-*.aiff, *.wav, text/*.txt    narration (macOS say → ffmpeg → wav)
    assets/                                     copies of the screenshots + Inter woff2 + sekatapi-mark.png
  out/
    sekatapi-demo.mp4                           the deliverable
    frame-10pct.png  frame-35pct.png  frame-60pct.png  frame-90pct.png
    REPORT.md
```
