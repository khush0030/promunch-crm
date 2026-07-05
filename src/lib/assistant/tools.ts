// Maya's read-only data tools. Every tool queries Supabase via the service-role
// client and returns plain JSON for the model. Rules:
// - READ ONLY. No tool may write, send, or mutate anything.
// - Never throw: each execute catches and returns { error } so one broken
//   query degrades a single answer instead of killing the stream.
// - Bounded: every query has a row cap so a tool call can't blow up context.

import { tool } from "ai";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getKnowledgeBase } from "@/lib/leads/kb";
import { salesChannelOf, type ChannelOrder } from "./channels";

const DAY_MS = 24 * 3600_000;
const since = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

type Row = Record<string, unknown>;

// Keep only primitive fields and truncate long strings — protects the model's
// context from jsonb blobs and raw payload columns when we select('*').
function slim(row: Row, maxStr = 300): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string") out[k] = v.length > maxStr ? v.slice(0, maxStr) + "…" : v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

function tally(rows: Row[] | null, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows ?? []) {
    const v = String(r[key] ?? "unknown");
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

// Aggregate by the first candidate column that actually exists on the rows —
// keeps tools working even where the enum column name drifted between domains.
function tallyAuto(rows: Row[] | null, candidates: string[]): { by: string; counts: Record<string, number> } | null {
  const first = rows?.[0];
  if (!first) return null;
  const by = candidates.find((c) => c in first);
  if (!by) return null;
  return { by, counts: tally(rows, by) };
}

// Minimal structural slice of the PostgREST builder that count filters use.
type Filterable = {
  eq(col: string, val: string): Filterable;
  gte(col: string, val: string): Filterable;
};

async function countRows(table: string, build?: (q: Filterable) => Filterable): Promise<number | null> {
  try {
    const base = supabaseAdmin.from(table).select("*", { count: "exact", head: true });
    const q = build ? (build(base as unknown as Filterable) as unknown as typeof base) : base;
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

async function fetchStatusColumn(table: string, column: string, sinceDays?: number, sinceColumn = "created_at"): Promise<Record<string, number> | { error: string }> {
  try {
    let q = supabaseAdmin.from(table).select(column).limit(2000).order(sinceColumn, { ascending: false });
    if (sinceDays) q = q.gte(sinceColumn, since(sinceDays));
    const { data, error } = await q;
    if (error) return { error: error.message };
    return tally(data as unknown as Row[], column);
  } catch (e) {
    return { error: String(e) };
  }
}

const err = (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) });

// ---------------------------------------------------------------------------

const queryOrders = tool({
  description:
    "Shopify order and revenue analytics from shopify_orders (the source of truth). Returns totals, per-channel and per-day breakdowns for a trailing window. Creator seed orders (₹0.01 HYPD) are excluded unless include_creators is true.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(365).optional().describe("Trailing window in days. Default 30."),
    include_creators: z.boolean().optional().describe("Include ₹0.01 HYPD creator seed orders. Default false."),
  }),
  execute: async (input) => {
    try {
      const days = input.days ?? 30;
      const from = since(days);
      const cols = "shopify_created_at, created_at, total_price, financial_status, source_name, first_utm_source, first_source, is_creator";
      const rows: Row[] = [];
      for (let page = 0; page < 6; page++) {
        const { data, error } = await supabaseAdmin
          .from("shopify_orders")
          .select(cols)
          .gte("shopify_created_at", from)
          .order("shopify_created_at", { ascending: false })
          .range(page * 1000, page * 1000 + 999);
        if (error) return { error: error.message };
        rows.push(...((data as Row[]) ?? []));
        if (!data || data.length < 1000) break;
      }
      const creators = rows.filter((r) => r.is_creator).length;
      const kept = input.include_creators ? rows : rows.filter((r) => !r.is_creator);

      const price = (r: Row) => Number(r.total_price) || 0;
      const day = (r: Row) => String(r.shopify_created_at ?? r.created_at ?? "").slice(0, 10);

      const revenue = kept.reduce((s, r) => s + price(r), 0);
      const byChannel: Record<string, { orders: number; revenue: number }> = {};
      const byDay: Record<string, { orders: number; revenue: number }> = {};
      for (const r of kept) {
        const ch = salesChannelOf(r as unknown as ChannelOrder);
        (byChannel[ch] ??= { orders: 0, revenue: 0 });
        byChannel[ch].orders++;
        byChannel[ch].revenue += price(r);
        const d = day(r);
        (byDay[d] ??= { orders: 0, revenue: 0 });
        byDay[d].orders++;
        byDay[d].revenue += price(r);
      }
      return {
        window_days: days,
        totals: {
          revenue: Math.round(revenue),
          orders: kept.length,
          aov: kept.length ? Math.round(revenue / kept.length) : 0,
        },
        creator_seed_orders_excluded: input.include_creators ? 0 : creators,
        by_financial_status: tally(kept, "financial_status"),
        by_channel: byChannel,
        // Cap the daily series so a 365d window doesn't flood context.
        by_day: days <= 45 ? byDay : undefined,
        note: days > 45 ? "Daily series omitted for windows over 45 days; ask for a shorter window for day-level detail." : undefined,
      };
    } catch (e) {
      return err(e);
    }
  },
});

