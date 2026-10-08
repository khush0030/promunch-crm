// Server-only data helpers for the Reputation (ORM) API routes. Service-role
// admin client like every sibling route; callers gate the session first.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { topAsins } from "./asins";
import { SOURCE_COLUMNS, type AsinSuggestion, type OrmSettings, type OrmSource } from "./types";

export { jsonError, readJson, requireUser } from "@/lib/influencers/db";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_ORM_SETTINGS: OrmSettings = {
  alerts_enabled: false,
  alert_wa_ids: [],
  keywords: ["promunch", "pro munch", "promunch.snacks", "promunch snacks"],
  exclude_keywords: [],
  amazon_asins: [],
  amazon_reviews_per_asin: 20,
  apify_monthly_budget_usd: 5,
  apify_month: null,
  apify_spent_usd: 0,
  weekly_digest_enabled: false,
  weekly_digest_dow: 1,
  weekly_digest_hour_ist: 9,
  spike_alerts_enabled: false,
  spike_threshold: 3,
  spike_window_days: 7,
  auto_case_on_negative: true,
  competitor_asins: [],
  updated_at: null,
};

/** 'YYYY-MM' in India time (the month the Apify spend counter belongs to). */
export function istMonth(now = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 7);
}

export async function getOrmSettings(): Promise<OrmSettings> {
  const { data, error } = await supabaseAdmin.from("orm_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return DEFAULT_ORM_SETTINGS;
  // Spend from a past month reads as 0 (the edge resets it on its next run).
  const sameMonth = data.apify_month === istMonth();
  return {
    alerts_enabled: !!data.alerts_enabled,
    alert_wa_ids: data.alert_wa_ids ?? [],
    keywords: data.keywords ?? DEFAULT_ORM_SETTINGS.keywords,
    exclude_keywords: data.exclude_keywords ?? [],
    amazon_asins: data.amazon_asins ?? [],
    amazon_reviews_per_asin: data.amazon_reviews_per_asin ?? 20,
    apify_monthly_budget_usd: Number(data.apify_monthly_budget_usd ?? 5),
    apify_month: data.apify_month ?? null,
    apify_spent_usd: sameMonth ? Number(data.apify_spent_usd ?? 0) : 0,
    weekly_digest_enabled: !!data.weekly_digest_enabled,
    weekly_digest_dow: data.weekly_digest_dow ?? 1,
    weekly_digest_hour_ist: data.weekly_digest_hour_ist ?? 9,
    spike_alerts_enabled: !!data.spike_alerts_enabled,
    spike_threshold: data.spike_threshold ?? 3,
    spike_window_days: data.spike_window_days ?? 7,
    auto_case_on_negative: data.auto_case_on_negative ?? true,
    competitor_asins: Array.isArray(data.competitor_asins) ? data.competitor_asins : [],
    updated_at: data.updated_at ?? null,
  };
}

const SOURCE_ORDER = ["judgeme", "amazon", "youtube", "reddit", "rss", "instagram", "competitors"];

export async function listSources(): Promise<OrmSource[]> {
  const { data, error } = await supabaseAdmin.from("orm_sources").select(SOURCE_COLUMNS);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as OrmSource[]).sort(
    (a, b) => SOURCE_ORDER.indexOf(a.key) - SOURCE_ORDER.indexOf(b.key),
  );
}

/**
 * Top 10 ASINs by units sold in the last 90 days (amazon_order_items joined to
 * amazon_orders.purchase_date), to prefill the Amazon reviews list. Best
 * effort: an error returns [] so Settings still loads.
 */
export async function asinSuggestions(now = Date.now()): Promise<AsinSuggestion[]> {
  const since = new Date(now - 90 * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("amazon_order_items")
    .select("asin, title, quantity_ordered, amazon_orders!inner(purchase_date, order_status)")
    .gte("amazon_orders.purchase_date", since)
    .neq("amazon_orders.order_status", "Canceled")
    .not("asin", "is", null)
    .limit(10000);
  if (error) {
    console.warn("orm_asin_suggestions_failed", error.message);
    return [];
  }
  return topAsins((data ?? []) as { asin: string | null; title: string | null; quantity_ordered: number | null }[]);
}

/**
 * Asks the `orm-tick` edge function (requireInternal, service-role bearer, same
 * as invokeInfluencerSend) to collect one source now. Never throws.
 */
export async function invokeOrmTick(source: string): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/orm-tick`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 502, data: { error: e instanceof Error ? e.message : String(e) } };
  }
}
