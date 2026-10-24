// server/bmkg.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
var UA = "FireSeptum/0.2 (IEEE ClimateChain hackathon prototype)";
var lookup = null;
function loadLookup() {
  if (lookup) return lookup;
  for (const p of [join(process.cwd(), "public", "data", "bmkg-adm4.json"), join(process.cwd(), "dist", "data", "bmkg-adm4.json")]) {
    if (existsSync(p)) return lookup = JSON.parse(readFileSync(p, "utf8"));
  }
  throw new Error("public/data/bmkg-adm4.json not found (node scripts/bmkg-adm4.mjs)");
}
var kmBetween = (lat1, lon1, lat2, lon2) => Math.hypot((lat2 - lat1) * 110.574, (lon2 - lon1) * 111.32 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180));
function nearestAdm4(lat, lon, rows) {
  let best = null;
  for (const [adm4, la, lo] of rows) {
    if (Math.abs(la - lat) > 1 || Math.abs(lo - lon) > 1) continue;
    const km = kmBetween(lat, lon, la, lo);
    if (!best || km < best.km) best = { adm4, km };
  }
  return best && best.km <= 75 ? best : null;
}
var calls = [];
function allowCall(limit = 40) {
  const now = Date.now();
  while (calls.length && now - calls[0] > 6e4) calls.shift();
  if (calls.length >= limit) return false;
  calls.push(now);
  return true;
}
var forecastCache = /* @__PURE__ */ new Map();
var FORECAST_TTL = 60 * 60 * 1e3;
async function bmkgForecast(adm4) {
  const hit = forecastCache.get(adm4);
  if (hit && Date.now() - hit.at < FORECAST_TTL) return hit.body;
  if (!allowCall()) throw Object.assign(new Error("BMKG rate limit reached here, try again in a minute"), { status: 429 });
  const r = await fetch(`https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${adm4}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12e3) });
  if (!r.ok) throw Object.assign(new Error(`BMKG HTTP ${r.status}`), { status: 502 });
  const j = await r.json();
  const steps = (j.data?.[0]?.cuaca ?? []).flat();
  const l = j.lokasi ?? {};
  const body = JSON.stringify({
    adm4,
    lokasi: { desa: l.desa, kecamatan: l.kecamatan, kotkab: l.kotkab, provinsi: l.provinsi, lat: l.lat, lon: l.lon, timezone: l.timezone },
    analysisDate: steps[0]?.analysis_date ?? null,
    // BMKG documents ws in km/h, wd_deg as the direction the wind comes from, tp in mm, hu in %.
    hours: steps.map((s) => ({
      utc: s.datetime,
      local: s.local_datetime ?? null,
      tempC: s.t,
      rh: s.hu ?? null,
      windKmh: s.ws ?? null,
      windFromDeg: s.wd_deg ?? null,
      precipMm: s.tp ?? null,
      cloudPct: s.tcc ?? null,
      weather: s.weather_desc_en ?? null
    })),
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    attribution: "BMKG (Badan Meteorologi, Klimatologi, dan Geofisika), api.bmkg.go.id"
  });
  forecastCache.set(adm4, { at: Date.now(), body });
  return body;
}
var FDRS_REGIONS = ["36_indonesia", "37_sumatera", "38_kalimantan", "20_kalbar", "21_kalsel", "22_kalteng", "04_riau", "06_jambi", "08_sumsel"];
var FDRS_VARS = ["ffmc", "dmc", "dc", "bui", "isi", "fwi"];
var FDRS_DAYS = ["obs", "00", "01", "02", "03", "04", "05", "06", "07"];
var fdrsCache = /* @__PURE__ */ new Map();
var FDRS_TTL = 3 * 60 * 60 * 1e3;
var SIPONGI = "https://opsroom.sipongidata.my.id/api";
var sipongiCache = /* @__PURE__ */ new Map();
var SIPONGI_TTL = 10 * 60 * 1e3;
var SIPONGI_DENIED = "SiPongi (Kementerian Kehutanan) does not allow access to its data without written permission from the Ministry. This adapter stays off until an operator who holds that permission sets SIPONGI_PERMISSION=granted on the server.";
var pick = (p, ...keys) => {
  for (const k of keys) {
    const v = p[k] ?? p[k.toLowerCase()] ?? p[k.toUpperCase()];
    if (v !== void 0 && v !== null && v !== "") return v;
  }
  return null;
};
var num = (v) => v === null || v === void 0 || v === "" ? null : Number(v);
function normalizeHotspots(j) {
  return (j.features ?? []).filter((f) => f.geometry?.type === "Point" && f.geometry.coordinates).map((f) => {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry.coordinates;
    return {
      lat,
      lon,
      desa: pick(p, "desa"),
      kecamatan: pick(p, "kecamatan"),
      kabkota: pick(p, "kabkota", "kabupaten"),
      provinsi: pick(p, "provinsi"),
      kawasan: pick(p, "kawasan"),
      satellite: pick(p, "satelit", "satellite", "sumber"),
      confidence: pick(p, "confidence", "kepercayaan"),
      time: pick(p, "date_hotspot", "tanggal", "waktu", "acq_date")
    };
  });
}
function normalizeTmat(j) {
  const rows = Array.isArray(j) ? j : Array.isArray(j?.features) ? j.features.map((f) => ({ ...f.properties ?? {}, lon: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1] })) : Array.isArray(j?.data) ? j.data : [];
  return rows.map((r) => ({
    id: String(pick(r, "id", "kode", "station_id") ?? ""),
    name: pick(r, "nama", "name", "station", "nama_stasiun"),
    company: pick(r, "konsesi", "perusahaan", "company"),
    lat: num(pick(r, "lat", "latitude", "Latitude")),
    lon: num(pick(r, "lon", "lng", "longitude", "Longitude")),
    waterLevelCm: num(pick(r, "WaterLevel", "water_level", "tmat")),
    time: pick(r, "tanggal", "waktu", "datetime", "updated_at")
  })).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
}
async function sipongi(path, query, normalize) {
  const k = `${path}?${query}`;
  const hit = sipongiCache.get(k);
  if (hit && Date.now() - hit.at < SIPONGI_TTL) return hit.body;
  const r = await fetch(`${SIPONGI}/${k}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15e3) });
  if (!r.ok) throw Object.assign(new Error(`SiPongi HTTP ${r.status}`), { status: 502 });
  const body = JSON.stringify({ items: normalize(await r.json()), fetchedAt: (/* @__PURE__ */ new Date()).toISOString(), attribution: "SiPongi, Kementerian Kehutanan Republik Indonesia (used with permission)" });
  sipongiCache.set(k, { at: Date.now(), body });
  return body;
}
function bmkgHandler(getSipongi) {
  return async (req, res, next) => {
    const u = new URL(req.url ?? "/", "http://local");
    const path = u.pathname;
    if (path !== "/api/bmkg" && path !== "/api/bmkg-fdrs" && !path.startsWith("/api/sipongi/")) return next();
    const json = (status, body) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    if (req.method !== "GET") return json(405, { error: "method not allowed" });
    try {
      if (path === "/api/bmkg") {
        const lat = Number(u.searchParams.get("lat")), lon = Number(u.searchParams.get("lon"));
        if (!(lat >= -11 && lat <= 6.5 && lon >= 94 && lon <= 141.5)) return json(400, { error: "lat/lon must be in Indonesia" });
        const near = nearestAdm4(lat, lon, loadLookup().rows);
        if (!near) return json(404, { error: "No BMKG forecast point here: the lookup covers the peat provinces of Sumatra and Kalimantan." });
        const body = JSON.parse(await bmkgForecast(near.adm4));
        const ll = body.lokasi;
        body.distanceKm = Number.isFinite(ll?.lat) ? Math.round(kmBetween(lat, lon, ll.lat, ll.lon) * 10) / 10 : null;
        return json(200, body);
      }
      if (path === "/api/bmkg-fdrs") {
        const region = u.searchParams.get("region") ?? "", v = u.searchParams.get("var") ?? "", day = u.searchParams.get("day") ?? "00";
        if (!FDRS_REGIONS.includes(region) || !FDRS_VARS.includes(v) || !FDRS_DAYS.includes(day)) return json(400, { error: "unknown region, var or day" });
        const name = `${region}_${v}_${day}`;
        let hit = fdrsCache.get(name);
        if (!hit || Date.now() - hit.at > FDRS_TTL) {
          const r = await fetch(`https://dataweb.bmkg.go.id/cuaca/spartan/${name}.png`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15e3) });
          const type = r.headers.get("content-type") ?? "";
          if (!r.ok || !type.startsWith("image/png")) return json(502, { error: `BMKG fire danger map HTTP ${r.status}` });
          hit = { at: Date.now(), png: Buffer.from(await r.arrayBuffer()) };
          fdrsCache.set(name, hit);
        }
        res.statusCode = 200;
        res.setHeader("content-type", "image/png");
        res.setHeader("cache-control", "public, max-age=3600");
        res.setHeader("x-source", `BMKG SPARTAN ${name}.png, fetched ${new Date(hit.at).toISOString()}`);
        res.end(hit.png);
        return;
      }
      const enabled = getSipongi() === "granted";
      if (path === "/api/sipongi/status") return json(200, { enabled, note: enabled ? "Enabled by the operator (SIPONGI_PERMISSION=granted)." : SIPONGI_DENIED });
      if (!enabled) return json(403, { error: SIPONGI_DENIED });
      if (path === "/api/sipongi/hotspots") {
        return json(200, await sipongi("opsroom/indoHotspot", "wilayah=IN&filterperiode=false&late=24&satelit[]=NASA-SNPP&confidence[]=high", (j) => normalizeHotspots(j)));
      }
      if (path === "/api/sipongi/tmat") return json(200, await sipongi("tmat/konsesi", "", normalizeTmat));
      return json(404, { error: "unknown endpoint" });
    } catch (e) {
      const status = e.status ?? 502;
      return json(status, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

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

// server/evidence.ts
import { createHash } from "node:crypto";
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, readdirSync, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
var DIR = join2(process.cwd(), "data", "evidence");
var HEX64 = /^[0-9a-f]{64}$/;
var READ_ONLY = !!process.env.VERCEL;
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v;
    return `{${Object.keys(o).filter((k) => o[k] !== void 0).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
async function readJson(req) {
  const pre = req.body;
  if (pre !== void 0) return typeof pre === "string" ? JSON.parse(pre || "{}") : pre ?? {};
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2e6) throw new Error("body too large");
  }
  return JSON.parse(body || "{}");
}
var list = () => existsSync2(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".json")).sort() : [];
function evidenceHandler(req, res, next) {
  const path = (req.url ?? "").split("?")[0];
  if (path !== "/api/evidence") return next();
  res.setHeader("content-type", "application/json");
  const send = (status, body) => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  };
  (async () => {
    if (req.method === "GET") return send(200, { entries: list().map((f) => JSON.parse(readFileSync2(join2(DIR, f), "utf8"))) });
    if (req.method !== "POST") return send(405, { error: "method not allowed" });
    if (READ_ONLY) return send(405, { error: "The hosted evidence store is read-only. Download the JSON, or run Fire Septum locally to keep evidence in data/evidence/." });
    const body = await readJson(req);
    const b = body.bundle;
    const hash = String(b?.evidenceSha256 ?? "");
    const e = b?.evidence;
    const pid = String(e?.project?.id ?? "");
    if (e?.kind !== "fireseptum.reversal-evidence" || !HEX64.test(hash) || !e.createdAt || Number.isNaN(Date.parse(e.createdAt)) || !/^[a-z0-9-]{1,32}$/.test(pid)) return send(400, { error: "not a reversal evidence bundle" });
    if (createHash("sha256").update(canonical(e)).digest("hex") !== hash) return send(400, { error: "evidence does not match its hash" });
    mkdirSync(DIR, { recursive: true });
    if (list().some((f) => f.endsWith(`_${hash.slice(0, 16)}.json`))) return send(409, { error: "already stored" });
    const name = `${e.createdAt.slice(0, 13).replace(/[-:T]/g, "")}_${pid}_${hash.slice(0, 16)}.json`;
    writeFileSync(join2(DIR, name), JSON.stringify(b, null, 1), { flag: "wx" });
    return send(200, { ok: true, file: `data/evidence/${name}` });
  })().catch((err) => send(500, { error: err instanceof Error ? err.message : String(err) }));
}

// server/firmsProxy.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync3, writeFileSync as writeFileSync2, existsSync as existsSync3 } from "node:fs";
import { join as join3 } from "node:path";
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
var OSM_DIR = join3(process.cwd(), ".cache", "osm");
var osmCache = /* @__PURE__ */ new Map();
var diskKey = (bb) => join3(OSM_DIR, `${bb.replace(/[^0-9.,-]/g, "")}.json`);
async function overpass(q, key, timeoutMs, deadlineMs = Infinity) {
  const until = Date.now() + deadlineMs;
  const hit = osmCache.get(key) ?? (existsSync3(diskKey(key)) ? readFileSync3(diskKey(key), "utf8") : void 0);
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
          mkdirSync2(OSM_DIR, { recursive: true });
          writeFileSync2(diskKey(key), t);
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
  if (!existsSync3(SNAPSHOT)) return null;
  const snap = JSON.parse(readFileSync3(SNAPSHOT, "utf8"));
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
import { createHash as createHash2, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname, join as join4 } from "node:path";
var KEY_FILE = join4(process.cwd(), ".cache", "receipt-ed25519.pem");
var KeyMissing = class extends Error {
  constructor() {
    super("RECEIPT_ED25519_KEY not set");
  }
};
function loadKey(pem) {
  if (pem) return createPrivateKey(pem.replace(/\\n/g, "\n"));
  if (existsSync4(KEY_FILE)) return createPrivateKey(readFileSync4(KEY_FILE, "utf8"));
  if (process.env.VERCEL) throw new KeyMissing();
  const { privateKey } = generateKeyPairSync("ed25519");
  mkdirSync3(dirname(KEY_FILE), { recursive: true });
  writeFileSync3(KEY_FILE, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 384 });
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
async function readJson2(req) {
  const pre = req.body;
  if (pre !== void 0) return typeof pre === "string" ? JSON.parse(pre || "{}") : pre ?? {};
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new Error("body too large");
  }
  return JSON.parse(body || "{}");
}
var HEX642 = /^[0-9a-f]{64}$/;
var SCHEMES = ["fireseptum-receipt-v2", "sekatapi-receipt-v1", "fireseptum-decision-v1"];
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
      const keyId = createHash2("sha256").update(pub).digest("hex").slice(0, 16);
      if (path === "/api/receipt/key" && req.method === "GET") return send(200, { alg: "Ed25519", publicKey, keyId });
      if (req.method !== "POST") return send(405, { error: "method not allowed" });
      const body = await readJson2(req);
      const hash = String(body.receiptSha256 ?? "");
      if (!HEX642.test(hash)) return send(400, { error: "receiptSha256 must be 64 lowercase hex digits" });
      if (path === "/api/receipt/sign") {
        const scheme = String(body.scheme ?? "fireseptum-receipt-v2");
        if (!SCHEMES.includes(scheme)) return send(400, { error: "unknown signature scheme" });
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

// server/decisions.ts
import { createHash as createHash3, createPublicKey as createPublicKey2, verify } from "node:crypto";
import { mkdirSync as mkdirSync4, readFileSync as readFileSync5, readdirSync as readdirSync2, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join5 } from "node:path";
var DIR2 = join5(process.cwd(), "data", "decisions");
var HEX643 = /^[0-9a-f]{64}$/;
var ROLES = ["forecaster", "commander", "bpbd"];
var READ_ONLY2 = !!process.env.VERCEL;
function canonical2(v) {
  if (Array.isArray(v)) return `[${v.map(canonical2).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v;
    return `{${Object.keys(o).filter((k) => o[k] !== void 0).sort().map((k) => `${JSON.stringify(k)}:${canonical2(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
var sha256 = (b) => createHash3("sha256").update(b).digest("hex");
var list2 = () => {
  try {
    return readdirSync2(DIR2).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
};
var fileFor = (hash) => list2().find((f) => f.endsWith(`_${hash.slice(0, 16)}.json`));
function cosignatureValid(hash, c) {
  try {
    if (c.alg !== "Ed25519" || c.scheme !== "fireseptum-cosign-v1" || !ROLES.includes(String(c.role)) || !c.signedAt || !c.name) return false;
    const pub = Buffer.from(String(c.publicKey), "base64");
    if (pub.length !== 32 || sha256(pub).slice(0, 16) !== c.keyId) return false;
    const key = createPublicKey2({ key: { kty: "OKP", crv: "Ed25519", x: pub.toString("base64url") }, format: "jwk" });
    return verify(null, Buffer.from(`fireseptum-cosign-v1:${hash}:${c.role}:${c.signedAt}`), key, Buffer.from(String(c.sig), "base64"));
  } catch {
    return false;
  }
}
async function readJson3(req) {
  const pre = req.body;
  if (pre !== void 0) return typeof pre === "string" ? JSON.parse(pre || "{}") : pre ?? {};
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2e5) throw new Error("body too large");
  }
  return JSON.parse(body || "{}");
}
function decisionsHandler(req, res, next) {
  const path = (req.url ?? "").split("?")[0];
  if (path !== "/api/decisions" && path !== "/api/decisions/cosign") return next();
  res.setHeader("content-type", "application/json");
  const send = (status, body) => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  };
  (async () => {
    if (req.method === "GET" && path === "/api/decisions") {
      return send(200, { records: list2().map((f2) => JSON.parse(readFileSync5(join5(DIR2, f2), "utf8"))) });
    }
    if (req.method !== "POST") return send(405, { error: "method not allowed" });
    if (READ_ONLY2) return send(405, { error: "The hosted decision log is read-only. Run Fire Septum locally to store a decision; records are published with the code. You can still download the sealed decision." });
    mkdirSync4(DIR2, { recursive: true });
    const body = await readJson3(req);
    if (path === "/api/decisions") {
      const r = body.record;
      const hash2 = String(r?.decisionSha256 ?? "");
      const at = r?.decision?.decidedAt ?? "";
      if (r?.decision?.kind !== "fireseptum.decision" || !HEX643.test(hash2) || Number.isNaN(Date.parse(at))) return send(400, { error: "not a decision record" });
      if (sha256(canonical2(r.decision)) !== hash2) return send(400, { error: "decision does not match its hash" });
      if ((r.cosignatures ?? []).some((c2) => !cosignatureValid(hash2, c2))) return send(400, { error: "a co-signature does not verify" });
      if (fileFor(hash2)) return send(409, { error: "already stored" });
      const name = `${new Date(at).toISOString().slice(0, 13).replace(/[-:T]/g, "")}_${hash2.slice(0, 16)}.json`;
      writeFileSync4(join5(DIR2, name), JSON.stringify(r, null, 1));
      return send(200, { ok: true, file: `data/decisions/${name}` });
    }
    const hash = String(body.decisionSha256 ?? "");
    const f = HEX643.test(hash) ? fileFor(hash) : void 0;
    if (!f) return send(404, { error: "unknown decision" });
    const c = body.cosignature;
    if (!cosignatureValid(hash, c)) return send(400, { error: "co-signature does not verify" });
    const rec = JSON.parse(readFileSync5(join5(DIR2, f), "utf8"));
    if (rec.decisionSha256 !== hash) return send(409, { error: "stored file does not match" });
    const cur = rec.cosignatures ?? [];
    if (cur.some((x) => x.keyId === c.keyId && x.role === c.role)) return send(200, { ok: true, record: rec });
    rec.cosignatures = [...cur, c];
    writeFileSync4(join5(DIR2, f), JSON.stringify(rec, null, 1));
    return send(200, { ok: true, record: rec });
  })().catch((err) => send(500, { error: err instanceof Error ? err.message : String(err) }));
}

// server/register.ts
import { createHash as createHash4, timingSafeEqual } from "node:crypto";
import { join as join7 } from "node:path";

// server/store.ts
import { existsSync as existsSync5, mkdirSync as mkdirSync5, readFileSync as readFileSync6, readdirSync as readdirSync3, statSync, writeFileSync as writeFileSync5 } from "node:fs";
import { dirname as dirname2, join as join6 } from "node:path";
function vercelBlob(token, access = "public") {
  const sdk = () => import("@vercel/blob");
  const exists = async (pathname) => {
    const { head, BlobNotFoundError } = await sdk();
    try {
      await head(pathname, { token });
      return true;
    } catch (e) {
      if (e instanceof BlobNotFoundError) return false;
      throw e;
    }
  };
  return {
    async list(prefix) {
      const { list: list3 } = await sdk();
      const out = [];
      let cursor;
      do {
        const r = await list3({ prefix, cursor, token, limit: 1e3 });
        out.push(...r.blobs.map((b) => b.pathname));
        cursor = r.hasMore ? r.cursor : void 0;
      } while (cursor);
      return out.sort();
    },
    async read(pathname) {
      const { get } = await sdk();
      const r = await get(pathname, { access, token });
      if (!r || r.statusCode !== 200) return null;
      return new Response(r.stream).text();
    },
    exists,
    async create(pathname, body) {
      if (await exists(pathname)) return false;
      const { put } = await sdk();
      try {
        await put(pathname, body, { access, token, addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" });
        return true;
      } catch (e) {
        if (/already exists/i.test(e instanceof Error ? e.message : String(e))) return false;
        throw e;
      }
    }
  };
}
function blobFromEnv(env = process.env) {
  const token = env.BLOB_READ_WRITE_TOKEN;
  return token ? vercelBlob(token, env.BLOB_ACCESS === "private" ? "private" : "public") : null;
}
var h16 = (hash) => hash.slice(0, 16);
function walk(dir, recursive, base = "") {
  if (!existsSync5(dir)) return [];
  const out = [];
  for (const f of readdirSync3(dir).sort()) {
    const rel = base ? `${base}/${f}` : f;
    if (f.endsWith(".json")) out.push(rel);
    else if (recursive && statSync(join6(dir, f)).isDirectory()) out.push(...walk(join6(dir, f), recursive, rel));
  }
  return out;
}
function collection(o) {
  const mode = !o.readOnly ? "fs" : o.blob ? "blob" : "read-only";
  const blob = mode === "blob" ? o.blob : null;
  const recPrefix = `${o.prefix}/records/`, scorePrefix = `${o.prefix}/scores/`;
  const readFile = (rel) => JSON.parse(readFileSync6(join6(o.dir, rel), "utf8"));
  const fileFor2 = (hash) => walk(o.dir, !!o.recursive).find((f) => f.endsWith(`_${h16(hash)}.json`));
  const blobFor = async (hash) => blob ? (await blob.list(recPrefix)).find((p) => p.endsWith(`_${h16(hash)}.json`)) : void 0;
  const blobScore = async (hash) => {
    const s = blob ? await blob.read(`${scorePrefix}${h16(hash)}.json`) : null;
    return s ? JSON.parse(s) : void 0;
  };
  const withBlobScore = async (rec) => {
    if (rec.score || !blob) return rec;
    const score = await blobScore(o.hashOf(rec));
    return score ? { ...rec, score } : rec;
  };
  return {
    mode,
    async list() {
      const files = walk(o.dir, !!o.recursive).map(readFile);
      if (!blob) return files;
      const seen = new Set(files.map((r) => h16(o.hashOf(r))));
      const paths = await blob.list(recPrefix);
      const scores = new Set(await blob.list(scorePrefix));
      const out = [];
      for (const r of files) out.push(scores.has(`${scorePrefix}${h16(o.hashOf(r))}.json`) ? await withBlobScore(r) : r);
      for (const p of paths) {
        const body = await blob.read(p);
        if (!body) continue;
        const r = JSON.parse(body);
        if (seen.has(h16(o.hashOf(r)))) continue;
        seen.add(h16(o.hashOf(r)));
        out.push(scores.has(`${scorePrefix}${h16(o.hashOf(r))}.json`) ? await withBlobScore(r) : r);
      }
      return out;
    },
    async find(hash) {
      const f = fileFor2(hash);
      if (f) return withBlobScore(readFile(f));
      const p = await blobFor(hash);
      const body = p ? await blob.read(p) : null;
      return body ? withBlobScore(JSON.parse(body)) : null;
    },
    async add(name, rec) {
      if (mode === "read-only") return { status: 405, error: o.readOnlyError ?? "This store is read-only here." };
      const hash = o.hashOf(rec);
      if (!name.endsWith(`_${h16(hash)}.json`)) throw new Error(`file name ${name} does not carry the record hash`);
      if (fileFor2(hash) || await blobFor(hash)) return { status: 409, error: "already registered" };
      if (blob) {
        if (!await blob.create(`${recPrefix}${name}`, JSON.stringify(rec, null, 1))) return { status: 409, error: "already registered" };
        return { status: 200, file: `blob:${recPrefix}${name}` };
      }
      const file = join6(o.dir, name);
      mkdirSync5(dirname2(file), { recursive: true });
      try {
        writeFileSync5(file, JSON.stringify(rec, null, 1), { flag: "wx" });
      } catch (e) {
        if (e.code === "EEXIST") return { status: 409, error: "already registered" };
        throw e;
      }
      return { status: 200, file: `${o.rel}/${name}` };
    },
    async addScore(hash, score) {
      if (mode === "read-only") return { status: 405, error: o.readOnlyError ?? "This store is read-only here." };
      const rec = await this.find(hash);
      if (!rec) return { status: 404, error: "unknown forecast" };
      if (rec.score) return { status: 409, error: "already scored", score: rec.score };
      if (blob) {
        if (!await blob.create(`${scorePrefix}${h16(hash)}.json`, JSON.stringify(score, null, 1))) {
          return { status: 409, error: "already scored", score: await blobScore(hash) };
        }
        return { status: 200 };
      }
      const f = fileFor2(hash);
      writeFileSync5(join6(o.dir, f), JSON.stringify({ ...rec, score }, null, 1));
      return { status: 200 };
    }
  };
}

// server/register.ts
var HEX644 = /^[0-9a-f]{64}$/;
var READ_ONLY_ERROR = "The hosted register is read-only. Run Fire Septum locally to seal or score a forecast; entries are published with the code.";
function canonical3(v) {
  if (Array.isArray(v)) return `[${v.map(canonical3).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v;
    return `{${Object.keys(o).filter((k) => o[k] !== void 0).sort().map((k) => `${JSON.stringify(k)}:${canonical3(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
var entryFileName = (issuedAt, hash) => `${issuedAt.slice(0, 13).replace(/[-:T]/g, "")}_${hash.slice(0, 16)}.json`;
function registerCollection(o = {}) {
  return collection({
    dir: join7(o.root ?? process.cwd(), "data", "register"),
    rel: "data/register",
    prefix: "register",
    hashOf: (e) => String(e.record?.receiptSha256 ?? ""),
    readOnly: o.readOnly ?? !!process.env.VERCEL,
    blob: o.blob === void 0 ? blobFromEnv() : o.blob,
    readOnlyError: READ_ONLY_ERROR
  });
}
async function readJson4(req, limit = 4e6) {
  const pre = req.body;
  if (pre !== void 0) return typeof pre === "string" ? JSON.parse(pre || "{}") : pre ?? {};
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error("body too large");
  }
  return JSON.parse(body || "{}");
}
function checkEntry(e) {
  const hash = String(e?.record?.receiptSha256 ?? "");
  if (e?.kind !== "fireseptum.preregistered-forecast" && e?.kind !== "sekatapi.preregistered-forecast" || !HEX644.test(hash) || !e.issuedAt || Number.isNaN(Date.parse(e.issuedAt))) return "not a register entry";
  if (createHash4("sha256").update(canonical3(e.record.receipt)).digest("hex") !== hash) return "receipt does not match its hash";
  return null;
}
function hasBearer(req, token) {
  if (!token) return false;
  const got = Buffer.from(String(req.headers.authorization ?? ""));
  const want = Buffer.from(`Bearer ${token}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
function makeRegisterHandler(getStore, getToken = () => process.env.REGISTER_TOKEN) {
  let store = null;
  return (req, res, next) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/api/register" && path !== "/api/register/score") return next();
    res.setHeader("content-type", "application/json");
    const send = (status, body) => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    };
    (async () => {
      store ??= getStore();
      if (req.method === "GET" && path === "/api/register") return send(200, { entries: await store.list() });
      if (req.method !== "POST") return send(405, { error: "method not allowed" });
      if (store.mode === "read-only") return send(405, { error: READ_ONLY_ERROR });
      if (store.mode !== "fs") {
        if (path === "/api/register/score") return send(405, { error: "Scores are computed and published by the daily register job, not accepted over HTTP." });
        if (!hasBearer(req, getToken())) return send(401, { error: "Hosted register writes need the operator token." });
      }
      const body = await readJson4(req);
      if (path === "/api/register") {
        const e = body.entry;
        const bad = checkEntry(e);
        if (bad) return send(400, { error: bad });
        const hash2 = e.record.receiptSha256;
        const r2 = await store.add(entryFileName(e.issuedAt, hash2), e);
        return r2.status === 200 ? send(200, { ok: true, file: r2.file }) : send(r2.status, { error: r2.error });
      }
      const hash = String(body.receiptSha256 ?? "");
      if (!HEX644.test(hash)) return send(404, { error: "unknown forecast" });
      const r = await store.addScore(hash, body.score);
      return r.status === 200 ? send(200, { ok: true }) : send(r.status, "score" in r ? { error: r.error, score: r.score } : { error: r.error });
    })().catch((err) => send(500, { error: err instanceof Error ? err.message : String(err) }));
  };
}
var registerHandler = makeRegisterHandler(() => registerCollection());

// src/sim/detmath.ts
var NATIVE = Math;
var dv = new DataView(new ArrayBuffer(8));

// src/sim/fuels.ts
var FUEL_LIST = [
  { id: "grass", label: "Fern / alang-alang grass", pveg: 0.4, pden: 0, burnHours: 1, burnable: true, color: "#c9b46a" },
  { id: "shrub", label: "Degraded peat shrub", pveg: 0.3, pden: 0.3, burnHours: 4, burnable: true, color: "#8f9a4e" },
  { id: "peat", label: "Peat swamp forest", pveg: 0, pden: 0.3, burnHours: 12, burnable: true, color: "#4f6b3a" },
  { id: "plantation", label: "Plantation (oil palm / acacia)", pveg: -0.1, pden: 0, burnHours: 3, burnable: true, color: "#6f8f45" },
  // Wet or flooded fields barely carry fire; only dry stubble and field edges do.
  { id: "agri", label: "Wet farmland / rice field", pveg: -0.7, pden: -0.7, burnHours: 1, burnable: true, color: "#a8b98a" },
  { id: "water", label: "River / canal", pveg: 0, pden: 0, burnHours: 0, burnable: false, color: "#4d7ea8" },
  { id: "settlement", label: "Village / road", pveg: 0, pden: 0, burnHours: 0, burnable: false, color: "#9a8f86" }
];
var FUEL_INDEX = Object.fromEntries(
  FUEL_LIST.map((f, i) => [f.id, i])
);

// src/sim/model.ts
var OFFSETS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
var neighFor = (m) => OFFSETS.map(([dx, dy]) => ({ dx, dy, dist: m.hypot(dx, dy), bearing: m.atan2(dx, -dy) }));
var NEIGH = neighFor(NATIVE);

// src/sim/forecast.ts
var FORECAST_SCHEMA = "fireseptum.forecast.v1";
var FORECAST_GRID = "blocks400m";
var FORECAST_WINDOW_H = 24;
var BLOCKS = 256;
var REFERENCE_MODELS = ["distance", "climatology"];
var REGISTER_MODEL = "fire-septum-ca";
var RESERVED_MODEL_IDS = [REGISTER_MODEL, ...REFERENCE_MODELS];
var CLIMATOLOGY_RATE = 114 / 836;
var INDONESIA = { south: -11.5, north: 6.5, west: 94.5, east: 141.5 };
var MAX_SUBMISSION_LAG_H = 1;
var MODEL_ID = /^[a-z0-9][a-z0-9._-]{1,62}$/;
var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
var MAX_BOXES = 50;
var isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var str = (v, max) => typeof v === "string" && v.length >= 1 && v.length <= max;
function checkProbabilities(p, at, err) {
  if (!Array.isArray(p) || p.length !== BLOCKS) {
    err.push(`${at} must be an array of ${BLOCKS} numbers`);
    return;
  }
  const bad = p.findIndex((x) => typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1);
  if (bad >= 0) err.push(`${at}[${bad}] must be a number in [0, 1]`);
}
function checkBox(b, at, err) {
  if (!isObj(b)) {
    err.push(`${at} must be an object {lat, lon}`);
    return;
  }
  if (typeof b.lat !== "number" || !(b.lat >= -90 && b.lat <= 90)) err.push(`${at}.lat must be a number in [-90, 90]`);
  if (typeof b.lon !== "number" || !(b.lon >= -180 && b.lon <= 180)) err.push(`${at}.lon must be a number in [-180, 180]`);
}
function validateForecast(f) {
  const err = [];
  if (!isObj(f)) return ["a forecast must be a JSON object"];
  const allowed = /* @__PURE__ */ new Set(["schema", "model", "issuedAt", "windowH", "grid", "box", "probabilities", "boxes", "metadata", "$schema"]);
  for (const k of Object.keys(f)) if (!allowed.has(k)) err.push(`unknown field "${k}"`);
  if (f.schema !== FORECAST_SCHEMA) err.push(`schema must be "${FORECAST_SCHEMA}"`);
  if (!isObj(f.model)) err.push("model must be an object {id, name, version, url?}");
  else {
    const m = f.model;
    for (const k of Object.keys(m)) if (!["id", "name", "version", "url"].includes(k)) err.push(`unknown field "model.${k}"`);
    if (typeof m.id !== "string" || !MODEL_ID.test(m.id)) err.push("model.id must match ^[a-z0-9][a-z0-9._-]{1,62}$");
    if (!str(m.name, 120)) err.push("model.name must be a string of 1\u2013120 characters");
    if (!str(m.version, 64)) err.push("model.version must be a string of 1\u201364 characters");
    if (m.url !== void 0 && !(typeof m.url === "string" && /^https?:\/\/\S+$/.test(m.url) && m.url.length <= 500)) err.push("model.url must be an http(s) URL");
  }
  if (typeof f.issuedAt !== "string" || !ISO.test(f.issuedAt) || Number.isNaN(Date.parse(f.issuedAt))) err.push("issuedAt must be an ISO 8601 date-time with a time zone");
  if (f.windowH !== FORECAST_WINDOW_H) err.push(`windowH must be ${FORECAST_WINDOW_H}`);
  if (f.grid !== FORECAST_GRID) err.push(`grid must be "${FORECAST_GRID}"`);
  const single = f.box !== void 0 || f.probabilities !== void 0;
  if (single && f.boxes !== void 0) err.push("give either box + probabilities or boxes, not both");
  else if (single) {
    checkBox(f.box, "box", err);
    checkProbabilities(f.probabilities, "probabilities", err);
  } else if (f.boxes !== void 0) {
    if (!Array.isArray(f.boxes) || f.boxes.length < 1 || f.boxes.length > MAX_BOXES) err.push(`boxes must be an array of 1\u2013${MAX_BOXES} boxes`);
    else f.boxes.forEach((b, i) => {
      checkBox(b, `boxes[${i}]`, err);
      if (isObj(b)) {
        for (const k of Object.keys(b)) if (!["lat", "lon", "probabilities"].includes(k)) err.push(`unknown field "boxes[${i}].${k}"`);
        checkProbabilities(b.probabilities, `boxes[${i}].probabilities`, err);
      }
    });
  } else err.push("box + probabilities (or boxes) is required");
  if (f.metadata !== void 0 && !isObj(f.metadata)) err.push("metadata must be an object");
  return err;
}
function splitForecast(f) {
  const { boxes, box, probabilities, ...rest } = f;
  if (boxes) return boxes.map((b) => ({ ...rest, box: { lat: b.lat, lon: b.lon }, probabilities: b.probabilities }));
  return [{ ...rest, box, probabilities }];
}
var inIndonesia = (b) => b.lat >= INDONESIA.south && b.lat <= INDONESIA.north && b.lon >= INDONESIA.west && b.lon <= INDONESIA.east;
var REFERENCE_MODEL_INFO = {
  [REGISTER_MODEL]: { id: REGISTER_MODEL, name: "Fire Septum cellular automaton (40-run ensemble)", version: "register", url: "https://github.com/aliefauzan/fire-septum", note: "Share of the 40 sealed runs that ignite the block within 24 h." },
  distance: { id: "distance", name: "Distance to fire (reference)", version: "1", note: "p = exp(\u2212d / 1 km), d = distance to the nearest block on fire at t0." },
  climatology: { id: "climatology", name: "Climatology (reference)", version: "1", note: "p = 114/836 \u2248 0.136 in every block: the new-fire rate of the 12 hindcast events, 8\u201318 Oct 2026." }
};

// src/sim/submission.ts
var SUBMISSION_KIND = "fireseptum.forecast-submission";

// src/sim/scoreboard.ts
function boardIndex(entries, submissions, generatedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  return {
    generatedAt,
    register: [...entries].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt)).map((e) => ({
      hash: e.record.receiptSha256,
      issuedAt: e.issuedAt,
      lat: e.lat,
      lon: e.lon,
      windowH: e.windowH,
      rule: e.rule,
      ...e.region ? { region: e.region } : {},
      receipt: e.record.receipt,
      ...e.record.anchor ? { otsB64: e.record.anchor.otsB64, calendar: e.record.anchor.calendar } : {},
      ...e.score ? { score: { scoredAt: e.score.scoredAt, reproduced: e.score.reproduced, detections: e.score.detections, result: e.score.result, ...e.score.benchmark ? { models: e.score.benchmark.models } : {} } } : {}
    })),
    submissions: [...submissions].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).map((s) => ({
      sha256: s.sha256,
      receivedAt: s.receivedAt,
      forecast: s.forecast,
      ...s.anchor ? { otsB64: s.anchor.otsB64, calendar: s.anchor.calendar } : {},
      ...s.score ? { score: { scoredAt: s.score.scoredAt, boxes: s.score.boxes.map((b) => ({ box: b.box, models: b.models })) } } : {}
    }))
  };
}

// server/submissions.ts
import { createHash as createHash5 } from "node:crypto";
import { join as join8 } from "node:path";
var CLOSED = "Submissions are closed on this deployment (read-only, no Blob store configured). Submit to an instance with BLOB_READ_WRITE_TOKEN set, or run Fire Septum locally.";
function submissionsCollection(o = {}) {
  return collection({
    dir: join8(o.root ?? process.cwd(), "data", "submissions"),
    rel: "data/submissions",
    prefix: "submissions",
    recursive: true,
    hashOf: (s) => s.sha256,
    readOnly: o.readOnly ?? !!process.env.VERCEL,
    blob: o.blob === void 0 ? blobFromEnv() : o.blob,
    readOnlyError: CLOSED
  });
}
var submissionFileName = (f, sha2562) => `${new Date(f.issuedAt).toISOString().slice(0, 10)}/${f.model.id}_${sha2562.slice(0, 16)}.json`;
function checkSubmission(f, now) {
  const err = [];
  if (RESERVED_MODEL_IDS.includes(f.model.id)) err.push(`model.id "${f.model.id}" is reserved for the scorer's own forecasts`);
  const t = Date.parse(f.issuedAt);
  if (t > now) err.push("issuedAt is in the future");
  else if (now - t > MAX_SUBMISSION_LAG_H * 36e5) err.push(`issuedAt is more than ${MAX_SUBMISSION_LAG_H} h before the server received the forecast; late forecasts are not accepted`);
  splitForecast(f).forEach((b, i) => {
    if (!inIndonesia(b.box)) err.push(`box ${i} (${b.box.lat}, ${b.box.lon}) is outside Indonesia`);
  });
  return err;
}
function makeSubmissionsHandler(d) {
  let store = null;
  const anchor2 = d.anchor ?? anchor;
  const now = d.now ?? Date.now;
  return (req, res, next) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/api/submissions") return next();
    res.setHeader("content-type", "application/json");
    const send = (status, body) => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    };
    (async () => {
      store ??= d.getStore();
      if (req.method === "GET") return send(200, { submissions: await store.list() });
      if (req.method !== "POST") return send(405, { error: "method not allowed" });
      const token = d.token?.();
      if (token && req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "this instance needs Authorization: Bearer <SUBMISSIONS_TOKEN>" });
      if (store.mode === "read-only") return send(405, { error: CLOSED });
      const body = await readJson4(req, 1e6);
      const f = body.forecast ?? body;
      const problems = validateForecast(f);
      if (problems.length) return send(400, { error: "not a valid forecast (schema/forecast-v1.json)", problems });
      const more = checkSubmission(f, now());
      if (more.length) return send(400, { error: "forecast refused", problems: more });
      const sha2562 = createHash5("sha256").update(canonical3(f)).digest("hex");
      if (await store.find(sha2562)) return send(409, { error: "already submitted", sha256: sha2562 });
      const a = await anchor2(sha2562);
      if (!a) return send(502, { error: "no OpenTimestamps calendar answered; nothing stored, try again" });
      const rec = {
        v: 1,
        kind: SUBMISSION_KIND,
        receivedAt: new Date(now()).toISOString(),
        sha256: sha2562,
        forecast: f,
        anchor: { calendar: a.calendar, submittedAt: new Date(now()).toISOString(), otsB64: a.ots.toString("base64") }
      };
      const r = await store.add(submissionFileName(f, sha2562), rec);
      return r.status === 200 ? send(200, { ok: true, sha256: sha2562, file: r.file, anchor: rec.anchor }) : send(r.status, { error: r.error, sha256: sha2562 });
    })().catch((err) => send(500, { error: err instanceof Error ? err.message : String(err) }));
  };
}
var submissionsHandler = makeSubmissionsHandler({ getStore: () => submissionsCollection(), token: () => process.env.SUBMISSIONS_TOKEN });

// server/scoreboard.ts
async function liveIndex(o = {}) {
  const [entries, subs] = await Promise.all([registerCollection(o).list(), submissionsCollection(o).list()]);
  return boardIndex(entries, subs);
}
function scoreboardHandler(req, res, next) {
  if ((req.url ?? "").split("?")[0] !== "/api/scoreboard") return next();
  res.setHeader("content-type", "application/json");
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }
  liveIndex().then(
    (ix) => res.end(JSON.stringify(ix)),
    (e) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  );
}

// api/_entry.ts
var chain = [
  firmsHandler(() => process.env.FIRMS_MAP_KEY),
  osmHandler(),
  receiptHandler(() => process.env.RECEIPT_ED25519_KEY),
  registerHandler,
  submissionsHandler,
  scoreboardHandler,
  decisionsHandler,
  evidenceHandler,
  bmkgHandler(() => process.env.SIPONGI_PERMISSION),
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
