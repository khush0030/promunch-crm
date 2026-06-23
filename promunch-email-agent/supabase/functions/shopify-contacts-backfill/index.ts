// Bulk backfill of the FULL Shopify customer base into the `contacts` table.
//
// WHY: contacts are only created by the webhook (customers/create + orders/create)
// which fires going-forward only AND skips anyone with no email. So the historical
// customer base never landed in the CRM — ~1046 rows vs ~1700+ in Shopify. This
// pages the entire Admin GraphQL customer list and upserts everyone, enriching
// with numberOfOrders / amountSpent / tags so CRM metrics are real.
//
// Batched like shopify-orders-backfill (WORKER_RESOURCE_LIMIT killed the earlier
// one-shot attempt): N pages per call, returns the cursor; chain until done:true.
//
//   curl ".../shopify-contacts-backfill?token=$T"                 # first batch
//   curl ".../shopify-contacts-backfill?token=$T&after=<cursor>"  # next, repeat
//
// AUTH NOTES:
//  - Gated on SHOPIFY_BACKFILL_TOKEN query param (no HMAC). verify_jwt=false.
//  - Writes via the ANON client on purpose: the service_role grant is revoked on
//    `contacts` (the app's webhook also writes it via anon), so service role 401s.
//
// DEDUP: customers with an email upsert onConflict 'email' (merge onto existing
// Klaviyo/contact rows); emailless customers key on 'shopify_customer_id'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { adminGraphQL } from "../_shared/shopify-customer.ts";

const PAGE_SIZE = 250;          // customers per GraphQL page (Admin max)
const DEFAULT_PAGES = 4;        // pages per invocation (stay under worker limit)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CUSTOMERS_PAGE = `
query CustomersPage($cursor: String) {
  customers(first: ${PAGE_SIZE}, after: $cursor, sortKey: CREATED_AT, reverse: false) {
    pageInfo { hasNextPage endCursor }
    nodes {
      legacyResourceId
      email
      firstName
      lastName
      phone
      numberOfOrders
      amountSpent { amount }
      tags
    }
  }
}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function anon() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_ANON_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Row = {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  shopify_customer_id: string;
  source: string;
  total_orders: number;
  total_spent: number;
  tags: string[];
};

const toRow = (n: any): Row => ({
  email: n.email ? String(n.email).trim().toLowerCase() : null,
  first_name: n.firstName || null,
  last_name: n.lastName || null,
  phone: n.phone || null,
  shopify_customer_id: String(n.legacyResourceId),
  source: "shopify",
  total_orders: Number(n.numberOfOrders) || 0,
  total_spent: Number(n.amountSpent?.amount) || 0,
  tags: Array.isArray(n.tags) ? n.tags : [],
});

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const expected = Deno.env.get("SHOPIFY_BACKFILL_TOKEN");
  if (!expected || token !== expected) return json({ ok: false, error: "unauthorized" }, 401);

  const sb = anon();
  const maxPages = Number(url.searchParams.get("pages") ?? DEFAULT_PAGES);
  let cursor: string | null = url.searchParams.get("after");

  let pages = 0;
  let upserts = 0;
  let withEmail = 0;
  let noEmail = 0;
  let hasNext = false;
  const errors: string[] = [];

  while (pages < maxPages) {
    let resp: any;
    try {
      resp = await adminGraphQL(CUSTOMERS_PAGE, { cursor });
    } catch (e) {
      errors.push((e instanceof Error ? e.message : String(e)).slice(0, 200));
      break;
    }
    if (resp?.errors) { errors.push(JSON.stringify(resp.errors).slice(0, 300)); break; }

    const conn = resp?.data?.customers;
    const nodes: any[] = conn?.nodes ?? [];
    if (!nodes.length) { hasNext = false; cursor = null; break; }

    const rows = nodes.map(toRow);
    const emailRows = rows.filter((r) => r.email);
    // contacts.email is NOT NULL — emailless Shopify profiles (guest/marketplace
    // buyers) are not email-addressable CRM contacts; their identity lives in
    // wa_contacts. Count them for reporting but never insert.
    noEmail += rows.length - emailRows.length;
    withEmail += emailRows.length;

    if (emailRows.length) {
      const { error } = await sb.from("contacts").upsert(emailRows, { onConflict: "email" });
      if (error) { errors.push(`db(email): ${error.message}`.slice(0, 300)); break; }
    }

    upserts += emailRows.length;
    pages++;
    hasNext = !!conn.pageInfo?.hasNextPage;
    cursor = conn.pageInfo?.endCursor ?? null;
    if (!hasNext) break;
    await sleep(150);
  }

  return json({
    ok: errors.length === 0,
    done: !hasNext,
    pages,
    upserts,
    withEmail,
    noEmail,
    next_cursor: hasNext ? cursor : null,
    errors,
  });
});
