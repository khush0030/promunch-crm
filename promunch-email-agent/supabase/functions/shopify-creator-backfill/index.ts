// One-off backfill: tag existing ₹0.01 HYPD-creator orders.
//
// The webhook tags creator orders going forward (and the migration set the
// is_creator flag on existing rows from the price signal). This pushes the
// native "HYPD Creator" tag onto the orders that already exist in Shopify —
// the one thing a SQL migration can't do, since it needs the Admin API.
//
// Selects shopify_orders at exactly ₹0.01, calls tagsAdd on each (idempotent),
// and (re-)sets is_creator as a belt-and-braces. Batched to stay under the
// worker resource limit; chain calls until done:1.
//
//   curl ".../shopify-creator-backfill?token=$SHOPIFY_BACKFILL_TOKEN"
//   curl ".../shopify-creator-backfill?token=$T&offset=200"   # next batch
//   # …until the JSON response has "done": true
//
// Gating: no Shopify HMAC (we call out, nothing calls in), so it's gated on the
// shared SHOPIFY_BACKFILL_TOKEN. Set verify_jwt=false in config.toml.

import { db } from "../_shared/supabase.ts";
import { addOrderTags } from "../_shared/shopify-customer.ts";

const BATCH = 200;              // orders fetched per invocation
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const expected = Deno.env.get("SHOPIFY_BACKFILL_TOKEN");
  if (!expected || token !== expected) return json({ ok: false, error: "unauthorized" }, 401);

  const offset = Number(url.searchParams.get("offset") ?? "0");

  // Exactly 1 paisa. is_creator was set by the migration; we select on the price
  // signal directly so this works even if the migration hasn't run yet.
  const { data: rows, error } = await db()
    .from("shopify_orders")
    .select("shopify_id, order_number")
    .eq("total_price", 0.01)
    .order("shopify_created_at", { ascending: false })
    .range(offset, offset + BATCH - 1);

  if (error) return json({ ok: false, error: error.message }, 500);

  let tagged = 0;
  const failed: { order: string; reason: string }[] = [];
  for (const row of rows ?? []) {
    const r = await addOrderTags(row.shopify_id, ["HYPD Creator"]);
    if (r.ok) {
      tagged++;
      await db().from("shopify_orders")
        .update({ is_creator: true })
        .eq("shopify_id", row.shopify_id);
    } else {
      failed.push({ order: row.order_number, reason: r.reason });
    }
    await sleep(120); // gentle on the Admin API rate limit
  }

  const done = (rows?.length ?? 0) < BATCH;
  return json({
    ok: true,
    done,
    batch: rows?.length ?? 0,
    tagged,
    failed,
    nextOffset: done ? null : offset + BATCH,
  });
});
