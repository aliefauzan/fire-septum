/**
 * build.mjs — generates the SekatApi demo composition (index.html + compositions/*.html)
 *
 * Run: node tools/build.mjs
 *
 * Timeline is derived from STORYBOARD.md; scene durations are stretched where the
 * generated narration is longer than the storyboard slot (see video/out/REPORT.md).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SCENES as SCENE_DEFS } from "./scenes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, "..");

/* ------------------------------------------------------------------ tokens */

const C = {
  canvas: "#F7F8FA",
  surface: "#FFFFFF",
  ink: "#1A1A1A",
  ink2: "#6B7075",
  line: "#E0E3E6",
  line2: "#C9CED2",
  accent: "#E8590C",
  base: "#EDEFF1",
};

const BASE_CSS = `
      #root {
        position: absolute;
        inset: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: ${C.canvas};
        color: ${C.ink};
        font-family: Inter, -apple-system, "Helvetica Neue", Arial, sans-serif;
        font-variant-numeric: tabular-nums;
        -webkit-font-smoothing: antialiased;
      }
      .stage { position: absolute; inset: 0; }
      .card {
        position: absolute;
        background: ${C.surface};
        border: 1px solid ${C.line};
        border-radius: 16px;
      }
      .capwrap {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 62px;
        height: 0;
        z-index: 90;
      }
      .cap {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        text-align: center;
        opacity: 0;
      }
      .cap .pill {
        display: inline-block;
        max-width: 1500px;
        padding: 11px 26px;
        border-radius: 12px;
        background: #1a1a1a;
        color: #ffffff;
        font-size: 33px;
        font-weight: 500;
        line-height: 1.2;
        letter-spacing: -0.01em;
        text-align: center;
      }
      .chip {
        position: absolute;
        background: ${C.surface};
        border: 1px solid ${C.accent};
        border-radius: 10px;
        color: ${C.ink};
        font-weight: 500;
        white-space: nowrap;
        line-height: 1.15;
        padding: 9px 16px;
        z-index: 20;
      }
      .shotwrap {
        position: absolute;
        left: 0;
        top: 0;
        width: 1920px;
        height: 1080px;
        transform-origin: 0 0;
      }
      .shotimg {
        position: absolute;
        left: 0;
        top: 0;
        width: 1920px;
        height: 1080px;
        display: block;
      }
      .ovl { position: absolute; left: 0; top: 0; overflow: visible; }
      .mono {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      }
`;

/* -------------------------------------------------------------- scene data */

// scene order = storyboard order.
// dur   : scene length in seconds (stretched where narration is longer)
// fade  : length of the crossfade that brings this scene in (0 = hard cut)
// narration lengths measured with ffprobe (video/hf/audio/*.wav)
const AUDIO_DUR = {
  "01-hook": 17.85,
  "02-problem": 17.63,
  "03-what-it-does": 26.37,
  "04-recorded-fire": 26.01,
  "05-hindcast": 31.88,
  "06-register-rule": 15.4,
  "07-seal-bitcoin": 32.2,
  "08-why-bitcoin": 20.43,
  "09-decision-support": 30.96,
  "10-impact-close": 26.28,
};

const SCENES = SCENE_DEFS.map((s) => ({ ...s, audioDur: AUDIO_DUR[s.id] }));

/* --------------------------------------------------------------- utilities */

const n = (v) => Number(v.toFixed(3));

function sceneStart(index) {
  let t = 0;
  for (let i = 0; i < index; i += 1) t += SCENES[i].dur;
  return n(t);
}

/** Caption markup for a scene. */
function capMarkup(scene) {
  return scene.caps
    .map(
      (c, i) =>
        `<span class="cap" id="c${scene.id}-cap${i + 1}"><span class="pill">${c[2]}</span></span>`,
    )
    .join("\n          ");
}

