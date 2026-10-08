// Pure validation for PATCH /api/orm/settings and PATCH /api/orm/mentions/[id]
// (unit-tested). Returns clean column patches or a plain-English error.
import { normalizePhone } from "@/lib/influencers/normalize";
import { isSourceKey, isStatus, type OrmSourceKey } from "./types";

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

export type SourcePatch = { enabled?: boolean; config?: Record<string, unknown>; every_minutes?: number };
export type SettingsPatch = { settings: Record<string, unknown>; sources: Partial<Record<OrmSourceKey, SourcePatch>> };

const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function textList(v: unknown, field: string, maxItems: number, maxLen: number): Ok<string[]> | Err {
  if (!Array.isArray(v)) return { ok: false, error: `${field} must be a list` };
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") return { ok: false, error: `${field} must be a list of words` };
    const t = x.trim().toLowerCase();
    if (!t) continue;
    if (t.length > maxLen) return { ok: false, error: `${field}: "${t.slice(0, 20)}…" is too long (max ${maxLen})` };
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > maxItems) return { ok: false, error: `${field}: at most ${maxItems} entries` };
  return { ok: true, value: out };
}

export const ASIN_RE = /^[A-Z0-9]{10}$/;
export const YT_CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;

function validUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:";
  } catch {
    return false;
  }
}

function sourceConfig(key: OrmSourceKey, v: unknown): Ok<Record<string, unknown>> | Err {
  if (!isObj(v)) return { ok: false, error: `${key}: config must be an object` };
  if (key === "rss") {
    const feeds = v.feeds ?? [];
    if (!Array.isArray(feeds)) return { ok: false, error: "News feeds must be a list of links" };
    const clean = [...new Set(feeds.map((f) => (typeof f === "string" ? f.trim() : "")).filter(Boolean))];
    if (clean.length > 20) return { ok: false, error: "At most 20 news feed links" };
    const bad = clean.find((f) => !validUrl(f));
    if (bad) return { ok: false, error: `This is not a valid link: ${bad.slice(0, 60)}` };
    return { ok: true, value: { feeds: clean } };
  }
  if (key === "youtube") {
    const id = typeof v.channel_id === "string" ? v.channel_id.trim() : "";
    if (id && !YT_CHANNEL_RE.test(id)) return { ok: false, error: "YouTube channel id looks wrong. It starts with UC and is 24 characters long." };
    return { ok: true, value: { channel_id: id || null } };
  }
  if (JSON.stringify(v).length > 2000) return { ok: false, error: `${key}: config is too large` };
  return { ok: true, value: v };
}

