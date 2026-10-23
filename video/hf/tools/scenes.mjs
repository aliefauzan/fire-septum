/**
 * Scene definitions for the SekatApi demo.
 * Each scene: { id, file, dur, fade, caps:[ [t0,t1,html], ... ], css, html, js }
 * `dur` is the scene length in seconds; `fade` is the length of the crossfade
 * that brings the scene in (0 = hard cut).
 */

/* ------------------------------------------------------------ scene 01 — hook */

const s01 = {
  id: "01-hook",
  file: "01-hook.html",
  dur: 18.2,
  fade: 0,
  caps: [
    [
      0.0,
      5.4,
      "In 2015, Indonesia's peat fires released more carbon dioxide per day<br>than the entire United States economy.",
    ],
    [
      5.4,
      9.8,
      "A World Resources Institute analysis of the Global Fire Emissions Database.",
    ],
    [
      9.8,
      17.0,
      "Every dry season, fire commanders act on those forecasts,<br>and nobody keeps score of them.",
    ],
  ],
  css: `
      .s1-top { position: absolute; left: 140px; top: 138px; width: 1400px; }
      .s1-eyebrow {
        font-size: 24px; font-weight: 600; letter-spacing: 0.16em; color: #6b7075;
        margin-bottom: 36px;
      }
      .s1-head {
        font-size: 68px; font-weight: 700; line-height: 1.15; letter-spacing: -0.022em;
      }
      .s1-rule {
        width: 420px; height: 4px; background: #e8590c; margin-top: 28px;
        transform-origin: 0 50%;
      }
      .s1-sub { font-size: 30px; color: #6b7075; margin-top: 28px; }
      .s1-call {
        font-size: 68px; font-weight: 700; letter-spacing: -0.022em; margin-top: 48px;
      }
      .s1-call .acc { color: #e8590c; }
      .s1-band { position: absolute; left: 140px; top: 776px; width: 1440px; height: 110px; }
      .s1-stat { position: absolute; top: 0; }
      .s1-a { left: 0; }
      .s1-b { left: 560px; }
      .s1-c { left: 1040px; }
      .s1-vr { position: absolute; top: 6px; width: 1px; height: 96px; background: #e0e3e6; }
      .s1-num { font-size: 62px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
      .s1-lab { font-size: 20px; color: #6b7075; margin-top: 14px; }
  `,
  html: `
          <div class="s1-top">
            <div class="s1-eyebrow">IEEE CLIMATECHAIN GLOBAL HACKATHON 2026</div>
            <div class="s1-head">In 2015, Indonesia&rsquo;s peat fires released more carbon dioxide per day than the entire United States economy.</div>
            <div class="s1-rule" id="s01-rule"></div>
            <div class="s1-sub">World Resources Institute analysis of the Global Fire Emissions Database (GFED)</div>
            <div class="s1-call"><span class="acc">Nobody keeps score</span> of those forecasts.</div>
          </div>
          <div class="s1-band">
            <div class="s1-vr" style="left:520px;"></div>
            <div class="s1-vr" style="left:1000px;"></div>
            <div class="s1-stat s1-a">
              <div class="s1-num">2015</div>
              <div class="s1-lab">the fire season measured</div>
            </div>
            <div class="s1-stat s1-b">
              <div class="s1-num">per day</div>
              <div class="s1-lab">emissions, not per year</div>
            </div>
            <div class="s1-stat s1-c">
              <div class="s1-num">Indonesia</div>
              <div class="s1-lab">drained tropical peat</div>
            </div>
          </div>`,
  js: `
  tl.fromTo("#s01-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: "power3.out" }, 3.4);
  tl.fromTo(".s1-eyebrow", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 0.2);
  tl.fromTo(".s1-head", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.85, ease: "power3.out" }, 0.55);
  tl.fromTo(".s1-sub", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 5.4);
  tl.fromTo(".s1-call", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.85, ease: "power3.out" }, 9.8);
  tl.fromTo(".s1-stat", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", stagger: 0.18 }, 1.7);
  tl.fromTo(".s1-top, .s1-band", { y: 24 }, { y: 0, duration: 18, ease: "power1.out" }, 0);
`,
};

/* --------------------------------------------------------- scene 02 — problem */

const s02 = {
  id: "02-problem",
  file: "02-problem.html",
  dur: 19,
  fade: 0,
  caps: [
    [
      0.0,
      6.4,
      "This is a Climate Data and Environmental Monitoring track build,<br>and the problem is familiar: environmental data is fragmented and hard to verify.",
    ],
    [
      6.4,
      11.4,
      "You cannot prove what a model said before the fire spread.<br>And a model can always be tuned until the past looks good.",
    ],
    [11.4, 19.0, "So nobody knows which forecasts deserve trust."],
  ],
  css: `
      .s2-badge {
        position: absolute; left: 140px; top: 116px;
        background: #ffffff; border: 1px solid #e0e3e6; border-radius: 999px;
        padding: 11px 24px; font-size: 20px; font-weight: 500;
      }
      .s2-head {
        position: absolute; left: 140px; top: 190px; width: 1240px;
        font-size: 60px; font-weight: 700; line-height: 1.14; letter-spacing: -0.022em;
      }
      .s2-chips { position: absolute; left: 140px; top: 396px; width: 1160px; display: flex; gap: 40px; }
      .s2-chip {
        width: 360px; height: 100px; background: #ffffff; border: 1px solid #e0e3e6;
        border-radius: 14px; padding: 18px 22px;
      }
      .s2-chip .t { font-size: 26px; font-weight: 600; letter-spacing: -0.01em; }
      .s2-chip .s { font-size: 18px; color: #6b7075; margin-top: 8px; line-height: 1.3; }
      .s2-diagram { position: absolute; left: 140px; top: 560px; width: 1220px; height: 210px; }
      .s2-node {
        position: absolute; top: 0; width: 260px; height: 110px; background: #ffffff;
        border: 1px solid #e0e3e6; border-radius: 14px; display: flex; align-items: center;
        justify-content: center; font-size: 24px; text-align: center; padding: 0 18px; line-height: 1.25;
      }
      .s2-n1 { left: 0; }
      .s2-n2 { left: 320px; }
      .s2-n3 { left: 640px; }
      .s2-n4 { left: 960px; border: 2px dashed #c9ced2; color: #8a9096; }
      .s2-svg { position: absolute; left: 0; top: 0; }
      .s2-under {
        position: absolute; left: 960px; top: 126px; width: 260px; height: 3px;
        background: #e8590c; transform-origin: 0 50%;
      }
  `,
  html: `
          <div class="s2-badge">Track &middot; Climate Data &amp; Environmental Monitoring</div>
          <div class="s2-head">Environmental data is fragmented and hard to verify.</div>
          <div class="s2-chips">
            <div class="s2-chip">
              <div class="t">Fragmented</div>
              <div class="s">hotspots, weather, terrain, roads</div>
            </div>
            <div class="s2-chip">
              <div class="t">Hard to verify</div>
              <div class="s">no shared, checkable record</div>
            </div>
            <div class="s2-chip">
              <div class="t">Tunable after the fact</div>
              <div class="s">a hindcast can be made to look good</div>
            </div>
          </div>
          <div class="s2-diagram">
            <svg class="s2-svg" width="1220" height="210" viewBox="0 0 1220 210">
              <line id="s02-a1" x1="262" y1="55" x2="312" y2="55" stroke="#c9ced2" stroke-width="2"/>
              <polygon id="s02-p1" points="312,48 326,55 312,62" fill="#c9ced2"/>
              <line id="s02-a2" x1="582" y1="55" x2="632" y2="55" stroke="#c9ced2" stroke-width="2"/>
              <polygon id="s02-p2" points="632,48 646,55 632,62" fill="#c9ced2"/>
              <line id="s02-a3" x1="902" y1="55" x2="950" y2="55" stroke="#c9ced2" stroke-width="2" stroke-dasharray="7 7"/>
              <polygon id="s02-p3" points="950,48 964,55 950,62" fill="#c9ced2"/>
            </svg>
            <div class="s2-node s2-n1">Hotspot map</div>
            <div class="s2-node s2-n2">Forecast</div>
            <div class="s2-node s2-n3">Decision</div>
            <div class="s2-node s2-n4" id="s02-n4">no record of what was forecast</div>
            <div class="s2-under" id="s02-under"></div>
          </div>`,
  js: `
  tl.fromTo(".s2-badge", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0.2);
  tl.fromTo(".s2-head", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }, 0.5);
  tl.fromTo(".s2-chip", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", stagger: 0.3 }, 1.6);
  tl.fromTo(".s2-n1, .s2-n2, .s2-n3", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", stagger: 0.3 }, 4.0);
  tl.fromTo("#s02-n4", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 8.5);
  tl.fromTo("#s02-a3", { strokeDashoffset: 60 }, { strokeDashoffset: 0, duration: 0.7, ease: "power2.out" }, 8.5);
  tl.fromTo("#s02-under", { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: "power3.out" }, 10.0);
`,
};

