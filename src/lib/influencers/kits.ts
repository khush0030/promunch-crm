// Pure body parsers for kits + kit rules (shared by the list and [id] routes).
import { UUID_RE, cleanText } from "./normalize";

export function kitFields(body: Record<string, unknown>, creating: boolean): { fields: Record<string, unknown>; error: string | null } {
  const f: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (creating || has("name")) {
    const name = cleanText(body.name, 120);
    if (!name) return { fields: f, error: "name is required" };
    f.name = name;
  }
  if (has("description")) f.description = cleanText(body.description, 1000);
  if (creating || has("items")) {
    const raw = body.items ?? [];
    if (!Array.isArray(raw) || raw.length > 30) return { fields: f, error: "items must be a list (max 30)" };
    const items = [];
    for (const it of raw) {
      const r = (it ?? {}) as Record<string, unknown>;
      const variant = typeof r.variant_id === "number" ? String(r.variant_id) : cleanText(r.variant_id, 120);
      const qty = r.qty;
      if (!variant || !/^(gid:\/\/shopify\/ProductVariant\/)?\d+$/.test(variant)) {
        return { fields: f, error: "each item needs a Shopify variant id" };
      }
      if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 50) {
        return { fields: f, error: "each item needs a qty from 1 to 50" };
      }
      items.push({ variant_id: variant.replace(/^gid:\/\/shopify\/ProductVariant\//, ""), title: cleanText(r.title, 200) ?? "", qty });
    }
    f.items = items;
  }
  if (has("cogs")) {
    if (body.cogs !== null && (typeof body.cogs !== "number" || !Number.isFinite(body.cogs) || body.cogs < 0)) {
      return { fields: f, error: "cogs must be a number" };
    }
    f.cogs = body.cogs;
  }
  if (has("active")) {
    if (typeof body.active !== "boolean") return { fields: f, error: "active must be true or false" };
    f.active = body.active;
  }
  return { fields: f, error: null };
}

export function ruleFields(body: Record<string, unknown>, creating: boolean): { fields: Record<string, unknown>; error: string | null } {
  const f: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (creating || has("kit_id")) {
    if (typeof body.kit_id !== "string" || !UUID_RE.test(body.kit_id)) return { fields: f, error: "kit_id is required" };
    f.kit_id = body.kit_id;
  }
  if (has("priority")) {
    if (typeof body.priority !== "number" || !Number.isInteger(body.priority) || body.priority < 0 || body.priority > 10000) {
      return { fields: f, error: "priority must be a whole number" };
    }
    f.priority = body.priority;
  }
  for (const k of ["min_followers", "max_followers"] as const) {
    if (!has(k)) continue;
    const v = body[k];
    if (v === null || v === "") f[k] = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 0) f[k] = v;
    else return { fields: f, error: `${k} must be a whole number` };
  }
  if (typeof f.min_followers === "number" && typeof f.max_followers === "number" && f.min_followers > f.max_followers) {
    return { fields: f, error: "min_followers is above max_followers" };
  }
  if (has("niche")) {
    const n = cleanText(body.niche, 40);
    f.niche = n ? n.toLowerCase() : null;
  }
  return { fields: f, error: null };
}