const getWhatsappStats = tool({
  description:
    "WhatsApp channel stats from wa_messages, wa_campaigns, wa_journey_runs and wa_contacts: send/delivery/read/failure counts, recent failures with Meta error text, campaign list and journey run outcomes.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(90).optional().describe("Trailing window in days. Default 7."),
  }),
  execute: async (input) => {
    try {
      const days = input.days ?? 7;
      const from = since(days);
      const out = (status: string) =>
        countRows("wa_messages", (q) => q.eq("direction", "outbound").eq("status", status).gte("created_at", from));

      const [sent, delivered, read, failed, queued, inbound, contacts, newContacts] = await Promise.all([
        out("sent"),
        out("delivered"),
        out("read"),
        out("failed"),
        out("queued"),
        countRows("wa_messages", (q) => q.eq("direction", "inbound").gte("created_at", from)),
        countRows("wa_contacts"),
        countRows("wa_contacts", (q) => q.gte("created_at", from)),
      ]);

      const { data: failures } = await supabaseAdmin
        .from("wa_messages")
        .select("created_at, template_name, error, status")
        .eq("direction", "outbound")
        .eq("status", "failed")
        .gte("created_at", from)
        .order("created_at", { ascending: false })
        .limit(10);

      const { data: campaigns } = await supabaseAdmin
        .from("wa_campaigns")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);

      return {
        window_days: days,
        outbound: { sent, delivered, read, failed, queued },
        inbound_messages: inbound,
        contacts: { total: contacts, new_in_window: newContacts },
        recent_failures: (failures ?? []).map((r) => slim(r as Row)),
        recent_campaigns: (campaigns ?? []).map((r) => slim(r as Row)),
        journey_runs_by_status: await fetchStatusColumn("wa_journey_runs", "status", days),
        note: "Statuses progress sent→delivered→read; all three mean the send worked. Error 131049 = per-user marketing cap, expected behaviour.",
      };
    } catch (e) {
      return err(e);
    }
  },
});