/* -------------------------------------------------- scene 03 — what it does */

const s03 = {
  id: "03-what-it-does",
  file: "03-what-it-does.html",
  dur: 26.7,
  fade: 0.5,
  caps: [
    [
      0.0,
      6.6,
      "SekatApi joins live open data into one fire-spread forecast.<br>NASA FIRMS satellite hotspots for where fire is now.",
    ],
    [
      6.6,
      11.0,
      "Open-Meteo for wind, humidity and rain.<br>AWS terrain for slope. OpenStreetMap for rivers and roads.",
    ],
    [
      11.0,
      18.0,
      "It runs on a six point four by six point four kilometre grid at one hundred metre cells,<br>forty simulated runs, twenty four to forty eight hours ahead.",
    ],
    [18.0, 25.0, "You see the uncertainty, not one confident line."],
  ],
  css: `
      .s3-src {
        position: absolute; left: 120px; width: 740px; height: 120px; background: #ffffff;
        border: 1px solid #e0e3e6; border-radius: 14px; padding: 24px 28px 20px 32px;
      }
      .s3-bar { position: absolute; left: 0; top: 0; width: 4px; height: 118px; background: #e8590c; transform-origin: 50% 0; }
      .s3-src .t { font-size: 30px; font-weight: 600; letter-spacing: -0.01em; }
      .s3-src .s { font-size: 22px; color: #6b7075; margin-top: 8px; }
      .s3-y1 { top: 250px; } .s3-y2 { top: 400px; } .s3-y3 { top: 550px; } .s3-y4 { top: 700px; }
      .s3-svg { position: absolute; left: 0; top: 0; }
      .s3-panel {
        position: absolute; left: 1040px; top: 210px; width: 760px; height: 650px;
        background: #ffffff; border: 1px solid #e0e3e6; border-radius: 16px;
      }
      .s3-ptitle { position: absolute; left: 32px; top: 32px; font-size: 28px; font-weight: 600; }
      .s3-cell { position: absolute; width: 38px; height: 38px; border-radius: 4px; background: #edeff1; }
      .s3-hot { background: #e8590c; }
      .s3-stat { position: absolute; left: 410px; width: 330px; }
      .s3-stat .v { font-size: 34px; font-weight: 600; letter-spacing: -0.01em; }
      .s3-stat .l { font-size: 20px; color: #6b7075; margin-top: 6px; }
      .s3-under {
        position: absolute; left: 32px; top: 446px; font-size: 20px; color: #6b7075;
      }
      .s3-chip {
        position: absolute; left: 32px; top: 486px; background: #ffffff; border: 1px solid #e8590c;
        border-radius: 999px; padding: 12px 24px; font-size: 22px; font-weight: 500;
      }
  `,
  html: `
          <div class="s3-src s3-y1"><div class="s3-bar" id="s03-b1"></div><div class="t">NASA FIRMS</div><div class="s">satellite hotspots &mdash; where fire is now</div></div>
          <div class="s3-src s3-y2"><div class="s3-bar" id="s03-b2"></div><div class="t">Open-Meteo</div><div class="s">wind, humidity and rain</div></div>
          <div class="s3-src s3-y3"><div class="s3-bar" id="s03-b3"></div><div class="t">AWS terrain</div><div class="s">elevation and slope</div></div>
          <div class="s3-src s3-y4"><div class="s3-bar" id="s03-b4"></div><div class="t">OpenStreetMap</div><div class="s">rivers, roads, logistics</div></div>
          <svg class="s3-svg" width="1920" height="1080" viewBox="0 0 1920 1080">
            <path id="s03-c1" d="M860 310 L1010 475" stroke="#c9ced2" stroke-width="2" fill="none"/>
            <path id="s03-c2" d="M860 460 L1010 475" stroke="#c9ced2" stroke-width="2" fill="none"/>
            <path id="s03-c3" d="M860 610 L1010 475" stroke="#c9ced2" stroke-width="2" fill="none"/>
            <path id="s03-c4" d="M860 760 L1010 475" stroke="#c9ced2" stroke-width="2" fill="none"/>
            <path id="s03-c5" d="M1010 475 L1032 475" stroke="#c9ced2" stroke-width="2" fill="none"/>
            <polygon id="s03-p" points="1030,468 1046,475 1030,482" fill="#c9ced2"/>
          </svg>
          <div class="s3-panel">
            <div class="s3-ptitle">One forecast</div>
            <div id="s03-cells"></div>
            <div class="s3-stat" style="top:106px;"><div class="v">6.4 &times; 6.4 km</div><div class="l">forecast grid</div></div>
            <div class="s3-stat" style="top:186px;"><div class="v">100 m</div><div class="l">cell size</div></div>
            <div class="s3-stat" style="top:266px;"><div class="v">40</div><div class="l">simulated runs</div></div>
            <div class="s3-stat" style="top:346px;"><div class="v">24&ndash;48 h</div><div class="l">horizon</div></div>
            <div class="s3-under">6.4 km grid &middot; 100 m cells &middot; 40 runs &middot; 24&ndash;48 h horizon</div>
            <div class="s3-chip">40 runs, so the uncertainty is visible</div>
          </div>`,
  js: `
  (function () {
    var band = [[7,0],[7,1],[6,1],[6,2]];
    var soft = [[5,2],[5,3],[6,3],[4,3],[4,4],[5,4],[7,2],[6,4],[7,3]];
    var host = document.getElementById("s03-cells");
    var i, r, c, el;
    for (r = 0; r < 8; r += 1) {
      for (c = 0; c < 8; c += 1) {
        el = document.createElement("div");
        el.className = "s3-cell";
        el.style.left = 32 + c * 42 + "px";
        el.style.top = 90 + r * 42 + "px";
        host.appendChild(el);
      }
    }
    function mark(list, cls) {
      list.forEach(function (rc) {
        var idx = rc[0] * 8 + rc[1];
        host.children[idx].className = "s3-cell " + cls;
        host.children[idx].id = "s03-cell-" + rc[0] + "-" + rc[1];
      });
    }
    mark(band, "s3-hot");
    mark(soft, "s3-hot");
    window.__s03soft = soft;
  })();
  tl.fromTo(".s3-src", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.65, ease: "power3.out", stagger: 0.32 }, 0.3);
  tl.fromTo("#s03-b1, #s03-b2, #s03-b3, #s03-b4", { scaleY: 0 }, { scaleY: 1, duration: 0.55, ease: "power3.out", stagger: 0.32 }, 0.5);
  tl.fromTo("#s03-c1, #s03-c2, #s03-c3, #s03-c4, #s03-c5", { strokeDashoffset: 420 }, { strokeDashoffset: 0, duration: 0.6, ease: "power2.out" }, 6.0);
  tl.fromTo("#s03-p", { opacity: 0 }, { opacity: 1, duration: 0.3 }, 6.5);
  tl.fromTo(".s3-panel", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 6.4);
  tl.fromTo(".s3-cell", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.35, ease: "power2.out", stagger: 0.06 }, 11.0);
  tl.fromTo(".s3-stat", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out", stagger: 0.25 }, 11.6);
  tl.fromTo(".s3-under", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 13.2);
  tl.fromTo(".s3-chip", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 13.6);
  (function () {
    var soft = window.__s03soft;
    soft.forEach(function (rc) {
      var el = document.getElementById("s03-cell-" + rc[0] + "-" + rc[1]);
      if (el) el.style.opacity = "0.6";
    });
  })();
`,
};

