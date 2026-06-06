// Bulk backfill of Shopify orders + traffic attribution into shopify_orders.
//
// WHY: the webhook only captures orders going forward, and attribution is fetched
// per-order. This function pages the FULL order history from the Admin GraphQL
// API (newest-or-oldest first), pulling each order's customerJourneySummary in
// the same query, and upserts everything — base fields + UTM/referrer/landing —
// in one pass. It also serves as the backstop that fills any order the webhook
// left unsynced (journey-not-ready races, transient API errors).
//
// Batched: WORKER_RESOURCE_LIMIT killed the earlier customer backfill when it
// tried to do everything in one invocation. So this does N pages per call and
// returns the cursor; chain calls until done:1.
//
//   curl ".../shopify-orders-backfill?token=$T"                 # first batch
//   curl ".../shopify-orders-backfill?token=$T&after=<cursor>"  # next, repeat
//   # …until the JSON response has "done": true
//
// Gating: not HMAC-signed (no Shopify call), so it's gated on a shared token
// (SHOPIFY_BACKFILL_TOKEN). Set verify_jwt=false in config.toml.

import { db } from "../_shared/supabase.ts";
import { adminGraphQL } from "../_shared/shopify-customer.ts";
import { JOURNEY_FIELDS, mapJourneyToColumns } from "../_shared/shopify-attribution.ts";
import { toWaId } from "../_shared/journeys.ts";

const PAGE_SIZE = 50;            // orders per GraphQL page
const DEFAULT_PAGES = 8;        // pages per invocation (stay under the worker limit)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ORDERS_PAGE = `
query OrdersPage($cursor: String) {
  orders(first: ${PAGE_SIZE}, after: $cursor, sortKey: CREATED_AT, reverse: false) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      legacyResourceId
      name
      createdAt
      email
      displayFinancialStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      subtotalPriceSet { shopMoney { amount } }
      customer { firstName lastName phone email }
      ${JOURNEY_FIELDS}
    }
  }
}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const expected = Deno.env.get("SHOPIFY_BACKFILL_TOKEN");
  if (!expected || token !== expected) return json({ ok: false, error: "unauthorized" }, 401);

  const maxPages = Number(url.searchParams.get("pages") ?? DEFAULT_PAGES);
  let cursor: string | null = url.searchParams.get("after");

  let pages = 0;
  let upserts = 0;
  let synced = 0;
  let hasNext = false;
  const errors: string[] = [];

  while (pages < maxPages) {
    let resp: any;
    try {
      resp = await adminGraphQL(ORDERS_PAGE, { cursor });
    } catch (e) {
      errors.push((e instanceof Error ? e.message : String(e)).slice(0, 200));
      break;
    }
    if (resp?.errors) { errors.push(JSON.stringify(resp.errors).slice(0, 300)); break; }

    const conn = resp?.data?.orders;
    const nodes: any[] = conn?.nodes ?? [];
    if (!nodes.length) { hasNext = false; cursor = null; break; }

    const now = new Date().toISOString();
    const rows = nodes.map((n) => {
      const ready = n.customerJourneySummary?.ready;
      // Only stamp attribution columns when the journey is ready; otherwise leave
      // them null so a later pass retries (mirrors the webhook's behaviour).
      const attr = ready === false ? {} : (() => { synced++; return mapJourneyToColumns(n, now); })();
      const phone = n.customer?.phone ?? null;
      const name = [n.customer?.firstName, n.customer?.lastName].filter(Boolean).join(" ").trim() || null;
      return {
        shopify_id: Number(n.legacyResourceId),
        order_number: n.name,
        total_price: Number(n.currentTotalPriceSet?.shopMoney?.amount ?? 0),
        subtotal_price: Number(n.subtotalPriceSet?.shopMoney?.amount ?? 0),
        currency: n.currentTotalPriceSet?.shopMoney?.currencyCode ?? "INR",
        financial_status: n.displayFinancialStatus ?? null,
        customer_email: n.email ?? n.customer?.email ?? null,
        customer_name: name,
        customer_phone: phone ? toWaId(phone) : null,
        shopify_created_at: n.createdAt,
        // NOTE: line_items/raw deliberately omitted — defaults apply on insert,
        // and on conflict the webhook's richer values are left untouched.
        ...attr,
      };
    });

    const { error } = await db().from("shopify_orders").upsert(rows, { onConflict: "shopify_id" });
    if (error) { errors.push(`db: ${error.message}`.slice(0, 300)); break; }

    upserts += rows.length;
    pages++;
    hasNext = !!conn.pageInfo?.hasNextPage;
    cursor = conn.pageInfo?.endCursor ?? null;
    if (!hasNext) break;
    await sleep(150); // gentle on the GraphQL cost budget
  }

  return json({
    ok: errors.length === 0,
    done: !hasNext,
    pages,
    upserts,
    synced,            // rows that had a ready journey written this run
    next_cursor: hasNext ? cursor : null,
    errors,
  });
});