const getSystemHealth = tool({
  description:
    "Overall system health: WhatsApp Cloud API uptime, connector errors (last 24h), pg_cron job liveness, background job queues, Amazon sync freshness, Gmail watch expiry, knowledge base status and Shopify order freshness. Use for any 'is everything working?' question.",
  inputSchema: z.object({}),
  execute: async () => {
    const d1 = since(1);
    const health: Row = {};

    // WhatsApp — same signals as the dashboard health meter (wa-health cron heartbeats).
    try {
      const { data } = await supabaseAdmin
        .from("connector_events")
        .select("event, created_at")
        .eq("connector", "whatsapp")
        .in("event", ["health_ok", "health_down"])
        .gte("created_at", d1)
        .order("created_at", { ascending: false });
      const beats = data ?? [];
      const ok = beats.filter((b) => b.event === "health_ok").length;
      health.whatsapp = {
        status: !beats.length ? "unknown" : beats[0].event === "health_ok" ? "up" : "down",
        uptime_24h_pct: beats.length ? Math.round((ok / beats.length) * 1000) / 10 : null,
        failed_outbound_24h: await countRows("wa_messages", (q) => q.eq("direction", "outbound").eq("status", "failed").gte("created_at", d1)),
      };
    } catch (e) {
      health.whatsapp = err(e);
    }

    // Connector errors across all integrations in the last 24h.
    try {
      const { data } = await supabaseAdmin
        .from("connector_events")
        .select("connector, event, message, created_at")
        .eq("level", "error")
        .gte("created_at", d1)
        .order("created_at", { ascending: false })
        .limit(50);
      const rows = (data ?? []) as Row[];
      health.connector_errors_24h = {
        count: rows.length,
        by_connector: tally(rows, "connector"),
        samples: rows.slice(0, 8).map((r) => slim(r, 160)),
      };
    } catch (e) {
      health.connector_errors_24h = err(e);
    }

    // pg_cron jobs — needs the assistant_cron_status() function from the
    // assistant_chat migration; degrade gracefully until it is applied.
    try {
      const { data, error } = await supabaseAdmin.rpc("assistant_cron_status");
      health.cron_jobs = error
        ? { error: `cron status unavailable (${error.message}); the assistant_chat migration may not be applied yet` }
        : data;
    } catch (e) {
      health.cron_jobs = err(e);
    }

    // Background job queues.
    health.wa_jobs_by_status = await fetchStatusColumn("wa_jobs", "status", 7);
    try {
      const { data } = await supabaseAdmin
        .from("wa_jobs")
        .select("kind, status, attempts, last_error, created_at")
        .eq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(5);
      health.wa_jobs_recent_failures = (data ?? []).map((r) => slim(r as Row, 160));
    } catch (e) {
      health.wa_jobs_recent_failures = err(e);
    }

    // Amazon sync freshness.
    try {
      const { data } = await supabaseAdmin.from("amazon_sync_state").select("*");
      health.amazon_sync_state = (data ?? []).map((r) => slim(r as Row));
    } catch (e) {
      health.amazon_sync_state = err(e);
    }

    // Gmail watch expiry (support-email ingestion dies silently when expired).
    try {
      const { data } = await supabaseAdmin.from("gmail_watch").select("*").limit(5);
      health.gmail_watch = (data ?? []).map((r) => slim(r as Row));
    } catch (e) {
      health.gmail_watch = err(e);
    }

    // Knowledge base ingestion.
    health.kb_documents_by_status = await fetchStatusColumn("kb_documents", "status");

    // Shopify order freshness.
    try {
      const { data } = await supabaseAdmin
        .from("shopify_orders")
        .select("shopify_created_at")
        .order("shopify_created_at", { ascending: false })
        .limit(1);
      health.shopify_last_order_at = data?.[0]?.shopify_created_at ?? null;
    } catch (e) {
      health.shopify = err(e);
    }

    // Support email drafting backlog.
    health.email_threads_by_draft_status = await fetchStatusColumn("email_threads", "draft_status");

    return health;
  },
});

const getLeadsPipeline = tool({
  description:
    "B2B outreach pipeline: lead counts by status, outreach draft/send/reply activity, sequence enrollments and suppression count.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(180).optional().describe("Window for event/reply activity. Default 30."),
  }),
  execute: async (input) => {
    try {
      const days = input.days ?? 30;
      const [leadsByStatus, draftsByStatus, enrollmentsByStatus, suppressed] = await Promise.all([
        fetchStatusColumn("leads", "status"),
        fetchStatusColumn("outreach_drafts", "status"),
        fetchStatusColumn("sequence_enrollments", "status"),
        countRows("suppressions"),
      ]);

      const { data: events } = await supabaseAdmin
        .from("outreach_events")
        .select("*")
        .gte("created_at", since(days))
        .order("created_at", { ascending: false })
        .limit(1000);
      const { data: replies } = await supabaseAdmin
        .from("outreach_replies")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);

      return {
        window_days: days,
        leads_by_status: leadsByStatus,
        drafts_by_status: draftsByStatus,
        sequence_enrollments_by_status: enrollmentsByStatus,
        suppressed_addresses: suppressed,
        events_in_window: tallyAuto((events ?? []) as Row[], ["event", "type", "event_type", "kind"]),
        recent_replies: (replies ?? []).map((r) => slim(r as Row, 200)),
      };
    } catch (e) {
      return err(e);
    }
  },
});

const getEmailStats = tool({
  description:
    "Email channel stats: marketing campaigns with their send/open/click counters, email event activity, and the support inbox drafting state.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(180).optional().describe("Window for event activity. Default 30."),
  }),
  execute: async (input) => {
    try {
      const days = input.days ?? 30;
      const { data: campaigns } = await supabaseAdmin
        .from("campaigns")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      const { data: events } = await supabaseAdmin
        .from("email_events")
        .select("*")
        .gte("created_at", since(days))
        .order("created_at", { ascending: false })
        .limit(2000);

      const [threads, sentReplies] = await Promise.all([
        countRows("email_threads"),
        countRows("sent_replies", (q) => q.gte("created_at", since(days))),
      ]);

      return {
        window_days: days,
        recent_campaigns: (campaigns ?? []).map((r) => slim(r as Row)),
        events_in_window: tallyAuto((events ?? []) as Row[], ["type", "event", "event_type"]),
        support: {
          total_threads: threads,
          replies_sent_in_window: sentReplies,
          threads_by_draft_status: await fetchStatusColumn("email_threads", "draft_status"),
        },
      };
    } catch (e) {
      return err(e);
    }
  },
});