/* ---------------------------------------------- scene 04 — recorded fire + live */

const s04 = {
  id: "04-recorded-fire",
  file: "04-recorded-fire.html",
  dur: 27,
  fade: 0.5,
  caps: [
    [
      0.0,
      7.0,
      "Here is a real West Kalimantan fire, frozen at the last satellite pass<br>on the eighteenth of October, twenty twenty six.",
    ],
    [
      7.0,
      13.0,
      "The next day the satellites found eighteen new fire spots.<br>The forecast caught twelve: a critical success index of point four one,",
    ],
    [
      13.0,
      18.5,
      "against point one seven for a distance-only baseline.<br>The white rings are what the satellites saw.",
    ],
    [
      18.5,
      27.0,
      "Live, Kalimantan shows two thousand four hundred fifty two detections in the last day.",
    ],
  ],
  css: `
      .s4-shot { opacity: 1; }
      .s4-b { position: absolute; inset: 0; opacity: 0; }
      .s4-eyebrow { position: absolute; left: 120px; top: 324px; font-size: 22px; letter-spacing: 0.16em; font-weight: 600; color: #6b7075; }
      .s4-count { position: absolute; left: 120px; top: 352px; font-size: 132px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
      .s4-sub { position: absolute; left: 120px; top: 516px; font-size: 28px; color: #6b7075; }
      .s4-div { position: absolute; left: 120px; top: 596px; width: 760px; height: 1px; background: #e0e3e6; }
      .s4-body { position: absolute; left: 120px; top: 636px; width: 860px; font-size: 26px; line-height: 1.45; }
      .s4-sheetwrap {
        position: absolute; left: 1150px; top: 50px; width: 520px; height: 720px;
        transform-origin: 0 0;
      }
      .s4-sheetimg { position: absolute; left: 0; top: 0; width: 520px; height: 720px; display: block; border-radius: 16px; }
      .s4-sheetovl { position: absolute; left: 0; top: 0; }
  `,
  html: `
          <div class="shotwrap s4-shot" id="s04-shot" data-layout-allow-overflow>
            <img class="shotimg" src="../assets/01-recorded-fire.png" alt="Recorded West Kalimantan fire" />
            <svg class="ovl" width="1920" height="1080" viewBox="0 0 1920 1080">
              <rect id="s04-r1" x="1300" y="78" width="376" height="148" rx="10" fill="none" stroke="#e8590c" stroke-width="2" stroke-dasharray="1600" stroke-dashoffset="1600"/>
              <line id="s04-l1" x1="1488" y1="232" x2="1320" y2="300" stroke="#e8590c" stroke-width="2"/>
              <circle id="s04-d1" cx="1320" cy="300" r="4" fill="#e8590c"/>
              <line id="s04-l3" x1="520" y1="652" x2="520" y2="612" stroke="#e8590c" stroke-width="1"/>
              <circle id="s04-d3" cx="520" cy="610" r="3" fill="#e8590c"/>
              <rect id="s04-r4" x="242" y="150" width="703" height="75" rx="10" fill="none" stroke="#e8590c" stroke-width="2" stroke-dasharray="1600" stroke-dashoffset="1600"/>
            </svg>
            <div class="chip" id="s04-chip2" style="right:244px; top:234px; font-size:22px;">12 of 18 new fire spots caught &middot; CSI 0.41 &middot; distance-only 0.17</div>
            <div class="chip" id="s04-chip3" style="left:300px; top:660px; font-size:22px;">white rings = what the satellites saw next</div>
          </div>

          <div class="s4-b" id="s04-b">
            <div class="s4-eyebrow">LIVE</div>
            <div class="s4-count" id="s04-count">0</div>
            <div class="s4-sub">fire detections in Kalimantan in the last 24 h</div>
            <div class="s4-div"></div>
            <div class="s4-body">Search Kalimantan returns the most active NASA FIRMS clusters, with detection counts and last-seen times.</div>
            <div class="s4-sheetwrap" id="s04-sheetwrap" data-layout-allow-overflow>
              <img class="s4-sheetimg" src="../assets/02-live-fires.png" alt="Live fires sheet for Kalimantan" />
              <svg class="s4-sheetovl" width="520" height="720" viewBox="0 0 520 720">
                <rect id="s04-r5" x="20" y="194" width="480" height="118" rx="10" fill="none" stroke="#e8590c" stroke-width="2" stroke-dasharray="1600" stroke-dashoffset="1600"/>
              </svg>
              <div class="chip" id="s04-chip4" style="left:18px; top:160px; font-size:18px;">2452 fire detections in Kalimantan in the last 24 h. Pick one:</div>
            </div>
          </div>`,
  js: `
  tl.fromTo("#s04-shot", { scale: 1, x: 0, y: 40 }, { scale: 1.06, x: -57.6, y: 10, duration: 14, ease: "power2.inOut" }, 0);
  tl.fromTo("#s04-r1", { strokeDashoffset: 1600 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 3.0);
  tl.fromTo("#s04-l1", { opacity: 0 }, { opacity: 1, duration: 0.4 }, 3.2);
  tl.fromTo("#s04-d1", { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.35, ease: "power2.out" }, 3.5);
  tl.fromTo("#s04-chip2", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 5.0);
  tl.fromTo("#s04-r4", { strokeDashoffset: 1600 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 11.0);
  tl.fromTo("#s04-chip3", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 8.5);
  tl.fromTo("#s04-l3", { opacity: 0 }, { opacity: 1, duration: 0.4 }, 8.7);
  tl.fromTo("#s04-d3", { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.35, ease: "power2.out" }, 8.8);
  tl.to("#s04-shot", { opacity: 0, duration: 0.4, ease: "none" }, 13.8);
  tl.fromTo("#s04-b", { opacity: 0 }, { opacity: 1, duration: 0.45, ease: "none" }, 13.9);
  tl.fromTo("#s04-sheetwrap", { scale: 1.14 }, { scale: 1.19, duration: 13, ease: "power1.inOut" }, 14);
  tl.fromTo("#s04-eyebrow, #s04-count, #s04-sub, #s04-div, #s04-body", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", stagger: 0.14 }, 14.2);
  tl.fromTo("#s04-r5", { strokeDashoffset: 1600 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 15.2);
  tl.fromTo("#s04-chip4", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 15.6);
  (function () {
    var counter = { v: 0 };
    var el = document.getElementById("s04-count");
    tl.to(counter, {
      v: 2452,
      duration: 1.2,
      ease: "power2.out",
      onUpdate: function () {
        var s = String(Math.round(counter.v));
        el.textContent = s.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
      },
    }, 14.6);
  })();
`,
};

/* ------------------------------------------------- scene 05 — the hindcast */

