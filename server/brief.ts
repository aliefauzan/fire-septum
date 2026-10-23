// POST /api/brief — turns simulation numbers into a short situation brief using an
// OpenAI-compatible chat completions endpoint. The key stays on the server.
// The model only rewrites numbers it is given; it must not forecast anything itself.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export interface LlmConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

const SYSTEM = `You write short wildfire situation briefs for incident commanders (BPBD, Manggala Agni) from a simulation's output.
Rules:
- Use ONLY numbers and facts present in the JSON. Never invent forecasts, places, resources or dates.
- Always keep uncertainty: quote percentages and 10–90% ranges as given. Never call any zone "safe" or "guaranteed".
- Say which data is synthetic vs live, exactly as the provenance field states.
- Resources: only mention helicopters, crews, dozers, bases or dip sites that appear in "resources". If a count is "unknown", say it must be confirmed; never assume it exists. A mapped base is not proof of staff or equipment.
- When you justify a tactic, use only the "doctrine" rules given and name their source in brackets, e.g. [NWCG IRPG (PMS 461, 2025)]. Do not cite anything else.
- Structure: 1) Situation now (2–3 sentences). 2) Main threat and timing. 3) Recommended actions in priority order: what, where, when (act-by), why, expected effect, resources. 4) What the current plan changes vs no action. 5) Caveats (1–2 sentences: simplified model, not operational guidance).
- Max ~250 words. Plain text with short headings, no tables.

Plan: also choose the actions to carry out, picked ONLY from "recommendations" by their "id". For each pick choose a start hour that appears in that option's "hectaresSavedByStartHour" (earliest hour that saves close to the most is usually best). Prefer options whose availability is "available"; include an "unknown" one only if you say in the brief that its resources must be confirmed. Never exceed the inventory. If "suggestedStrategy" lists ids, start from those. Section 3 of the brief must describe exactly these picks, in the same order, by their title (never print an id). In section 4, describe the effect of the current plan plus these picks using the per-option savings given; do not compute new totals. Pick nothing if no option saves area.

Output ONLY a JSON object, no code fences:
{"brief": "<the brief text>", "plan": [{"id": "<recommendation id>", "startHour": <number>, "reason": "<max 12 words>"}]}`;

/** Pull the first JSON object out of a model reply (tolerates code fences and stray text). */
function parseReply(raw: string): { brief: string; plan: unknown[] } {
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(raw.slice(a, b + 1));
      if (typeof j.brief === 'string') return { brief: j.brief, plan: Array.isArray(j.plan) ? j.plan : [] };
    } catch { /* fall through */ }
  }
  return { brief: raw.trim(), plan: [] };
}

interface RecIn { id?: unknown; hectaresSavedByStartHour?: { startHour: number }[] }
interface Pick { id: string; startHour: number; reason: string }

/** Keep only picks that name a simulated option at a simulated start hour; the model cannot invent actions. */
function validPlan(plan: unknown[], recs: RecIn[]): Pick[] {
  const seen = new Set<string>();
  const out: Pick[] = [];
  for (const x of plan) {
    if (!x || typeof x !== 'object') continue;
    const { id, startHour, reason } = x as Record<string, unknown>;
    const r = recs.find((q) => q.id === id);
    if (!r || typeof id !== 'string' || seen.has(id)) continue;
    const hours = (r.hectaresSavedByStartHour ?? []).map((t) => t.startHour);
    if (!hours.length) continue;
    const want = Number(startHour);
    const h = hours.reduce((best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best), hours[0]);
    seen.add(id);
    out.push({ id, startHour: h, reason: typeof reason === 'string' ? reason.slice(0, 120) : '' });
  }
  return out;
}

async function readBody(req: IncomingMessage, limit = 200_000): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function handler(getCfg: () => LlmConfig) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/brief')) return next();
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') {
      const c = getCfg();
      res.end(JSON.stringify({ enabled: !!(c.apiKey && c.baseUrl && c.model), model: c.model ?? null }));
      return;
    }
    if (req.method !== 'POST') { res.statusCode = 405; res.end('{}'); return; }
    const cfg = getCfg();
    if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) { res.statusCode = 503; res.end(JSON.stringify({ error: 'LLM_API_KEY / LLM_BASE_URL / LLM_MODEL not set' })); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const lang = body.lang === 'id' ? 'Bahasa Indonesia' : 'English';
      const r = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.2,
          max_tokens: 1400,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `Write the brief and the plan reasons in ${lang}.\n\nSimulation output (JSON):\n${JSON.stringify(body.data)}` },
          ],
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { res.statusCode = 502; res.end(JSON.stringify({ error: j?.error?.message ?? `LLM HTTP ${r.status}` })); return; }
      const { brief, plan } = parseReply(j?.choices?.[0]?.message?.content ?? '');
      res.end(JSON.stringify({ text: brief, plan: validPlan(plan, body.data?.recommendations ?? []), model: j?.model ?? cfg.model }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  };
}

export function briefProxy(getCfg: () => LlmConfig): Plugin {
  return {
    name: 'llm-brief',
    configureServer(server) { server.middlewares.use(handler(getCfg)); },
    configurePreviewServer(server) { server.middlewares.use(handler(getCfg)); },
  };
}
