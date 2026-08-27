// Pure run-rows -> per-cart-outcome reduction for the WhatsApp cart-recovery
// funnel. Extracted from route.ts so the voice-row exclusion (below) is
// independently testable — see the header comment in route.ts for the
// history of the over-counting bug this guards against.

export type CartRunRow = {
  order_ref: string | null;
  status: string;
  delivered_at: string | null;
  context: unknown;
};

export type Cart = { converted: boolean; delivered: boolean; active: boolean };

// ATTRIBUTION FILTER: the Sarvam voice-rescue-call row (context.channel ===
// "voice", enrolled by shopify-wa) shares journey_key='abandoned_checkout'
// and order_ref with the WA reminder/coupon rows for the same cart. When a
// call connects, voice-webhook stamps delivered_at on that voice row. Folded
// into this WA-only reduction, that would silently count a cart whose WA
// sends both failed but whose call connected as "a WhatsApp message
// landed" — the exact over-counting commit 2748543 and the header comment in
// route.ts exist to prevent, just via a different channel this time. The
// voice channel already gets its own honest accounting in route.ts's `voice`
// block (keyed off voice_calls, not this table), so voice rows are excluded
// here rather than double-counted.
export function reduceCartRuns(rows: CartRunRow[]): Map<string, Cart> {
  const carts = new Map<string, Cart>();
  for (const r of rows) {
    if ((r.context as Record<string, unknown> | null)?.channel === "voice") continue;
    const key = r.order_ref ?? `run:${r.status}:${r.delivered_at ?? ""}`;
    const c = carts.get(key) ?? { converted: false, delivered: false, active: false };
    if (r.status === "converted") c.converted = true;
    if (r.delivered_at) c.delivered = true;
    if (r.status === "active") c.active = true;
    carts.set(key, c);
  }
  return carts;
}