const s05 = {
  id: "05-hindcast",
  file: "05-hindcast.html",
  dur: 33,
  fade: 0,
  caps: [
    [0.0, 5.4, "Now the honest part.<br>We hindcast twelve real fires, eight to eighteen October."],
    [
      5.4,
      13.0,
      "The first model spread about six times too much fire: a score of point one seven,<br>no better than a distance-only baseline at point one six.",
    ],
    [
      13.0,
      19.6,
      "We slowed the spread, choosing the parameter on Kalimantan only.<br>On held-out Sumatra, the score moved from point zero eight to point one one, against point zero nine.",
    ],
    [
      19.6,
      25.2,
      "Pooled over all twelve: point two two against point one seven.<br>Small — we say so.",
    ],
    [25.2, 33.0, "Re-running it a day later gave identical counts."],
  ],
  css: `
      .s5-title { position: absolute; left: 140px; top: 90px; font-size: 46px; font-weight: 700; letter-spacing: -0.02em; }
      .s5-sub { position: absolute; left: 140px; top: 148px; font-size: 24px; color: #6b7075; }
      .s5-panel { position: absolute; top: 220px; width: 790px; height: 480px; background: #ffffff; border: 1px solid #e0e3e6; border-radius: 16px; }
      .s5-pa { left: 140px; }
      .s5-pb { left: 1000px; }
      .s5-h { position: absolute; left: 40px; top: 28px; font-size: 28px; font-weight: 600; }
      .s5-grid { position: absolute; left: 40px; width: 710px; height: 1px; background: #e0e3e6; }
      .s5-yt { position: absolute; left: 8px; font-size: 18px; color: #6b7075; }
      .s5-bar { position: absolute; width: 70px; transform-origin: 50% 100%; }
      .s5-val { position: absolute; font-size: 24px; font-weight: 600; }
      .s5-glab { position: absolute; font-size: 22px; color: #6b7075; }
      .s5-leg { position: absolute; display: flex; align-items: center; font-size: 20px; color: #1a1a1a; }
      .s5-sw { width: 14px; height: 14px; margin-right: 8px; }
      .s5-note { position: absolute; left: 40px; top: 438px; font-size: 20px; color: #6b7075; }
      .s5-pc { position: absolute; left: 140px; top: 720px; width: 1650px; height: 150px; background: #ffffff; border: 1px solid #e0e3e6; border-radius: 16px; }
      .s5-pch { position: absolute; left: 40px; top: 26px; font-size: 24px; font-weight: 600; }
      .s5-hbar { position: absolute; left: 40px; height: 24px; transform-origin: 0 50%; border-radius: 3px; }
      .s5-hlab { position: absolute; left: 940px; font-size: 22px; color: #1a1a1a; }
      .s5-sixx { position: absolute; left: 1240px; top: 92px; font-size: 22px; color: #6b7075; }
      .s5-sixx .u { display: inline-block; padding-bottom: 4px; border-bottom: 3px solid #e8590c; }
      .s5-foot { position: absolute; top: 882px; font-size: 22px; color: #6b7075; }
  `,
  html: `
          <div class="s5-title">Hindcast &middot; 12 real fires &middot; 8&ndash;18 Oct 2026</div>
          <div class="s5-sub">Scored on new 400 m squares only (about one satellite pixel) &middot; CSI = hits / (hits + misses + false alarms)</div>

          <div class="s5-panel s5-pa">
            <div class="s5-h">Pooled &mdash; all 12 fires</div>
            <div class="s5-grid" style="top:120px;"></div>
            <div class="s5-grid" style="top:400px;"></div>
            <div class="s5-yt" style="top:108px;">0.25</div>
            <div class="s5-yt" style="top:388px;">0</div>
            <div class="s5-bar" id="s05-a1" style="left:90px; top:210px; height:190px; background:#1a1a1a;"></div>
            <div class="s5-bar" id="s05-a2" style="left:170px; top:221px; height:179px; background:#c9ced2;"></div>
            <div class="s5-bar" id="s05-a3" style="left:430px; top:154px; height:246px; background:#e8590c;"></div>
            <div class="s5-bar" id="s05-a4" style="left:510px; top:210px; height:190px; background:#c9ced2;"></div>
            <div class="s5-val" id="s05-va1" style="left:90px; top:180px;">0.17</div>
            <div class="s5-val" id="s05-va2" style="left:170px; top:191px;">0.16</div>
            <div class="s5-val" id="s05-va3" style="left:430px; top:124px;">0.22</div>
            <div class="s5-val" id="s05-va4" style="left:510px; top:180px;">0.17</div>
            <div class="s5-glab" style="left:90px; top:410px;">&#964; = 3 h (first model)</div>
            <div class="s5-glab" style="left:430px; top:410px;">&#964; = 6 h (slowed spread)</div>
            <div class="s5-leg" style="left:40px; top:442px;"><span class="s5-sw" style="background:#1a1a1a;"></span>SekatApi</div>
            <div class="s5-leg" style="left:180px; top:442px;"><span class="s5-sw" style="background:#e8590c;"></span>SekatApi, slowed spread</div>
            <div class="s5-leg" style="left:470px; top:442px;"><span class="s5-sw" style="background:#c9ced2;"></span>distance-only baseline</div>
          </div>

          <div class="s5-panel s5-pb">
            <div class="s5-h">Sumatra &mdash; held out</div>
            <div class="s5-grid" style="top:120px;"></div>
            <div class="s5-grid" style="top:400px;"></div>
            <div class="s5-yt" style="top:108px;">0.25</div>
            <div class="s5-yt" style="top:388px;">0</div>
            <div class="s5-bar" id="s05-b1" style="left:90px; top:310px; height:90px; background:#1a1a1a;"></div>
            <div class="s5-bar" id="s05-b2" style="left:170px; top:310px; height:90px; background:#c9ced2;"></div>
            <div class="s5-bar" id="s05-b3" style="left:430px; top:277px; height:123px; background:#e8590c;"></div>
            <div class="s5-bar" id="s05-b4" style="left:510px; top:299px; height:101px; background:#c9ced2;"></div>
            <div class="s5-val" id="s05-vb1" style="left:90px; top:280px;">0.08</div>
            <div class="s5-val" id="s05-vb2" style="left:170px; top:280px;">0.08</div>
            <div class="s5-val" id="s05-vb3" style="left:430px; top:247px;">0.11</div>
            <div class="s5-val" id="s05-vb4" style="left:510px; top:269px;">0.09</div>
            <div class="s5-glab" style="left:90px; top:410px;">&#964; = 3 h</div>
            <div class="s5-glab" style="left:430px; top:410px;">&#964; = 6 h</div>
            <div class="s5-note">&#964; was chosen on Kalimantan only.</div>
          </div>

          <div class="s5-pc">
            <div class="s5-pch">New 400 m squares forecast &mdash; how much fire the model predicted</div>
            <div class="s5-hbar" id="s05-h1" style="top:62px; width:900px; background:#c9ced2;"></div>
            <div class="s5-hbar" id="s05-h2" style="top:90px; width:530px; background:#1a1a1a;"></div>
            <div class="s5-hbar" id="s05-h3" style="top:118px; width:155px; background:#e8590c;"></div>
            <div class="s5-hlab" style="top:62px;">&#964; = 3 h &mdash; 663 forecast</div>
            <div class="s5-hlab" style="top:90px;">&#964; = 6 h &mdash; 390 forecast</div>
            <div class="s5-hlab" style="top:118px;">observed &mdash; 114</div>
            <div class="s5-sixx"><span class="u">about 6&times; too much fire</span></div>
          </div>

          <div class="s5-foot" style="left:140px;">Re-running all 12 hindcasts a day later gave identical counts.</div>
          <div class="s5-foot" style="left:900px;">The margin over distance-only is small. We publish it anyway.</div>`,
  js: `
  tl.fromTo(".s5-title, .s5-sub", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.65, ease: "power3.out", stagger: 0.14 }, 0.2);
  tl.fromTo(".s5-panel", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.22 }, 0.9);
  tl.fromTo("#s05-a1", { scaleY: 0 }, { scaleY: 1, duration: 0.7, ease: "power3.out" }, 2.6);
  tl.fromTo("#s05-a2", { scaleY: 0 }, { scaleY: 1, duration: 0.7, ease: "power3.out" }, 2.85);
  tl.fromTo("#s05-a3", { scaleY: 0 }, { scaleY: 1, duration: 0.7, ease: "power3.out" }, 3.1);
  tl.fromTo("#s05-a4", { scaleY: 0 }, { scaleY: 1, duration: 0.7, ease: "power3.out" }, 3.35);
  tl.fromTo("#s05-b1", { scaleY: 0 }, { scaleY: 1, duration: 0.7, ease: "power3.out" }, 2.9);
  tl.fromTo("#s05-b2", { scaleY: 0 }, { scaleY: 1, duration: 0.7, ease: "power3.out" }, 3.15);
  tl.fromTo("#s05-b3", { scaleY: 0 }, { scaleY: 1, duration: 0.7, ease: "power3.out" }, 3.4);
  tl.fromTo("#s05-b4", { scaleY: 0 }, { scaleY: 1, duration: 0.7, ease: "power3.out" }, 3.65);
  tl.fromTo("#s05-va1, #s05-va2, #s05-va3, #s05-va4, #s05-vb1, #s05-vb2, #s05-vb3, #s05-vb4", { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.22 }, 3.2);
  tl.fromTo("#s05-h1", { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: "power3.out" }, 5.4);
  tl.fromTo("#s05-h2", { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: "power3.out" }, 5.65);
  tl.fromTo("#s05-h3", { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: "power3.out" }, 5.9);
  tl.fromTo(".s5-hlab", { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.25 }, 5.9);
  tl.fromTo(".s5-sixx", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 6.6);
  tl.fromTo(".s5-foot", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out", stagger: 0.2 }, 25.2);
`,
};

