// Pure input helpers for the influencer tracker (no server imports, so tests
// and client code can use them).
import type { Kit, KitRule } from "./types";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "@Foo.Bar", "instagram.com/foo.bar/", "FOO" -> "foo.bar" / "foo". null when not a valid IG handle. */
export function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let h = raw.trim();
  const url = h.match(/instagram\.com\/([^/?#\s]+)/i);
  if (url) h = url[1];
  h = h.replace(/^@+/, "").replace(/\/+$/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : null;
}

/**
 * Phone -> digits with country code, same shape as wa_contacts.wa_id.
 * 10 digits = Indian mobile (91 prefixed); a leading trunk 0 is dropped.
 * Returns null when there are too few digits to be a phone.
 */
export function normalizePhone(raw: unknown, defaultCountry = "91"): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) return defaultCountry + d;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

/** 12 url-safe random chars (72 bits). Used as the public portal code /c/[code]. */
const URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function generateDealCode(): string {
  // 64-symbol alphabet, so a byte masked to 6 bits is unbiased.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (const b of bytes) out += URL_SAFE[b & 63];
  return out;
}

export const DEAL_CODE_RE = /^[A-Za-z0-9_-]{12,64}$/;

/**
 * Kit suggestion from rules: lowest priority number wins. A rule matches when
 * followers fall inside [min, max] (inclusive, null bound = open) and its
 * niche (null = any) is one of the creator's niches. Inactive kits never win.
 */
export function pickKit(
  rules: Pick<KitRule, "priority" | "min_followers" | "max_followers" | "niche" | "kit_id">[],
  kits: Pick<Kit, "id" | "active">[],
  followers: number | null | undefined,
  niche: string[] | null | undefined,
): string | null {
  const active = new Set(kits.filter((k) => k.active).map((k) => k.id));
  const niches = (niche ?? []).map((n) => n.trim().toLowerCase());
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    if (!active.has(r.kit_id)) continue;
    if (r.min_followers != null && (followers == null || followers < r.min_followers)) continue;
    if (r.max_followers != null && (followers == null || followers > r.max_followers)) continue;
    if (r.niche && !niches.includes(r.niche.trim().toLowerCase())) continue;
    return r.kit_id;
  }
  return null;
}

/** Accepts ISO timestamps or YYYY-MM-DD. Returns ISO string or null. */
export function parseDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

export function cleanText(raw: unknown, max = 2000): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t ? t.slice(0, max) : null;
}

export function cleanNiche(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const out: string[] = [];
  for (const v of arr) {
    if (typeof v !== "string") continue;
    const n = v.trim().toLowerCase().slice(0, 40);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 10);
}

export interface AddressInput {
  name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
}

/** Address body -> clean columns, or null when nothing usable was sent. */
export function cleanAddress(raw: unknown): AddressInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pin = typeof r.pincode === "string" || typeof r.pincode === "number" ? String(r.pincode).replace(/\D/g, "") : "";
  const a: AddressInput = {
    name: cleanText(r.name, 120),
    line1: cleanText(r.line1, 300),
    line2: cleanText(r.line2, 300),
    city: cleanText(r.city, 80),
    state: cleanText(r.state, 80),
    pincode: pin ? pin.slice(0, 10) : null,
    phone: r.phone == null || r.phone === "" ? null : normalizePhone(r.phone),
  };
  return Object.values(a).some((v) => v != null) ? a : null;
}

const INFLUENCER_STATUSES = ["active", "paused", "blocked"];

/**
 * Creator profile fields from a request body. Only keys present in the body
 * are returned (so PATCH leaves the rest alone). `error` names the first bad field.
 */
export function influencerFields(body: Record<string, unknown>): { fields: Record<string, unknown>; error: string | null } {
  const f: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (has("handle")) {
    const h = normalizeHandle(body.handle);
    if (!h) return { fields: f, error: "handle is not a valid Instagram handle" };
    f.handle = h;
  }
  if (has("phone")) {
    if (body.phone == null || body.phone === "") f.phone = null;
    else {
      const p = normalizePhone(body.phone);
      if (!p) return { fields: f, error: "phone is not a valid number" };
      f.phone = p;
    }
  }
  if (has("email")) {
    const e = cleanText(body.email, 200);
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { fields: f, error: "email is not valid" };
    f.email = e ? e.toLowerCase() : null;
  }
  for (const k of ["full_name", "city", "discount_code"] as const) if (has(k)) f[k] = cleanText(body[k], 120);
  if (has("notes")) f.notes = cleanText(body.notes, 4000);
  if (has("ig_user_id")) f.ig_user_id = cleanText(body.ig_user_id, 64);
  if (has("niche")) f.niche = cleanNiche(body.niche);
  for (const k of ["followers", "avg_views"] as const) {
    if (!has(k)) continue;
    const v = body[k];
    if (v == null || v === "") f[k] = null;
    else if (typeof v === "number" && Number.isFinite(v) && v >= 0) f[k] = Math.floor(v);
    else return { fields: f, error: `${k} must be a non-negative number` };
  }
  if (has("engagement_rate")) {
    const v = body.engagement_rate;
    if (v == null || v === "") f.engagement_rate = null;
    else if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1000) f.engagement_rate = Math.round(v * 1000) / 1000;
    else return { fields: f, error: "engagement_rate must be a percent like 3.25" };
  }
  if (has("status")) {
    if (typeof body.status !== "string" || !INFLUENCER_STATUSES.includes(body.status)) {
      return { fields: f, error: "status must be active, paused or blocked" };
    }
    f.status = body.status;
  }
  return { fields: f, error: null };
}