/** Caption timeline calls for a scene. */
function capJs(scene) {
  const lines = [];
  scene.caps.forEach((c, i) => {
    const sel = `#c${scene.id}-cap${i + 1}`;
    const t0 = c[0];
    const t1 = Math.min(c[1], scene.dur - 0.02);
    const fadeIn = 0.28;
    const fadeOut = 0.28;
    const outAt = Math.max(t0 + fadeIn + 0.02, t1 - fadeOut);
    lines.push(`  tl.set("${sel}", { opacity: 0 }, 0);`);
    lines.push(
      `  tl.fromTo("${sel}", { opacity: 0 }, { opacity: 1, duration: ${fadeIn}, ease: "none" }, ${n(t0)});`,
    );
    lines.push(
      `  tl.to("${sel}", { opacity: 0, duration: ${fadeOut}, ease: "none" }, ${n(outAt)});`);
  });
  return lines.join("\n");
}

function sceneFile(scene) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <template id="${scene.id}-template">
      <style>
${BASE_CSS}
${scene.css || ""}
      </style>
      <div id="root" data-composition-id="${scene.id}" data-width="1920" data-height="1080" data-duration="${scene.dur}">
        <div class="stage">
${scene.html}
          <div class="capwrap">
          ${capMarkup(scene)}
          </div>
        </div>
      </div>
      <script>
        const tl = gsap.timeline({ paused: true });
${capJs(scene)}
${scene.js || ""}
        window.__timelines["${scene.id}"] = tl;
      </script>
    </template>
  </body>
</html>
`;
}

/* ------------------------------------------------------------------- index */

function buildIndex() {
  const slots = [];
  const audios = [];
  const fades = [];

  SCENES.forEach((scene, i) => {
    const start = sceneStart(i);
    const next = SCENES[i + 1];
    const extra = next ? next.fade : 0;
    const slotDur = n(scene.dur + extra);
    slots.push(
      `      <div
        id="el-${scene.id}"
        data-composition-id="${scene.id}"
        data-composition-src="compositions/${scene.file}"
        data-start="${start}"
        data-duration="${slotDur}"
        data-track-index="1"
        data-width="1920"
        data-height="1080"
      ></div>`,
    );
    if (scene.fade > 0) {
      fades.push(
        `      tl.fromTo("#el-${scene.id}", { opacity: 0 }, { opacity: 1, duration: ${scene.fade}, ease: "none" }, ${start});`,
      );
    }
    audios.push(
      `      <audio
        id="aud-${scene.id}"
        src="audio/scene-${scene.id}.wav"
        data-start="${start}"
        data-duration="${scene.audioDur}"
        data-track-index="10"
      ></audio>`,
    );
  });

  const total = n(SCENES.reduce((a, s) => a + s.dur, 0));

  return `<!doctype html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      @font-face {
        font-family: "Inter";
        font-style: normal;
        font-weight: 400;
        font-display: block;
        src: url("assets/fonts/inter-400.woff2") format("woff2");
      }
      @font-face {
        font-family: "Inter";
        font-style: normal;
        font-weight: 500;
        font-display: block;
        src: url("assets/fonts/inter-500.woff2") format("woff2");
      }
      @font-face {
        font-family: "Inter";
        font-style: normal;
        font-weight: 600;
        font-display: block;
        src: url("assets/fonts/inter-600.woff2") format("woff2");
      }
      @font-face {
        font-family: "Inter";
        font-style: normal;
        font-weight: 700;
        font-display: block;
        src: url("assets/fonts/inter-700.woff2") format("woff2");
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        margin: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: ${C.canvas};
      }
      #root {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: ${C.canvas};
      }
      #root > div[data-composition-src] { position: absolute; inset: 0; }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${total}"
      data-width="1920"
      data-height="1080"
    >
${slots.join("\n\n")}

${audios.join("\n")}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
${fades.join("\n")}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

/* ------------------------------------------------------------------- main */

mkdirSync(join(PROJECT, "compositions"), { recursive: true });

for (const scene of SCENES) {
  const file = join(PROJECT, "compositions", scene.file);
  writeFileSync(file, sceneFile(scene), "utf8");
  console.log(`wrote compositions/${scene.file}`);
}

writeFileSync(join(PROJECT, "index.html"), buildIndex(), "utf8");
console.log("wrote index.html");
console.log(`total duration: ${n(SCENES.reduce((a, s) => a + s.dur, 0))}s`);
SCENES.forEach((s, i) =>
  console.log(
    `  ${s.id.padEnd(22)} start=${String(sceneStart(i)).padStart(7)}  dur=${s.dur}`,
  ),
);