/* ------------------------------------------------ scene 06 — the register rule */

const s06 = {
  id: "06-register-rule",
  file: "06-register-rule.html",
  dur: 18,
  fade: 0.4,
  caps: [
    [
      0.0,
      6.2,
      "That is why forecasts now go on the record.<br>The register picks the three most active fires on each island by a fixed rule,",
    ],
    [6.2, 11.4, "applied automatically at issue time.<br>Nobody picks the easy fires."],
    [11.4, 18.0, "Each gets a live scenario, a twenty-four hour forecast, and a seal."],
  ],
  css: `
      .s6-eyebrow { position: absolute; left: 120px; top: 246px; font-size: 22px; letter-spacing: 0.16em; font-weight: 600; color: #6b7075; }
      .s6-head { position: absolute; left: 120px; top: 284px; font-size: 52px; font-weight: 700; letter-spacing: -0.022em; }
      .s6-rule { position: absolute; left: 120px; width: 960px; display: flex; }
      .s6-rule .n { font-size: 44px; font-weight: 700; color: #e8590c; width: 66px; line-height: 1.05; }
      .s6-rule .x { font-size: 28px; line-height: 1.4; }
      .s6-r1 { top: 424px; } .s6-r2 { top: 556px; } .s6-r3 { top: 688px; }
      .s6-close { position: absolute; left: 120px; top: 846px; font-size: 26px; }
      .s6-close .acc { color: #e8590c; }
      .s6-sheetwrap {
        position: absolute; left: 1160px; top: 60px; width: 520px; height: 720px;
        transform-origin: 0 0;
      }
      .s6-sheetimg { position: absolute; left: 0; top: 0; width: 520px; height: 720px; display: block; border-radius: 16px; }
      .s6-sheetovl { position: absolute; left: 0; top: 0; }
  `,
  html: `
          <div class="s6-eyebrow">PRE-REGISTRATION</div>
          <div class="s6-head">The forecast register</div>
          <div class="s6-rule s6-r1"><div class="n">1</div><div class="x">Pick the 3 most active fires on each island &mdash; a fixed rule, applied automatically at issue time.</div></div>
          <div class="s6-rule s6-r2"><div class="n">2</div><div class="x">Forecast the next 24 h from live data.</div></div>
          <div class="s6-rule s6-r3"><div class="n">3</div><div class="x">Seal it. Score it 24 h later against NASA FIRMS. Keep it, good or bad.</div></div>
          <div class="s6-close"><span class="acc">Nobody picks the easy fires</span>.</div>
          <div class="s6-sheetwrap" id="s06-sheetwrap" data-layout-allow-overflow>
            <img class="s6-sheetimg" src="../assets/03b-register-sheet.png" alt="Forecast register sheet" />
            <svg class="s6-sheetovl" width="520" height="720" viewBox="0 0 520 720">
              <rect id="s06-r1" x="18" y="110" width="322" height="26" rx="8" fill="none" stroke="#e8590c" stroke-width="2" stroke-dasharray="1600" stroke-dashoffset="1600"/>
              <rect id="s06-r2" x="426" y="284" width="82" height="28" rx="8" fill="none" stroke="#e8590c" stroke-width="2" stroke-dasharray="1600" stroke-dashoffset="1600"/>
            </svg>
            <div class="chip" id="s06-chip1" style="left:18px; top:142px; font-size:17px;">6 sealed &middot; 0 scored &mdash; waiting for the first 24 h windows to close</div>
            <div class="chip" id="s06-chip2" style="left:30px; top:340px; font-size:17px;">Sealed Oct 21, 12:40 AM &middot; on Bitcoin &middot; scored after Oct 22, 06:40 AM</div>
          </div>`,
  js: `
  tl.fromTo("#s06-sheetwrap", { scale: 1.12 }, { scale: 1.18, duration: 18, ease: "power1.inOut" }, 0);
  tl.fromTo(".s6-eyebrow, .s6-head", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.16 }, 0.2);
  tl.fromTo(".s6-rule", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.65, ease: "power3.out", stagger: 0.4 }, 2.2);
  tl.fromTo(".s6-close", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 9.0);
  tl.fromTo("#s06-r1", { strokeDashoffset: 1600 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 6.0);
  tl.fromTo("#s06-chip1", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 6.4);
  tl.fromTo("#s06-r2", { strokeDashoffset: 1600 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 10.0);
  tl.fromTo("#s06-chip2", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 10.4);
`,
};

/* --------------------------------------------------- scene 07 — the seal + ots */

