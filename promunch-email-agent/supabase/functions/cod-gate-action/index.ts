// Manual COD-gate actions from the dashboard (Needs-call queue buttons).
// Mirrors the button-tap logic exactly, with confirmed_via='manual'.
// No customer WhatsApp message is sent on manual actions — ops just spoke to
// them on the phone; bias to silence (CLAUDE.md §0).

import { requireInternal } from "../_shared/require-internal.ts";
import { cancelGate, confirmGate } from "../_shared/cod-gate.ts";

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return new Response("method", { status: 405 });

  let body: { shopify_id?: number | string; action?: string };
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }
  const id = body.shopify_id;
  if (id === undefined || id === null || !/^\d+$/.test(String(id))) {
    return j({ error: "shopify_id (numeric) required" }, 400);
  }

  if (body.action === "confirm") {
    const r = await confirmGate(id, "manual");
    return j(r, r.ok ? 200 : 500);
  }
  if (body.action === "cancel") {
    const r = await cancelGate(id, "manual");
    return j(r, r.ok ? 200 : 500);
  }
  return j({ error: "action must be 'confirm' or 'cancel'" }, 400);
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
