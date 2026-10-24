// server/brief.ts
var SYSTEM = `You write short wildfire situation briefs for incident commanders (BPBD, Manggala Agni) from a simulation's output.
Rules:
- Use ONLY numbers and facts present in the JSON. Never invent forecasts, places, resources or dates.
- Always keep uncertainty: quote percentages and 10\u201390% ranges as given. Never call any zone "safe" or "guaranteed".
- Say which data is synthetic vs live, exactly as the provenance field states.
- Resources: only mention helicopters, crews, dozers, bases or dip sites that appear in "resources". If a count is "unknown", say it must be confirmed; never assume it exists. A mapped base is not proof of staff or equipment.
- When you justify a tactic, use only the "doctrine" rules given and name their source in brackets, e.g. [NWCG IRPG (PMS 461, 2025)]. Do not cite anything else.
- Structure: 1) Situation now (2\u20133 sentences). 2) Main threat and timing. 3) Recommended actions in priority order: what, where, when (act-by), why, expected effect, resources. 4) What the current plan changes vs no action. 5) Caveats (1\u20132 sentences: simplified model, not operational guidance).
- Max ~250 words. Plain text with short headings, no tables.

Plan: also choose the actions to carry out, picked ONLY from "recommendations" by their "id". For each pick choose a start hour that appears in that option's "hectaresSavedByStartHour" (earliest hour that saves close to the most is usually best). Prefer options whose availability is "available"; include an "unknown" one only if you say in the brief that its resources must be confirmed. Never exceed the inventory. If "suggestedStrategy" lists ids, start from those. Section 3 of the brief must describe exactly these picks, in the same order, by their title (never print an id). In section 4, describe the effect of the current plan plus these picks using the per-option savings given; do not compute new totals. Pick nothing if no option saves area.

Output ONLY a JSON object, no code fences:
{"brief": "<the brief text>", "plan": [{"id": "<recommendation id>", "startHour": <number>, "reason": "<max 12 words>"}]}`;
function parseReply(raw) {
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(raw.slice(a, b + 1));
      if (typeof j.brief === "string") return { brief: j.brief, plan: Array.isArray(j.plan) ? j.plan : [] };
    } catch {
    }
  }
  return { brief: raw.trim(), plan: [] };
}
function validPlan(plan, recs) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const x of plan) {
    if (!x || typeof x !== "object") continue;
    const { id, startHour, reason } = x;
    const r = recs.find((q) => q.id === id);
    if (!r || typeof id !== "string" || seen.has(id)) continue;
    const hours = (r.hectaresSavedByStartHour ?? []).map((t) => t.startHour);
    if (!hours.length) continue;
    const want = Number(startHour);
    const h = hours.reduce((best, v) => Math.abs(v - want) < Math.abs(best - want) ? v : best, hours[0]);
    seen.add(id);
    out.push({ id, startHour: h, reason: typeof reason === "string" ? reason.slice(0, 120) : "" });
  }
  return out;
}
async function readBody(req, limit = 2e5) {
  const pre = req.body;
  if (pre !== void 0) return typeof pre === "string" ? pre : JSON.stringify(pre);
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error("payload too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function briefHandler(getCfg) {
  return async (req, res, next) => {
    if (!req.url?.startsWith("/api/brief")) return next();
    res.setHeader("content-type", "application/json");
    if (req.method === "GET") {
      const c = getCfg();
      res.end(JSON.stringify({ enabled: !!(c.apiKey && c.baseUrl && c.model), model: c.model ?? null }));
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("{}");
      return;
    }
    const cfg = getCfg();
    if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "LLM_API_KEY / LLM_BASE_URL / LLM_MODEL not set" }));
      return;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const lang = body.lang === "id" ? "Bahasa Indonesia" : "English";
      const r = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.2,
          max_tokens: 1400,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: `Write the brief and the plan reasons in ${lang}.

Simulation output (JSON):
${JSON.stringify(body.data)}` }
          ]
        }),
        signal: AbortSignal.timeout(9e4)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: j?.error?.message ?? `LLM HTTP ${r.status}` }));
        return;
      }
      const { brief, plan } = parseReply(j?.choices?.[0]?.message?.content ?? "");
      res.end(JSON.stringify({ text: brief, plan: validPlan(plan, body.data?.recommendations ?? []), model: j?.model ?? cfg.model }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  };
}