const s07 = {
  id: "07-seal-bitcoin",
  file: "07-seal-bitcoin.html",
  dur: 32.5,
  fade: 0,
  caps: [
    [0.0, 6.6, "Sealing is three things.<br>A SHA-256 hash over every input and every simulated cell."],
    [6.6, 11.4, "An Ed25519 signature over that hash.<br>And an OpenTimestamps anchor committed to Bitcoin."],
    [
      11.4,
      17.4,
      "Six forecasts were sealed on the twenty-first of October &mdash; three in Kalimantan,<br>three in Sumatra &mdash; before their outcome existed.",
    ],
    [
      17.4,
      22.0,
      "Twenty-four hours later each one is scored against NASA FIRMS,<br>and stays on the board, good or bad.",
    ],
    [
      22.0,
      29.0,
      "Here is the reference client verifying one: a real Bitcoin transaction,<br>still waiting for confirmations.",
    ],
  ],
  css: `
      .s7-head { position: absolute; left: 140px; top: 94px; font-size: 44px; font-weight: 700; letter-spacing: -0.02em; }
      .s7-step { position: absolute; left: 140px; width: 1560px; height: 150px; background: #ffffff; border: 1px solid #e0e3e6; border-radius: 16px; }
      .s7-bar { position: absolute; left: 0; top: 0; width: 4px; height: 148px; background: #e8590c; transform-origin: 50% 0; }
      .s7-n { position: absolute; left: 44px; top: 44px; font-size: 44px; font-weight: 700; color: #e8590c; }
      .s7-t { position: absolute; left: 116px; top: 34px; font-size: 30px; font-weight: 600; }
      .s7-s { position: absolute; left: 116px; top: 80px; font-size: 24px; color: #6b7075; }
      .s7-s1 { top: 240px; } .s7-s2 { top: 430px; } .s7-s3 { top: 620px; }
      .s7-conn { position: absolute; left: 150px; width: 2px; background: #c9ced2; }
      .s7-c1 { top: 390px; height: 40px; } .s7-c2 { top: 580px; height: 40px; }
      .s7-stats { position: absolute; left: 140px; top: 800px; width: 1560px; display: flex; }
      .s7-stat { width: 390px; }
      .s7-stat .v { font-size: 44px; font-weight: 700; letter-spacing: -0.02em; }
      .s7-stat .l { font-size: 20px; color: #6b7075; margin-top: 8px; }
      .s7-term {
        position: absolute; left: 220px; top: 150px; width: 1480px; height: 730px;
        background: #111418; border: 2px solid #2a3038; border-radius: 14px; opacity: 0;
      }
      .s7-lines {
        position: absolute; left: 28px; top: 10px; font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-size: 22px; line-height: 27.8px; color: #d7dbde; white-space: pre;
      }
      .s7-lines .p { color: #8ab4f8; }
      .s7-lines .ok { color: #7fd1a0; }
      .s7-lines .tx { color: #e8590c; }
      .s7-line { opacity: 0; }
      .s7-txrect { position: absolute; left: 28px; top: 342px; width: 1282px; height: 30px; border: 2px solid #e8590c; border-radius: 6px; opacity: 0; }
      .s7-txchip { position: absolute; left: 28px; top: 382px; font-size: 22px; }
  `,
  html: `
          <div class="s7-head">Sealing a forecast</div>
          <div class="s7-conn s7-c1"></div>
          <div class="s7-conn s7-c2"></div>
          <div class="s7-step s7-s1"><div class="s7-bar" id="s07-b1"></div><div class="s7-n">1</div><div class="s7-t">SHA-256 hash</div><div class="s7-s">over every input and every simulated cell</div></div>
          <div class="s7-step s7-s2"><div class="s7-bar" id="s07-b2"></div><div class="s7-n">2</div><div class="s7-t">Ed25519 signature</div><div class="s7-s">over that hash</div></div>
          <div class="s7-step s7-s3"><div class="s7-bar" id="s07-b3"></div><div class="s7-n">3</div><div class="s7-t">OpenTimestamps anchor</div><div class="s7-s">committed to Bitcoin</div></div>
          <div class="s7-stats">
            <div class="s7-stat"><div class="v">6</div><div class="l">forecasts sealed</div></div>
            <div class="s7-stat"><div class="v">3</div><div class="l">in Kalimantan</div></div>
            <div class="s7-stat"><div class="v">3</div><div class="l">in Sumatra</div></div>
            <div class="s7-stat"><div class="v">21 Oct 2026</div><div class="l">before the outcome existed</div></div>
          </div>

          <div class="s7-term" id="s07-term">
            <div class="s7-lines" id="s07-lines"></div>
            <div class="s7-txrect" id="s07-txrect"></div>
            <div class="chip s7-txchip" id="s07-txchip">Real Bitcoin transaction &middot; fc6c3516&hellip; &middot; waiting for 6 confirmations</div>
          </div>`,
  js: `
  tl.fromTo(".s7-head", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.65, ease: "power3.out" }, 0.2);
  tl.fromTo(".s7-step", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.65, ease: "power3.out", stagger: 0.35 }, 0.8);
  tl.fromTo("#s07-b1, #s07-b2, #s07-b3", { scaleY: 0 }, { scaleY: 1, duration: 0.5, ease: "power3.out", stagger: 0.35 }, 1.0);
  tl.fromTo(".s7-stat", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.55, ease: "power3.out", stagger: 0.16 }, 3.4);
  tl.to(".s7-head, .s7-step, .s7-conn, .s7-stats", { opacity: 0, duration: 0.45, ease: "none" }, 13.5);
  tl.to("#s07-term", { opacity: 1, duration: 0.4, ease: "none" }, 14.0);
  (function () {
    var raw = [
      { t: "p", s: "$ node scripts/export-proofs.mjs" },
      { t: "ok", s: "ok  2026-10-20T16:38:43.516Z  -2.964, 112.151  sekatapi-278f58dc6960.receipt.json + .ots" },
      { t: "ok", s: "ok  2026-10-20T16:38:09.494Z  -3.335, 112.671  sekatapi-445e7ddd7292.receipt.json + .ots" },
      { t: "ok", s: "ok  2026-10-20T16:39:37.890Z  -3.400, 105.229  sekatapi-5ff72728fced.receipt.json + .ots" },
      { t: "ok", s: "ok  2026-10-20T16:40:11.756Z  -2.979, 105.162  sekatapi-8b3757efb8aa.receipt.json + .ots" },
      { t: "ok", s: "ok  2026-10-20T16:38:26.453Z  -3.832, 115.073  sekatapi-8f48c87dffb9.receipt.json + .ots" },
      { t: "ok", s: "ok  2026-10-20T16:39:54.798Z  -3.509, 105.287  sekatapi-fb2db4de00fe.receipt.json + .ots" },
      { t: "d", s: "6 forecast(s) exported to proofs/" },
      { t: "b", s: "" },
      { t: "p", s: "$ ots verify proofs/sekatapi-278f58dc6960.receipt.json.ots" },
      { t: "d", s: "Assuming target filename is 'proofs/sekatapi-278f58dc6960.receipt.json'" },
      { t: "d", s: "Calendar https://alice.btc.calendar.opentimestamps.org: Timestamped by transaction" },
      { t: "x", s: "fc6c351623a80b15c8559b9937688b7a0de5606e3520772bbfc3d38b4a8e838f; waiting for 6 confirmations" }
    ];
    var host = document.getElementById("s07-lines");
    var total = 0, i, el;
    for (i = 0; i < raw.length; i += 1) total += raw[i].s.length;
    var cum = 0;
    for (i = 0; i < raw.length; i += 1) {
      el = document.createElement("div");
      el.className = "s7-line";
      if (raw[i].t === "p") {
        el.innerHTML = '<span class="p">' + raw[i].s.charAt(0) + "</span>" + raw[i].s.slice(1);
      } else if (raw[i].t === "ok") {
        el.innerHTML = '<span class="ok">ok</span>' + raw[i].s.slice(2);
      } else if (raw[i].t === "x") {
        el.innerHTML = '<span class="tx">' + raw[i].s + "</span>";
      } else {
        el.textContent = raw[i].s;
      }
      host.appendChild(el);
      var at = 14.4 + (cum / total) * 8.1;
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.08, ease: "none" }, at);
      cum += raw[i].s.length;
    }
  })();
  tl.fromTo("#s07-txrect", { opacity: 0, strokeDashoffset: 1600 }, { opacity: 1, strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 24.0);
  tl.fromTo("#s07-txchip", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 24.4);
`,
};

/* ------------------------------------------------------ scene 08 — why bitcoin */

