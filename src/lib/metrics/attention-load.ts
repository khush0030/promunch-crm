import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  buildAttention,
  type AmazonFinanceItemRow,
  type AmazonInventoryRow,
  type Attention,
  type AttentionInput,
  type CodOrderRow,
  type EmailDraftRow,
  type PausedCampaignRow,
  type TicketRow,
} from "@/lib/metrics/attention";

// Server-side loader for the "needs attention" feed. Shared by
// /api/metrics/attention (badges, Needs you page) and /api/notifications (the
// bell), so both read the same rows from one 60s in-process cache instead of
// querying twice. READ-ONLY: SELECTs only, never a send or an edge call.

const CACHE_TTL_MS = 60_000;
let cache: { at: number; body: Attention; input: AttentionInput } | null = null;

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

// PostgREST caps a single select at 1000 rows (amazon_finance_item_events is
// already at 998 for a 30d window and will cross that line soon), so every
// row-returning query below is walked in 1000-row pages via .range() until a
// short page comes back. A failed page swallows the error and returns
// whatever was already paged (a failed sub-query drops that item, not the feed).
async function fetchAll<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  try {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await page(from, from + PAGE_SIZE - 1);
      if (error) {
        console.error(`[metrics/attention] ${label}:`, error.message);
        break;
      }
      const chunk = data ?? [];
      rows.push(...chunk);
      if (chunk.length < PAGE_SIZE) break;
    }
  } catch (e) {
    console.error(`[metrics/attention] ${label}:`, e);
  }
  return rows;
}

export async function loadAttention({ fresh = false } = {}): Promise<{
  body: Attention;
  input: AttentionInput;
  hit: boolean;
}> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { body: cache.body, input: cache.input, hit: true };
  }

  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const since4h = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();

  const [amazonInventory, amazonFinanceItems, codOrders, tickets, emailDrafts, pausedCampaigns] = await Promise.all([
    fetchAll<AmazonInventoryRow>("amazon_inventory", (from, to) =>
      supabaseAdmin
        .from("amazon_inventory")
        .select("seller_sku, product_name, fulfillable_quantity, inbound_shipped")
        .order("seller_sku", { ascending: true })
        .range(from, to),
    ),
    fetchAll<AmazonFinanceItemRow>("amazon_finance_item_events", (from, to) =>
      supabaseAdmin
        .from("amazon_finance_item_events")
        .select("seller_sku, event_type, posted_date, quantity, net")
        .gte("posted_date", since30)
        .order("posted_date", { ascending: true })
        .range(from, to),
    ),
    // COD orders still waiting on a confirmation: gate status pending or
    // needs_call, not yet shipped and not cancelled, at any age. Same rule as
    // the Confirm COD page's "Waiting" count (/api/whatsapp/cod-gate GET), so
    // the badge and the page always agree. Orders ops ship straight from
    // Shopify drop out on their own.
    fetchAll<CodOrderRow>("shopify_orders (cod waiting)", (from, to) =>
      supabaseAdmin
        .from("shopify_orders")
        .select("shopify_id, total_price, shopify_created_at")
        .in("confirmation_status", ["pending", "needs_call"])
        .is("fulfillment_status", null)
        .is("cancelled_at", null)
        .order("shopify_created_at", { ascending: true })
        .range(from, to),
    ),
    // Open/pending WhatsApp tickets opened more than 4h ago, not archived.
    fetchAll<TicketRow>("wa_threads (tickets)", (from, to) =>
      supabaseAdmin
        .from("wa_threads")
        .select("id, ticket_opened_at")
        .in("ticket_status", ["open", "pending"])
        .is("archived_at", null)
        .lt("ticket_opened_at", since4h)
        .order("ticket_opened_at", { ascending: true })
        .range(from, to),
    ),
    fetchAll<EmailDraftRow>("email_threads (pending)", (from, to) =>
      supabaseAdmin
        .from("email_threads")
        .select("id, created_at")
        .eq("status", "pending")
        // Same rule as the Email drafts "To approve" tab: emails the
        // classifier marked as needing no reply are not waiting on anyone.
        .or("should_reply.is.null,should_reply.eq.true")
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    // Candidates for "deferred by Meta's marketing cap": wa_campaigns has no
    // 'paused' status and never stamps last_error with 131049 (see
    // wa-campaign-send/index.ts) — a capped campaign stays status='sending'
    // with resume_at set to the next daily send slot. buildAttention() does
    // the "resume_at is still in the future" filtering.
    fetchAll<PausedCampaignRow>("wa_campaigns (deferred)", (from, to) =>
      supabaseAdmin
        .from("wa_campaigns")
        .select("id, name, resume_at")
        .eq("status", "sending")
        .not("resume_at", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const input: AttentionInput = {
    now,
    amazonInventory,
    amazonFinanceItems,
    codOrders,
    tickets,
    emailDrafts,
    pausedCampaigns,
  };
  const body = buildAttention(input);
  cache = { at: Date.now(), body, input };
  return { body, input, hit: false };
}
