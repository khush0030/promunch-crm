// Public receiver for Super Money Breeze "auto-recovery" drop-off events
// (Breeze dashboard → Set up auto-recovery → Third-party webhook integration).
//
// CAPTURE-ONLY. This function records every delivery in connector_events and
// sends nothing to anyone. Breeze does not publish its payload shape, so the
// first real deliveries are how we learn it. Wiring these events into
// abandoned-cart enrolment is a separate, approval-gated change (AGENTS.md §4):
// it must reuse shopify-wa's one-live-sequence-per-customer claim, because the
// same carts already reach us as Shopify checkouts/* (sales channel SMB-1CCO).
//
// Auth: Breeze lets us attach a static header to each delivery. We require
// `x-breeze-secret: <BREEZE_WEBHOOK_SECRET>`; missing secret = fail closed.

import { errStr, logConnector } from "../_shared/connector-log.ts";

const MAX_BODY = 64_000; // a cart payload is a few KB; refuse anything absurd

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  // Some dashboards ping the URL with GET/HEAD when you save it.
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  const secret = Deno.env.get("BREEZE_WEBHOOK_SECRET");
  const got = req.headers.get("x-breeze-secret") ?? "";
  if (!secret || !safeEqual(got, secret)) {
    await logConnector({
      connector: "breeze", level: "warn", event: "webhook_unauthorized",
      message: secret ? "Breeze delivery with a missing or wrong x-breeze-secret header." : "BREEZE_WEBHOOK_SECRET is not set.",
      throttleMinutes: 30,
    });
    return new Response("unauthorized", { status: 401 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response("too large", { status: 413 });

  let body: unknown = raw;
  try { body = JSON.parse(raw); } catch { /* keep raw text; still worth seeing */ }

  try {
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const ref = [b.id, b.event_id, b.cart_id, b.checkout_id, b.order_id]
      .find((v) => typeof v === "string" || typeof v === "number");
    await logConnector({
      connector: "breeze", level: "info", event: "dropoff_received",
      message: `Breeze event ${String(b.event ?? b.type ?? b.event_type ?? "unknown")}`,
      ref: ref != null ? String(ref) : null,
      detail: {
        content_type: req.headers.get("content-type"),
        user_agent: req.headers.get("user-agent"),
        payload: body,
      },
    });
  } catch (e) {
    console.error("breeze-webhook log failed:", errStr(e));
  }

  // Always 200 once authenticated, so Breeze does not retry-storm us.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "content-type": "application/json" },
  });
});