const s08 = {
  id: "08-why-bitcoin",
  file: "08-why-bitcoin.html",
  dur: 21,
  fade: 0.4,
  caps: [
    [
      0.0,
      6.0,
      "Bitcoin here is a public clock and nothing more.<br>One hash per forecast. No token, no wallet, no fee.",
    ],
    [
      6.0,
      11.4,
      "A smart contract cannot make a fire model more correct &mdash;<br>a deterministic re-run can.",
    ],
    [
      11.4,
      21.0,
      "So the record shows four things: the receipt is unchanged, the inputs are unchanged,<br>the signature is valid, and re-running gives the same result.",
    ],
  ],
  css: `
      .s8-head { position: absolute; left: 120px; top: 196px; font-size: 48px; font-weight: 700; letter-spacing: -0.022em; }
      .s8-sub { position: absolute; left: 120px; top: 266px; font-size: 28px; color: #6b7075; }
      .s8-bul { position: absolute; left: 120px; font-size: 28px; display: flex; align-items: center; }
      .s8-b1 { top: 352px; } .s8-b2 { top: 422px; } .s8-b3 { top: 492px; }
      .s8-mk { width: 6px; height: 26px; background: #e8590c; margin-right: 18px; }
      .s8-quote {
        position: absolute; left: 120px; top: 606px; width: 1080px; height: 156px;
        background: #ffffff; border: 1px solid #e0e3e6; border-radius: 14px;
      }
      .s8-qbar { position: absolute; left: 0; top: 0; width: 4px; height: 154px; background: #e8590c; }
      .s8-q1 { position: absolute; left: 40px; top: 26px; font-size: 34px; font-weight: 500; letter-spacing: -0.01em; }
      .s8-q2 { position: absolute; left: 40px; top: 82px; font-size: 34px; font-weight: 600; color: #e8590c; letter-spacing: -0.01em; }
      .s8-tests {
        position: absolute; left: 120px; top: 840px; background: #ffffff; border: 1px solid #e0e3e6;
        border-radius: 999px; padding: 11px 22px; font-size: 22px; color: #6b7075;
      }
      .s8-sheetwrap {
        position: absolute; left: 1340px; top: 45px; width: 380px; height: 843px;
        transform-origin: 0 0;
      }
      .s8-sheetimg { position: absolute; left: 0; top: 0; width: 380px; height: 843px; display: block; border-radius: 16px; }
      .s8-sheetovl { position: absolute; left: 0; top: 0; }
  `,
  html: `
          <div class="s8-head">Bitcoin is a public clock</div>
          <div class="s8-sub">and nothing more</div>
          <div class="s8-bul s8-b1"><span class="s8-mk"></span><span>One hash per forecast</span></div>
          <div class="s8-bul s8-b2"><span class="s8-mk"></span><span>No token, no wallet, no fee</span></div>
          <div class="s8-bul s8-b3"><span class="s8-mk"></span><span>Verified by anyone with the public ots client</span></div>
          <div class="s8-quote">
            <div class="s8-qbar"></div>
            <div class="s8-q1">A smart contract cannot make a fire model more correct.</div>
            <div class="s8-q2">A deterministic re-run can.</div>
          </div>
          <div class="s8-tests">47 automated tests pass</div>
          <div class="s8-sheetwrap" id="s08-sheetwrap" data-layout-allow-overflow>
            <img class="s8-sheetimg" src="../assets/05b-record-checks.png" alt="Record panel with the four checks" />
            <svg class="s8-sheetovl" width="380" height="843" viewBox="0 0 380 843">
              <rect id="s08-r1" x="14" y="512" width="354" height="140" rx="8" fill="none" stroke="#e8590c" stroke-width="2" stroke-dasharray="1600" stroke-dashoffset="1600"/>
            </svg>
            <div class="chip" id="s08-chip1" style="left:16px; top:482px; font-size:22px;">Checks</div>
          </div>`,
  js: `
  tl.fromTo("#s08-sheetwrap", { scale: 0.96 }, { scale: 1.02, duration: 21, ease: "power1.inOut" }, 0);
  tl.fromTo(".s8-head, .s8-sub", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.16 }, 0.3);
  tl.fromTo(".s8-bul", { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.6, ease: "power3.out", stagger: 0.24 }, 1.6);
  tl.fromTo(".s8-quote", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 5.2);
  tl.fromTo(".s8-tests", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 7.2);
  tl.fromTo("#s08-r1", { strokeDashoffset: 1600 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 9.0);
  tl.fromTo("#s08-chip1", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 9.4);
`,
};

/* ------------------------------------------------- scene 09 — decision support */

const s09 = {
  id: "09-decision-support",
  file: "09-decision-support.html",
  dur: 31.3,
  fade: 0.4,
  caps: [
    [
      0.0,
      6.6,
      "The same sealed engine compares firefighting plans:<br>control lines, helicopter drops, hand crews, peat injection.",
    ],
    [
      6.6,
      11.8,
      "It only plans with resources the commander says exist.<br>Options resting on placeholder numbers, like cloud seeding, are tagged speculative and kept out.",
    ],
    [
      11.8,
      19.6,
      "In the exercise scenario, five hundred seventy-eight hectares burn with the plan<br>against eight hundred forty-seven without: thirty-two percent less.",
    ],
    [
      19.6,
      27.0,
      "That difference is a model estimate of about two hundred ten thousand tonnes<br>of carbon dioxide equivalent.",
    ],
  ],
  css: `
      .s9-shot { opacity: 1; }
      .s9-terrain { position: absolute; inset: 0; opacity: 0; }
      .s9-ovlA, .s9-ovlB { position: absolute; inset: 0; }
      .s9-ovlB { opacity: 0; }
  `,
  html: `
          <div class="shotwrap s9-shot" id="s09-shot" data-layout-allow-overflow>
            <img class="shotimg" src="../assets/04-plan-before-after.png" alt="Plan comparison before and after" />
            <svg class="ovl" width="1920" height="1080" viewBox="0 0 1920 1080">
              <g id="s09-ga">
                <rect id="s09-r1" x="1300" y="80" width="376" height="96" rx="10" fill="none" stroke="#e8590c" stroke-width="2" stroke-dasharray="1600" stroke-dashoffset="1600"/>
                <rect id="s09-r2" x="1298" y="214" width="212" height="48" rx="10" fill="none" stroke="#e8590c" stroke-width="2" stroke-dasharray="1600" stroke-dashoffset="1600"/>
                <rect id="s09-r3" x="1306" y="314" width="352" height="74" rx="10" fill="none" stroke="#e8590c" stroke-width="2" stroke-dasharray="1600" stroke-dashoffset="1600"/>
              </g>
              <g id="s09-gb">
                <rect id="s09-r4" x="1300" y="515" width="360" height="230" rx="10" fill="none" stroke="#e8590c" stroke-width="2" stroke-dasharray="1600" stroke-dashoffset="1600"/>
                <rect id="s09-r5" x="1300" y="876" width="368" height="76" rx="10" fill="none" stroke="#e8590c" stroke-width="2" stroke-dasharray="1600" stroke-dashoffset="1600"/>
              </g>
            </svg>
            <div class="s9-ovlA">
              <div class="chip" id="s09-chip1" style="right:244px; top:180px; font-size:22px;">578 ha with your plan &middot; 847 ha if nothing is done &middot; &minus;32%</div>
              <div class="chip" id="s09-chip2" style="right:244px; top:268px; font-size:22px;">Peat emissions difference &mdash; a model estimate, not a measurement</div>
              <div class="chip" id="s09-chip3" style="right:260px; top:396px; font-size:22px;">The peat map here is synthetic &mdash; illustrative only</div>
            </div>
            <div class="s9-ovlB">
              <div class="chip" id="s09-chip4" style="right:260px; top:754px; font-size:22px;">Only resources the commander says exist</div>
              <div class="chip" id="s09-chip5" style="right:252px; top:790px; font-size:22px;">Cloud seeding: speculative &mdash; kept out of the combined strategy</div>
            </div>
          </div>

          <div class="s9-terrain" id="s09-terrain">
            <div class="shotwrap" id="s09-terrainwrap" data-layout-allow-overflow>
              <img class="shotimg" src="../assets/06-3d-terrain.png" alt="3D terrain view of both maps" />
              <svg class="ovl" width="1920" height="1080" viewBox="0 0 1920 1080">
                <rect id="s09-r6" x="286" y="392" width="456" height="314" rx="10" fill="none" stroke="#e8590c" stroke-width="2" stroke-dasharray="1600" stroke-dashoffset="1600"/>
              </svg>
              <div class="chip" id="s09-chip6" style="left:300px; top:714px; font-size:22px;">Same map, draped on real elevation</div>
            </div>
          </div>`,
  js: `
  tl.fromTo("#s09-shot", { scale: 1, x: 0, y: 0 }, { scale: 1.05, x: -531, y: 88.5, duration: 11.5, ease: "power2.inOut" }, 0);
  tl.fromTo("#s09-r1", { strokeDashoffset: 1600 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 2.0);
  tl.fromTo("#s09-chip1", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 2.4);
  tl.fromTo("#s09-r2", { strokeDashoffset: 1600 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 5.0);
  tl.fromTo("#s09-chip2", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 5.4);
  tl.fromTo("#s09-r3", { strokeDashoffset: 1600 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 8.0);
  tl.fromTo("#s09-chip3", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 8.4);
  tl.fromTo("#s09-shot", { scale: 1.05, x: -531, y: 88.5 }, { scale: 1.14, x: -556.2, y: -246.6, duration: 6.5, ease: "power2.inOut", immediateRender: false }, 11.5);
  tl.to(".s9-ovlA", { opacity: 0, duration: 0.4, ease: "none" }, 11.8);
  tl.to(".s9-ovlB", { opacity: 1, duration: 0.4, ease: "none" }, 12.0);
  tl.to("#s09-ga", { opacity: 0, duration: 0.4, ease: "none" }, 11.8);
  tl.to("#s09-gb", { opacity: 1, duration: 0.4, ease: "none" }, 12.0);
  tl.fromTo("#s09-r4", { strokeDashoffset: 1600 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 14.0);
  tl.fromTo("#s09-chip4", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 14.4);
  tl.fromTo("#s09-r5", { strokeDashoffset: 1600 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 17.5);
  tl.fromTo("#s09-chip5", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 17.9);
  tl.to("#s09-shot", { opacity: 0, duration: 0.4, ease: "none" }, 23.8);
  tl.fromTo("#s09-terrain", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "none" }, 23.9);
  tl.fromTo("#s09-terrainwrap", { scale: 1, x: 200, y: 20 }, { scale: 1.07, x: 146.8, y: -16.4, duration: 7.4, ease: "power2.inOut" }, 24);
  tl.fromTo("#s09-r6", { strokeDashoffset: 1600 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 25.2);
  tl.fromTo("#s09-chip6", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 25.6);
`,
};

