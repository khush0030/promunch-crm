import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  buildAttention,
  type AmazonFinanceItemRow,
  type AmazonInventoryRow,
  type Attention,
  type CodOrderRow,
  type EmailDraftRow,
  type PausedCampaignRow,
  type TicketRow,
} from "@/lib/metrics/attention";

// The "needs attention" feed: powers the Needs Attention page, the Home
// attention panel, and the sidebar/tab-bar badge counts. READ-ONLY — this
// route only SELECTs. It must never send a WhatsApp/email message or call an
// edge function, no matter what the underlying tables say.
//
// GET /api/metrics/attention[?fresh=1]
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60_000;
let cache: { at: number; body: Attention } | null = null;

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

// PostgREST caps a single select at 1000 rows (amazon_finance_item_events is
// already at 998 for a 30d window and will cross that line soon), so every
// row-returning query below is walked in 1000-row pages via .range() until a
// short page comes back — same pattern as src/app/api/metrics/sales/route.ts's
// fetchAll, kept local here rather than cross-imported from another route.
// A failed page swallows the error and returns whatever was already paged
// (Task 0.4 decision #10: a failed sub-query drops that item, not the feed).
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fresh = url.searchParams.get("fresh") === "1";

  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.body, { headers: { "x-cache": "hit" } });
  }

  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const since14 = new Date(now.getTime() - 14 * DAY_MS).toISOString();
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
    // COD orders stuck on a confirmation call, opened in the last 14 days
    // (mirrors /api/whatsapp/cod-gate's GET query and the order-confirmations
    // page, which read the gate-managed queue the same way).
    fetchAll<CodOrderRow>("shopify_orders (needs_call)", (from, to) =>
      supabaseAdmin
        .from("shopify_orders")
        .select("shopify_id, total_price, shopify_created_at")
        .eq("confirmation_status", "needs_call")
        .gte("shopify_created_at", since14)
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
        .select("id")
        .eq("status", "pending")
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

  const body = buildAttention({
    now,
    amazonInventory,
    amazonFinanceItems,
    codOrders,
    tickets,
    emailDrafts,
    pausedCampaigns,
  });

  cache = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { "x-cache": "miss" } });
}