export function validateSettingsPatch(body: Record<string, unknown>): Ok<SettingsPatch> | Err {
  const settings: Record<string, unknown> = {};
  const sources: SettingsPatch["sources"] = {};

  if (has(body, "alerts_enabled")) {
    if (typeof body.alerts_enabled !== "boolean") return { ok: false, error: "alerts_enabled must be true or false" };
    settings.alerts_enabled = body.alerts_enabled;
  }
  if (has(body, "alert_wa_ids")) {
    if (!Array.isArray(body.alert_wa_ids)) return { ok: false, error: "Alert numbers must be a list" };
    const ids: string[] = [];
    for (const raw of body.alert_wa_ids) {
      if (typeof raw === "string" && !raw.trim()) continue;
      const p = normalizePhone(raw);
      if (!p) return { ok: false, error: `Not a valid WhatsApp number: ${String(raw).slice(0, 20)}` };
      if (!ids.includes(p)) ids.push(p);
    }
    if (ids.length > 10) return { ok: false, error: "At most 10 alert numbers" };
    settings.alert_wa_ids = ids;
  }
  for (const k of ["keywords", "exclude_keywords"] as const) {
    if (!has(body, k)) continue;
    const r = textList(body[k], k === "keywords" ? "Brand words" : "Words to skip", 30, 60);
    if (!r.ok) return r;
    if (k === "keywords" && r.value.length === 0) return { ok: false, error: "Keep at least one brand word (for example promunch)" };
    settings[k] = r.value;
  }
  if (has(body, "amazon_asins")) {
    if (!Array.isArray(body.amazon_asins)) return { ok: false, error: "ASINs must be a list" };
    const asins = [
      ...new Set(body.amazon_asins.map((a) => (typeof a === "string" ? a.trim().toUpperCase() : "")).filter(Boolean)),
    ];
    const bad = asins.find((a) => !ASIN_RE.test(a));
    if (bad) return { ok: false, error: `Not an Amazon ASIN: ${bad.slice(0, 20)} (10 letters or numbers, like B0CXYZ1234)` };
    if (asins.length > 20) return { ok: false, error: "At most 20 ASINs" };
    settings.amazon_asins = asins;
  }
  if (has(body, "amazon_reviews_per_asin")) {
    const n = body.amazon_reviews_per_asin;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 5 || n > 100)
      return { ok: false, error: "Reviews per ASIN must be 5 to 100" };
    settings.amazon_reviews_per_asin = n;
  }
  if (has(body, "apify_monthly_budget_usd")) {
    const n = body.apify_monthly_budget_usd;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100)
      return { ok: false, error: "Monthly Apify budget must be 0 to 100 USD" };
    settings.apify_monthly_budget_usd = Math.round(n * 100) / 100;
  }

  if (has(body, "sources")) {
    if (!isObj(body.sources)) return { ok: false, error: "sources must be an object" };
    for (const [key, v] of Object.entries(body.sources)) {
      if (!isSourceKey(key)) return { ok: false, error: `Unknown source ${key}` };
      if (!isObj(v)) return { ok: false, error: `${key} must be an object` };
      const p: SourcePatch = {};
      if (has(v, "enabled")) {
        if (typeof v.enabled !== "boolean") return { ok: false, error: `${key}.enabled must be true or false` };
        if (key === "instagram" && v.enabled) return { ok: false, error: "Instagram and Facebook are not available yet" };
        p.enabled = v.enabled;
      }
      if (has(v, "every_minutes")) {
        const n = v.every_minutes;
        if (typeof n !== "number" || !Number.isInteger(n) || n < 15 || n > 43200)
          return { ok: false, error: `${key}: check every 15 minutes to 30 days` };
        p.every_minutes = n;
      }
      if (has(v, "config")) {
        const c = sourceConfig(key, v.config);
        if (!c.ok) return c;
        p.config = c.value;
      }
      if (Object.keys(p).length) sources[key] = p;
    }
  }

  if (!Object.keys(settings).length && !Object.keys(sources).length) return { ok: false, error: "nothing to update" };
  return { ok: true, value: { settings, sources } };
}

export function validateMentionPatch(
  body: Record<string, unknown>,
  actor: string,
  now: string,
): Ok<Record<string, unknown>> | Err {
  const patch: Record<string, unknown> = {};
  if (has(body, "status")) {
    if (!isStatus(body.status)) return { ok: false, error: "status must be new, seen, replied, ignored or escalated" };
    patch.status = body.status;
    if (body.status === "replied") {
      patch.replied_at = now;
      patch.replied_by = actor;
    }
  }
  for (const [k, max] of [
    ["assignee", 120],
    ["note", 2000],
    ["reply_text", 4000],
    ["reply_draft", 4000],
  ] as const) {
    if (!has(body, k)) continue;
    const v = body[k];
    if (v === null || (typeof v === "string" && !v.trim())) patch[k] = null;
    else if (typeof v === "string" && v.length <= max) patch[k] = v.trim();
    else return { ok: false, error: `${k} must be text up to ${max} characters` };
  }
  if (!Object.keys(patch).length) return { ok: false, error: "nothing to update" };
  patch.updated_at = now;
  return { ok: true, value: patch };
}