/* --------------------------------------------- scene 10 — impact and close */

const s10 = {
  id: "10-impact-close",
  file: "10-impact-close.html",
  dur: 28,
  fade: 0.5,
  caps: [
    [
      0.0,
      7.2,
      "Who is it for? Disaster managers, Manggala Agni fire commanders,<br>provincial governments, researchers comparing fire models,",
    ],
    [
      7.2,
      11.6,
      "and auditors checking what was known.<br>It runs in a browser on free open data; adding a region is a bounding box.",
    ],
    [
      11.6,
      19.0,
      "Two honest limits: the peat map is synthetic, so carbon numbers are illustrative,<br>and the model's edge is small.",
    ],
    [19.0, 23.0, "That is why every forecast is now on the record."],
    [23.0, 28.0, "SekatApi &mdash; forecasts on the record."],
  ],
  css: `
      .s10-head { position: absolute; left: 140px; top: 104px; font-size: 46px; font-weight: 700; letter-spacing: -0.02em; }
      .s10-card { position: absolute; width: 830px; height: 150px; background: #ffffff; border: 1px solid #e0e3e6; border-radius: 14px; padding: 28px 32px; }
      .s10-c1 { left: 140px; top: 218px; } .s10-c2 { left: 1010px; top: 218px; }
      .s10-c3 { left: 140px; top: 398px; } .s10-c4 { left: 1010px; top: 398px; }
      .s10-card .t { font-size: 30px; font-weight: 600; letter-spacing: -0.01em; }
      .s10-card .s { font-size: 22px; color: #6b7075; margin-top: 10px; }
      .s10-l1 { position: absolute; left: 140px; top: 612px; font-size: 30px; font-weight: 500; }
      .s10-l2 { position: absolute; left: 140px; top: 662px; font-size: 30px; font-weight: 500; }
      .s10-lim { position: absolute; width: 830px; }
      .s10-lim1 { left: 140px; top: 748px; } .s10-lim2 { left: 1010px; top: 748px; }
      .s10-lim .b { position: absolute; left: 0; top: 0; width: 4px; height: 30px; background: #e8590c; }
      .s10-lim .x { position: absolute; left: 26px; top: 0; font-size: 26px; line-height: 1.3; width: 780px; }
      .s10-close { position: absolute; left: 0; right: 0; top: 664px; font-size: 24px; color: #6b7075; text-align: center; }
      .s10-end { position: absolute; inset: 0; opacity: 0; text-align: center; }
      .s10-logo { position: absolute; left: 928px; top: 300px; width: 64px; height: 64px; border-radius: 14px; }
      .s10-title { position: absolute; left: 0; right: 0; top: 400px; font-size: 96px; font-weight: 700; letter-spacing: -0.03em; }
      .s10-tag { position: absolute; left: 0; right: 0; top: 528px; font-size: 40px; font-weight: 500; color: #e8590c; }
      .s10-rule { position: absolute; left: 840px; top: 628px; width: 240px; height: 3px; background: #e8590c; transform-origin: 50% 50%; }
      .s10-foot { position: absolute; left: 0; right: 0; top: 712px; font-size: 26px; color: #6b7075; line-height: 1.55; }
  `,
  html: `
          <div class="s10-head">Who it is for</div>
          <div class="s10-card s10-c1"><div class="t">Disaster managers</div><div class="s">national and provincial response</div></div>
          <div class="s10-card s10-c2"><div class="t">Manggala Agni commanders</div><div class="s">where and when to act</div></div>
          <div class="s10-card s10-c3"><div class="t">Provincial governments</div><div class="s">deciding when to act</div></div>
          <div class="s10-card s10-c4"><div class="t">Researchers and auditors</div><div class="s">comparing models; checking what was known</div></div>
          <div class="s10-l1">It runs in a browser on free open data.</div>
          <div class="s10-l2">Adding a region is a bounding box.</div>
          <div class="s10-lim s10-lim1"><span class="b"></span><span class="x">The peat map is synthetic, so carbon numbers are illustrative.</span></div>
          <div class="s10-lim s10-lim2"><span class="b"></span><span class="x">The model&rsquo;s edge over a distance-only forecast is small.</span></div>
          <div class="s10-end" id="s10-end">
            <img class="s10-logo" id="s10-logo" src="../assets/sekatapi-mark.png" alt="SekatApi" />
            <div class="s10-title" id="s10-title">SekatApi</div>
            <div class="s10-tag" id="s10-tag">Forecasts on the record.</div>
            <div class="s10-rule" id="s10-rule"></div>
            <div class="s10-close" id="s10-close">That is exactly why every forecast is now on the record.</div>
            <div class="s10-foot" id="s10-foot">
              Track &middot; Climate Data &amp; Environmental Monitoring<br />
              IEEE ClimateChain Global Hackathon 2026<br />
              [Team]<br />
              [repo URL]
            </div>
          </div>`,
  js: `
  tl.fromTo(".s10-head", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.65, ease: "power3.out" }, 0.2);
  tl.fromTo(".s10-card", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", stagger: 0.25 }, 0.8);
  tl.fromTo(".s10-l1, .s10-l2", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", stagger: 0.2 }, 7.6);
  tl.fromTo(".s10-lim", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", stagger: 0.25 }, 11.8);
  tl.to(".s10-head, .s10-card, .s10-l1, .s10-l2, .s10-lim", { opacity: 0, duration: 0.45, ease: "none" }, 15.8);
  tl.fromTo("#s10-end", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "none" }, 16.0);
  tl.fromTo("#s10-logo", { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 16.3);
  tl.fromTo("#s10-title", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 16.6);
  tl.fromTo("#s10-tag", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.65, ease: "power3.out" }, 17.8);
  tl.fromTo("#s10-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "power3.out" }, 18.8);
  tl.fromTo("#s10-close", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 19.0);
  tl.fromTo("#s10-foot", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 19.7);
`,
};

export const SCENES = [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10];
