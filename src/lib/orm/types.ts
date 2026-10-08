// Reputation (ORM) shared types. Column names mirror
// supabase/migrations/20261008200000_orm.sql exactly; the build contract is
// docs/plans/2026-10-08-orm-build-spec.md.

// "whatsapp" = Not happy taps on the WhatsApp review feedback ask (written by
// wa-webhook, never collected; hidden from the Settings source list).
export const ORM_SOURCE_KEYS = ["judgeme", "youtube", "reddit", "rss", "amazon", "instagram", "whatsapp"] as const;
export type OrmSourceKey = (typeof ORM_SOURCE_KEYS)[number];

export const ORM_STATUSES = ["new", "seen", "replied", "ignored", "escalated"] as const;
export type OrmStatus = (typeof ORM_STATUSES)[number];

export const ORM_URGENCIES = ["critical", "high", "normal", "low"] as const;
export type OrmUrgency = (typeof ORM_URGENCIES)[number];

export const ORM_INTENTS = ["complaint", "question", "praise", "suggestion", "collab", "spam", "other"] as const;
export type OrmIntent = (typeof ORM_INTENTS)[number];

export type OrmSourceStatus = "ok" | "error" | "skipped" | "not_connected" | "budget";

export interface OrmMention {
  id: string;
  source: OrmSourceKey;
  external_id: string;
  url: string | null;
  author_name: string | null;
  author_handle: string | null;
  author_followers: number | null;
  title: string | null;
  body: string;
  rating: number | null;
  posted_at: string | null;
  collected_at: string;
  is_owned: boolean;
  product_ref: string | null;
  parent_external_id: string | null;
  // enrichment
  enriched_at: string | null;
  relevant: boolean | null;
  sentiment: number | null; // -2..2
  summary: string | null;
  topics: string[];
  intent: OrmIntent | null;
  urgency: OrmUrgency | null;
  product: string | null;
  language: string | null;
  order_ref: string | null;
  contact_id: string | null;
  enrich_error: string | null;
  enrich_attempts: number;
  // workflow
  status: OrmStatus;
  assignee: string | null;
  reply_draft: string | null;
  reply_text: string | null;
  replied_at: string | null;
  replied_by: string | null;
  note: string | null;
  updated_at: string;
}

/** Every column except `raw` (kept server-side; it can be large). */
export const MENTION_COLUMNS =
  "id, source, external_id, url, author_name, author_handle, author_followers, title, body, rating, posted_at, collected_at, is_owned, product_ref, parent_external_id, enriched_at, relevant, sentiment, summary, topics, intent, urgency, product, language, order_ref, contact_id, enrich_error, enrich_attempts, status, assignee, reply_draft, reply_text, replied_at, replied_by, note, updated_at";

export interface OrmSource {
  key: OrmSourceKey;
  label: string;
  enabled: boolean;
  every_minutes: number;
  config: Record<string, unknown>;
  next_run_at: string;
  last_run_at: string | null;
  last_status: OrmSourceStatus | null;
  last_error: string | null;
  last_count: number | null;
  updated_at: string;
}

/** orm_sources minus the collector-owned cursor. */
export const SOURCE_COLUMNS =
  "key, label, enabled, every_minutes, config, next_run_at, last_run_at, last_status, last_error, last_count, updated_at";

export interface OrmSettings {
  alerts_enabled: boolean;
  alert_wa_ids: string[];
  keywords: string[];
  exclude_keywords: string[];
  amazon_asins: string[];
  amazon_reviews_per_asin: number;
  apify_monthly_budget_usd: number;
  apify_month: string | null;
  apify_spent_usd: number;
  updated_at: string | null;
}

export type OrmAlertKind = "critical" | "low_rating" | "negative" | "spike";

export interface OrmAlert {
  id: number;
  mention_id: string;
  kind: OrmAlertKind;
  status: "claimed" | "sent" | "failed" | "skipped";
  detail: Record<string, unknown>;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface AsinSuggestion {
  asin: string;
  title: string | null;
  units: number;
}

export interface OrmSettingsResponse {
  settings: OrmSettings;
  sources: OrmSource[];
  asin_suggestions?: AsinSuggestion[];
}

export interface OrmSummary {
  days: number;
  total: number;
  new_count: number;
  unanswered_negative: number;
  by_source: { key: OrmSourceKey; label: string; count: number; avg_rating: number | null }[];
  sentiment: { neg: number; neu: number; pos: number };
  top_topics: { topic: string; count: number }[];
  trend: { day: string; neg: number; neu: number; pos: number }[];
  sources: Pick<
    OrmSource,
    "key" | "label" | "enabled" | "last_run_at" | "last_status" | "last_error" | "last_count" | "next_run_at"
  >[];
}

export function isSourceKey(v: unknown): v is OrmSourceKey {
  return typeof v === "string" && (ORM_SOURCE_KEYS as readonly string[]).includes(v);
}

export function isStatus(v: unknown): v is OrmStatus {
  return typeof v === "string" && (ORM_STATUSES as readonly string[]).includes(v);
}