// server/firmsProxy.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
var SOURCES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"];
var cache = /* @__PURE__ */ new Map();
var TTL_MS = 10 * 60 * 1e3;
function firmsHandler(getKey) {
  return async (req, res, next) => {
    if (!req.url?.startsWith("/api/firms")) return next();
    const u = new URL(req.url, "http://local");
    const bbox = (u.searchParams.get("bbox") ?? "").split(",").map(Number);
    const days = Number(u.searchParams.get("days") ?? "1");
    const date = u.searchParams.get("date") ?? "";
    const valid = (date === "" || /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date))) && bbox.length === 4 && bbox.every(Number.isFinite) && bbox[0] >= -180 && bbox[2] <= 180 && bbox[1] >= -90 && bbox[3] <= 90 && bbox[0] < bbox[2] && bbox[1] < bbox[3] && Number.isInteger(days) && days >= 1 && days <= 5;
    if (!valid) {
      res.statusCode = 400;
      res.end("bad bbox/days");
      return;
    }
    const key = getKey();
    if (!key) {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "FIRMS_MAP_KEY not set" }));
      return;
    }
    const area = bbox.map((v) => v.toFixed(4)).join(",");
    const ck = `${area}|${days}|${date}`;
    const hit = cache.get(ck);
    res.setHeader("content-type", "application/json");
    if (hit && Date.now() - hit.at < TTL_MS) {
      res.end(hit.body);
      return;
    }
    try {
      const csv = await Promise.all(
        SOURCES.map(async (s) => {
          const r = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${s}/${area}/${days}${date ? `/${date}` : ""}`);
          const t = await r.text();
          return r.ok && t.startsWith("latitude") ? t : "";
        })
      );
      const body = JSON.stringify({ sources: SOURCES, csv });
      cache.set(ck, { at: Date.now(), body });
      res.end(body);
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: String(e) }));
    }
  };
}
var OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
var OSM_DIR = join(process.cwd(), ".cache", "osm");
var osmCache = /* @__PURE__ */ new Map();
var diskKey = (bb) => join(OSM_DIR, `${bb.replace(/[^0-9.,-]/g, "")}.json`);
async function overpass(q, key, timeoutMs, deadlineMs = Infinity) {
  const until = Date.now() + deadlineMs;
  const hit = osmCache.get(key) ?? (existsSync(diskKey(key)) ? readFileSync(diskKey(key), "utf8") : void 0);
  if (hit) {
    osmCache.set(key, hit);
    return hit;
  }
  for (const url of OVERPASS) {
    const left = until - Date.now();
    if (left < 2e3) break;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": "FireSeptum/0.2 (IEEE ClimateChain hackathon prototype)", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(Math.min(timeoutMs, left))
      });
      const t = await r.text();
      if (r.ok && t.trimStart().startsWith("{")) {
        osmCache.set(key, t);
        try {
          mkdirSync(OSM_DIR, { recursive: true });
          writeFileSync(diskKey(key), t);
        } catch {
        }
        return t;
      }
    } catch {
    }
  }
  return null;
}
var SNAPSHOT = "data/osm-facilities.json";
function snapshotNear(lat, lon, radiusKm) {
  if (!existsSync(SNAPSHOT)) return null;
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const kmPerDeg = 111.32;
  const elements = snap.elements.filter((e) => Math.hypot((e.lat - lat) * kmPerDeg, (e.lon - lon) * kmPerDeg * Math.cos(lat * Math.PI / 180)) <= radiusKm).map((e) => ({ type: e.id.split("/")[0], id: Number(e.id.split("/")[1]), lat: e.lat, lon: e.lon, tags: e.tags }));
  return { origin: "snapshot", snapshotAt: snap.fetchedAt, elements };
}
function osmHandler() {
  return async (req, res, next) => {
    const u = new URL(req.url ?? "/", "http://local");
    res.setHeader("content-type", "application/json");
    if (u.pathname === "/api/osm") {
      const b = (u.searchParams.get("bbox") ?? "").split(",").map(Number);
      const ok = b.length === 4 && b.every(Number.isFinite) && b[0] < b[2] && b[1] < b[3] && b[2] - b[0] < 0.2 && b[3] - b[1] < 0.2;
      if (!ok) {
        res.statusCode = 400;
        res.end("bad bbox (max 0.2\xB0)");
        return;
      }
      const bb = b.map((v) => v.toFixed(5)).join(",");
      const q = `[out:json][timeout:25];(
        way["natural"~"^(water|wetland|wood|scrub|grassland)$"](${bb});
        relation["natural"="water"](${bb});
        way["waterway"~"^(river|canal|stream|ditch|drain)$"](${bb});
        way["landuse"~"^(residential|industrial|commercial|retail|farmland|meadow|paddy|plantation|orchard|forest|grass|reservoir|basin)$"](${bb});
        way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bb});
      );out geom;`;
      const t = await overpass(q, bb, 12e3);
      if (t) res.end(t);
      else {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: "all Overpass mirrors failed" }));
      }
      return;
    }
    if (u.pathname === "/api/osm-resources") {
      const lat = Number(u.searchParams.get("lat")), lon = Number(u.searchParams.get("lon"));
      if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) {
        res.statusCode = 400;
        res.end("bad lat/lon");
        return;
      }
      const c = `${lat.toFixed(3)},${lon.toFixed(3)}`;
      const q = `[out:json][timeout:60];(
        nwr["amenity"="fire_station"](around:80000,${c});
        nwr["aeroway"~"^(helipad|heliport|aerodrome|airstrip)$"](around:80000,${c});
        nwr["office"]["name"~"[Mm]anggala|[Dd]aops|BPBD|BNPB"](around:80000,${c});
      )->.bases;
      (
        way["waterway"~"^(river|canal)$"](around:15000,${c});
        way["natural"="water"](around:15000,${c});
        way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|track|service)$"](around:15000,${c});
      )->.near;
      .bases out tags center;
      .near out geom;`;
      const t = await overpass(q, `res-${c}`, 15e3, 25e3);
      if (t) {
        res.end(t.replace(/^\s*\{/, `{"origin":"live",`));
        return;
      }
      const snap = snapshotNear(lat, lon, 80);
      if (snap) {
        res.end(JSON.stringify(snap));
        return;
      }
      res.statusCode = 502;
      res.end(JSON.stringify({ error: "all Overpass mirrors failed and no snapshot (run node scripts/snapshot-facilities.mjs)" }));
      return;
    }
    next();
  };
}

// server/receipt.ts
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname, join as join2 } from "node:path";
var KEY_FILE = join2(process.cwd(), ".cache", "receipt-ed25519.pem");
var KeyMissing = class extends Error {
  constructor() {
    super("RECEIPT_ED25519_KEY not set");
  }
};
function loadKey(pem) {
  if (pem) return createPrivateKey(pem.replace(/\\n/g, "\n"));
  if (existsSync2(KEY_FILE)) return createPrivateKey(readFileSync2(KEY_FILE, "utf8"));
  if (process.env.VERCEL) throw new KeyMissing();
  const { privateKey } = generateKeyPairSync("ed25519");
  mkdirSync2(dirname(KEY_FILE), { recursive: true });
  writeFileSync2(KEY_FILE, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 384 });
  return privateKey;
}
var rawPublic = (k) => createPublicKey(k).export({ type: "spki", format: "der" }).subarray(-32);
var CALENDARS = ["https://a.pool.opentimestamps.org", "https://b.pool.opentimestamps.org", "https://a.pool.eternitywall.com"];
var OTS_MAGIC = Buffer.from("004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294", "hex");
async function anchor(hex) {
  const digest = Buffer.from(hex, "hex");
  for (const cal of CALENDARS) {
    try {
      const r = await fetch(`${cal}/digest`, {
        method: "POST",
        headers: { Accept: "application/vnd.opentimestamps.v1", "User-Agent": "FireSeptum/0.2 (IEEE ClimateChain hackathon prototype)" },
        body: digest,
        signal: AbortSignal.timeout(1e4)
      });
      if (!r.ok) continue;
      const ts = Buffer.from(await r.arrayBuffer());
      return { calendar: cal, ots: Buffer.concat([OTS_MAGIC, Buffer.from([1, 8]), digest, ts]) };
    } catch {
    }
  }
  return null;
}
async function readJson(req) {
  const pre = req.body;
  if (pre !== void 0) return typeof pre === "string" ? JSON.parse(pre || "{}") : pre ?? {};
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new Error("body too large");
  }
  return JSON.parse(body || "{}");
}
var HEX64 = /^[0-9a-f]{64}$/;
function receiptHandler(getPem) {
  let key = null;
  const getKey = () => key ??= loadKey(getPem());
  return async (req, res, next) => {
    const path = (req.url ?? "").split("?")[0];
    if (!path.startsWith("/api/receipt/")) return next();
    res.setHeader("content-type", "application/json");
    const send = (status, body) => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    };
    try {
      const pub = rawPublic(getKey());
      const publicKey = pub.toString("base64");
      const keyId = createHash("sha256").update(pub).digest("hex").slice(0, 16);
      if (path === "/api/receipt/key" && req.method === "GET") return send(200, { alg: "Ed25519", publicKey, keyId });
      if (req.method !== "POST") return send(405, { error: "method not allowed" });
      const body = await readJson(req);
      const hash = String(body.receiptSha256 ?? "");
      if (!HEX64.test(hash)) return send(400, { error: "receiptSha256 must be 64 lowercase hex digits" });
      if (path === "/api/receipt/sign") {
        const scheme = String(body.scheme ?? "fireseptum-receipt-v2");
        if (scheme !== "fireseptum-receipt-v2" && scheme !== "sekatapi-receipt-v1") return send(400, { error: "unknown signature scheme" });
        const signedAt = (/* @__PURE__ */ new Date()).toISOString();
        const sig = sign(null, Buffer.from(`${scheme}:${hash}:${signedAt}`), getKey()).toString("base64");
        return send(200, { alg: "Ed25519", scheme, publicKey, keyId, signedAt, sig });
      }
      if (path === "/api/receipt/anchor") {
        const a = await anchor(hash);
        if (!a) return send(502, { error: "no OpenTimestamps calendar answered" });
        return send(200, { calendar: a.calendar, submittedAt: (/* @__PURE__ */ new Date()).toISOString(), otsB64: a.ots.toString("base64") });
      }
      return send(404, { error: "unknown endpoint" });
    } catch (e) {
      return send(e instanceof KeyMissing ? 503 : 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

// server/register.ts
import { createHash as createHash2 } from "node:crypto";
import { mkdirSync as mkdirSync3, readFileSync as readFileSync3, readdirSync, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
var DIR = join3(process.cwd(), "data", "register");
var HEX642 = /^[0-9a-f]{64}$/;
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v;
    return `{${Object.keys(o).filter((k) => o[k] !== void 0).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
var fileFor = (hash) => readdirSync(DIR).find((f) => f.endsWith(`_${hash.slice(0, 16)}.json`));
var READ_ONLY = !!process.env.VERCEL;
async function readJson2(req) {
  const pre = req.body;
  if (pre !== void 0) return typeof pre === "string" ? JSON.parse(pre || "{}") : pre ?? {};
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4e6) throw new Error("body too large");
  }
  return JSON.parse(body || "{}");
}
function registerHandler(req, res, next) {
  const path = (req.url ?? "").split("?")[0];
  if (path !== "/api/register" && path !== "/api/register/score") return next();
  res.setHeader("content-type", "application/json");
  const send = (status, body) => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  };
  (async () => {
    if (!READ_ONLY) mkdirSync3(DIR, { recursive: true });
    if (req.method === "GET" && path === "/api/register") {
      const entries = readdirSync(DIR).filter((f2) => f2.endsWith(".json")).sort().map((f2) => JSON.parse(readFileSync3(join3(DIR, f2), "utf8")));
      return send(200, { entries });
    }
    if (req.method !== "POST") return send(405, { error: "method not allowed" });
    if (READ_ONLY) return send(405, { error: "The hosted register is read-only. Run Fire Septum locally to seal or score a forecast; entries are published with the code." });
    const body = await readJson2(req);
    if (path === "/api/register") {
      const e = body.entry;
      const hash2 = String(e?.record?.receiptSha256 ?? "");
      if (e?.kind !== "fireseptum.preregistered-forecast" && e?.kind !== "sekatapi.preregistered-forecast" || !HEX642.test(hash2) || !e.issuedAt || Number.isNaN(Date.parse(e.issuedAt))) return send(400, { error: "not a register entry" });
      if (createHash2("sha256").update(canonical(e.record.receipt)).digest("hex") !== hash2) return send(400, { error: "receipt does not match its hash" });
      if (fileFor(hash2)) return send(409, { error: "already registered" });
      const name = `${e.issuedAt.slice(0, 13).replace(/[-:T]/g, "")}_${hash2.slice(0, 16)}.json`;
      writeFileSync3(join3(DIR, name), JSON.stringify(e, null, 1));
      return send(200, { ok: true, file: `data/register/${name}` });
    }
    const hash = String(body.receiptSha256 ?? "");
    const f = HEX642.test(hash) ? fileFor(hash) : void 0;
    if (!f) return send(404, { error: "unknown forecast" });
    const entry = JSON.parse(readFileSync3(join3(DIR, f), "utf8"));
    if (entry.score) return send(409, { error: "already scored", score: entry.score });
    entry.score = body.score;
    writeFileSync3(join3(DIR, f), JSON.stringify(entry, null, 1));
    return send(200, { ok: true });
  })().catch((err) => send(500, { error: err instanceof Error ? err.message : String(err) }));
}

// api/_entry.ts
var chain = [
  firmsHandler(() => process.env.FIRMS_MAP_KEY),
  osmHandler(),
  receiptHandler(() => process.env.RECEIPT_ED25519_KEY),
  registerHandler,
  briefHandler(() => ({ baseUrl: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL }))
];
function handler(req, res) {
  return new Promise((resolve) => {
    res.once("finish", resolve);
    res.once("close", resolve);
    let i = 0;
    const next = () => {
      const h = chain[i++];
      if (!h) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: `no handler for ${(req.url ?? "").split("?")[0]}` }));
        return;
      }
      Promise.resolve(h(req, res, next)).catch((e) => {
        if (res.headersSent) {
          res.end();
          return;
        }
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      });
    };
    next();
  });
}
export {
  handler as default
};