const getAmazonStats = tool({
  description: "Amazon SP-API channel: order volume in a window, inventory snapshot and sync watermarks.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(180).optional().describe("Order window in days. Default 30."),
  }),
  execute: async (input) => {
    try {
      const days = input.days ?? 30;
      const [orderCount, syncState, inventory, recent] = await Promise.all([
        countRows("amazon_orders", (q) => q.gte("created_at", since(days))),
        supabaseAdmin.from("amazon_sync_state").select("*"),
        supabaseAdmin.from("amazon_inventory").select("*").limit(25),
        supabaseAdmin.from("amazon_orders").select("*").order("created_at", { ascending: false }).limit(5),
      ]);
      return {
        window_days: days,
        orders_in_window: orderCount,
        recent_orders: (recent.data ?? []).map((r) => slim(r as Row)),
        inventory: (inventory.data ?? []).map((r) => slim(r as Row)),
        sync_state: (syncState.data ?? []).map((r) => slim(r as Row)),
      };
    } catch (e) {
      return err(e);
    }
  },
});

const searchCustomer = tool({
  description:
    "Look up a customer by name, email or phone across contacts, WhatsApp contacts and their recent Shopify orders.",
  inputSchema: z.object({
    query: z.string().min(2).describe("Name, email or phone fragment."),
  }),
  execute: async (input) => {
    try {
      // Strip PostgREST or() syntax characters so the filter can't be broken.
      const q = input.query.replace(/[,%()]/g, "").trim();
      if (q.length < 2) return { error: "query too short after sanitising" };
      const like = `*${q}*`;

      const [contacts, waContacts, orders] = await Promise.all([
        supabaseAdmin
          .from("contacts")
          .select("email, first_name, phone, total_orders, total_spent, status")
          .or(`email.ilike.${like},first_name.ilike.${like},phone.ilike.${like}`)
          .limit(5),
        supabaseAdmin
          .from("wa_contacts")
          .select("wa_id, phone, name, last_seen_at")
          .or(`wa_id.ilike.${like},name.ilike.${like},phone.ilike.${like}`)
          .limit(5),
        supabaseAdmin
          .from("shopify_orders")
          .select("order_number, shopify_created_at, total_price, financial_status, source_name, customer_email, customer_phone")
          .or(`customer_email.ilike.${like},customer_phone.ilike.${like}`)
          .order("shopify_created_at", { ascending: false })
          .limit(10),
      ]);

      return {
        contacts: (contacts.data ?? []).map((r) => slim(r as Row)),
        whatsapp_contacts: (waContacts.data ?? []).map((r) => slim(r as Row)),
        recent_orders: (orders.data ?? []).map((r) => slim(r as Row)),
      };
    } catch (e) {
      return err(e);
    }
  },
});

const searchKb = tool({
  description:
    "Read the PROMUNCH Master knowledge base (products, prices, shipping and payment policy, brand facts). Use for any policy or product question.",
  inputSchema: z.object({}),
  execute: async () => {
    const kb = await getKnowledgeBase();
    return kb ? { kb } : { error: "knowledge base empty or unavailable" };
  },
});

const getAuditLog = tool({
  description: "Recent entries from the audit log: who did what in the dashboard (deletes, role changes, sends).",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).optional().describe("Rows to return. Default 20."),
  }),
  execute: async (input) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("audit_log")
        .select("created_at, actor_email, action, entity_type, entity_id, summary")
        .order("created_at", { ascending: false })
        .limit(input.limit ?? 20);
      if (error) return { error: error.message };
      return { entries: (data ?? []).map((r) => slim(r as Row, 200)) };
    } catch (e) {
      return err(e);
    }
  },
});

export const assistantTools = {
  query_orders: queryOrders,
  get_whatsapp_stats: getWhatsappStats,
  get_system_health: getSystemHealth,
  get_leads_pipeline: getLeadsPipeline,
  get_email_stats: getEmailStats,
  get_amazon_stats: getAmazonStats,
  search_customer: searchCustomer,
  search_kb: searchKb,
  get_audit_log: getAuditLog,
};
