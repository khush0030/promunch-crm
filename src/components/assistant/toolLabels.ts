// Business-facing names for Maya's tools and the fields they return. The team
// should only ever read plain words ("System health"), never the internal
// identifiers ("get_system_health", "wa_jobs_recent_failures").
//
// The type-only import keeps this file client-safe (no server code is pulled
// in) while making the compiler fail if a tool is added without a label.

import type { assistantTools } from "@/lib/assistant/tools";

export type AssistantToolName = keyof typeof assistantTools;

type ToolLabel = {
  /** Short name used in "Sources:" and "looked at". */
  source: string;
  /** Shown while the tool is running. */
  pending: string;
  /** Shown when the tool finished without a data card. */
  done: string;
};

export const TOOL_LABELS: Record<AssistantToolName, ToolLabel> = {
  query_orders: { source: "Sales", pending: "Reading orders", done: "Orders read" },
  get_whatsapp_stats: { source: "WhatsApp", pending: "Reading WhatsApp stats", done: "WhatsApp stats read" },
  get_system_health: { source: "System health", pending: "Running health checks", done: "Health checks done" },
  get_leads_pipeline: { source: "B2B pipeline", pending: "Reading the B2B pipeline", done: "B2B pipeline read" },
  get_email_stats: { source: "Email", pending: "Reading email stats", done: "Email stats read" },
  get_amazon_stats: { source: "Amazon", pending: "Reading Amazon data", done: "Amazon data read" },
  search_customer: { source: "Customers", pending: "Looking up the customer", done: "Customer records pulled" },
  search_kb: { source: "Knowledge base", pending: "Reading the knowledge base", done: "Knowledge base read" },
  get_audit_log: { source: "Team activity", pending: "Reading team activity", done: "Team activity read" },
};

// Names for fields inside tool results, used by the generic fact cards.
export const FIELD_LABELS: Record<string, string> = {
  wa_jobs_recent_failures: "WhatsApp send failures",
  wa_jobs_by_status: "WhatsApp job queue",
  connector_errors_24h: "Integration errors (24h)",
  by_connector: "by integration",
  cron_jobs: "Scheduled jobs",
  amazon_sync_state: "Amazon sync",
  gmail_watch: "Support inbox connection",
  kb_documents_by_status: "Knowledge base documents",
  email_threads_by_draft_status: "Support email drafts",
  shopify_last_order_at: "Last Shopify order",
  failed_outbound_24h: "Failed sends (24h)",
  uptime_24h_pct: "Uptime (24h, %)",
  creator_seed_orders_excluded: "Creator seed orders excluded",
  aov: "Average order",
};

// Abbreviations that read better spelled out.
const WORDS: Record<string, string> = {
  wa: "WhatsApp",
  whatsapp: "WhatsApp",
  kb: "knowledge base",
  b2b: "B2B",
  ig: "Instagram",
  cron: "scheduled",
  aov: "average order",
  pct: "%",
  shopify: "Shopify",
  amazon: "Amazon",
  gmail: "Gmail",
  hypd: "HYPD",
  promunch: "PROMUNCH",
  "24h": "(24h)",
  "7d": "(7d)",
};

/** snake_case / kebab-case identifier → "Sentence case" business words. */
export function humanize(id: string): string {
  const words = id
    .replace(/^tool-/, "")
    .replace(/^(get|query|search|fetch|list)_/, "")
    .split(/[_\-\s.]+/)
    .filter(Boolean)
    .map((w) => WORDS[w.toLowerCase()] ?? w.toLowerCase());
  if (!words.length) return "Data";
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toolName(nameOrType: string): string {
  return nameOrType.replace(/^tool-/, "");
}

function labelFor(nameOrType: string): ToolLabel | undefined {
  return (TOOL_LABELS as Record<string, ToolLabel>)[toolName(nameOrType)];
}

/** Business name of a tool, e.g. "get_system_health" → "System health". */
export function toolSourceLabel(nameOrType: string): string {
  return labelFor(nameOrType)?.source ?? humanize(toolName(nameOrType));
}

export function toolPendingLabel(nameOrType: string): string {
  return labelFor(nameOrType)?.pending ?? `Reading ${humanize(toolName(nameOrType)).toLowerCase()}`;
}

export function toolDoneLabel(nameOrType: string): string {
  return labelFor(nameOrType)?.done ?? `${humanize(toolName(nameOrType))} read`;
}

/** Business name of a field in a tool's output. */
export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? humanize(key);
}

/** Unique business source names for a list of tool parts / stored tool types. */
export function sourcesOf(parts: { type: string }[]): string[] {
  const out = new Set<string>();
  for (const p of parts) {
    if (p.type.startsWith("tool-")) out.add(toolSourceLabel(p.type));
  }
  return [...out];
}

// Older answers (and the odd new one) name tools, tables or fields inline,
// e.g. "`get_system_health` shows wa_jobs_recent_failures". Rewrite any
// snake_case identifier into business words before it is shown. Identifiers
// inside URLs, emails or query strings are left alone.
const INLINE_ID = /(`?)(?<![\w/=?&.:#@-])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\1(?![\w/=?&@(`-]|\.\w)/g;

// Labels that start with a proper noun keep their capital mid-sentence.
const PROPER_START = /^(WhatsApp|Shopify|Amazon|Gmail|Instagram|HYPD|PROMUNCH|B2B)\b/;

export function scrubInternalNames(text: string): string {
  return text.replace(INLINE_ID, (_m, _tick: string, id: string, offset: number, full: string) => {
    const label = id in TOOL_LABELS ? toolSourceLabel(id) : fieldLabel(id);
    const before = full.slice(0, offset).trimEnd();
    const sentenceStart = !before || /[.!?:|\n*#>-]$/.test(before);
    return sentenceStart || PROPER_START.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
  });
}
