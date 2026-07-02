// Cron (nightly): refresh RFM segment tags on wa_contacts.
//
// Calls recompute_wa_rfm_tags() (migration 20260622133000_wa_rfm_segmentation),
// which rolls up shopify_orders by customer phone into Recency/Frequency/
// Monetary tiers and (re)writes the single rfm:* tag on every buyer — creating
// wa_contacts rows for phone-only buyers who never messaged us. The WhatsApp
// campaign sender filters audience by tag overlap, so this is what makes
// segmented blasts ({tags:['rfm:vip']}) possible.
//
// Idempotent — safe to run on any schedule. Nightly is plenty:
//   supabase functions schedule create wa-rfm-tick "30 1 * * *"   # 01:30 UTC = 07:00 IST

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { logConnector } from "../_shared/connector-log.ts";

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const sb = db();

  const { data: affected, error } = await sb.rpc("recompute_wa_rfm_tags");

  if (error) {
    await logConnector({
      connector: "whatsapp",
      level: "error",
      event: "rfm_recompute_failed",
      message: `RFM tag recompute failed: ${error.message}`.slice(0, 300),
      detail: { error: error.message },
    });
    return j({ ok: false, error: error.message }, 500);
  }

  // Segment-size snapshot for observability — cheap, and handy in logs.
  const { data: tiers } = await sb
    .from("wa_customer_rfm")
    .select("rfm_tier")
    .then((r) => {
      const counts: Record<string, number> = {};
      for (const row of r.data ?? []) counts[row.rfm_tier] = (counts[row.rfm_tier] ?? 0) + 1;
      return { data: counts };
    }, () => ({ data: {} as Record<string, number> }));

  await logConnector({
    connector: "whatsapp",
    level: "info",
    event: "rfm_recompute",
    message: `RFM tags refreshed — ${affected ?? 0} contacts upserted.`,
    detail: { affected, tiers },
    throttleMinutes: 60,
  });

  return j({ ok: true, affected, tiers });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
