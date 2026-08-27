import { describe, expect, it } from "vitest";
import { reduceCartRuns } from "./reduce";

describe("reduceCartRuns", () => {
  it("counts a delivered + converted WA cart as recovered-eligible (delivered=true, converted=true)", () => {
    const carts = reduceCartRuns([
      { order_ref: "cart-1", status: "sent", delivered_at: "2026-08-01T00:00:00Z", context: { template: "abandoned_cart_step1" } },
      { order_ref: "cart-1", status: "converted", delivered_at: null, context: { template: "abandoned_cart_step2" } },
    ]);
    expect(carts.get("cart-1")).toEqual({ converted: true, delivered: true, active: false });
  });

  // Finding 2: a voice call connecting must not count as "a WhatsApp message
  // landed" in this WA-only funnel.
  it("does NOT count a voice-only delivery as a WhatsApp recovery", () => {
    const carts = reduceCartRuns([
      // Both WA sends failed for this cart — no delivered_at.
      { order_ref: "cart-2", status: "failed", delivered_at: null, context: { template: "abandoned_cart_step1" } },
      { order_ref: "cart-2", status: "failed", delivered_at: null, context: { template: "abandoned_cart_step2" } },
      // The voice-rescue row connected and got its own delivered_at stamp.
      { order_ref: "cart-2", status: "converted", delivered_at: "2026-08-01T00:00:00Z", context: { channel: "voice", template: "voice_cart_call" } },
    ]);
    // Without the filter this would read delivered:true (voice row leaking
    // in) and converted:true -> falsely counted as a WA "recovered" cart.
    expect(carts.get("cart-2")).toEqual({ converted: false, delivered: false, active: false });
  });

  it("still picks up converted from a non-voice row even when a voice row is also present", () => {
    const carts = reduceCartRuns([
      { order_ref: "cart-3", status: "converted", delivered_at: null, context: { template: "abandoned_cart_step1" } },
      { order_ref: "cart-3", status: "connected", delivered_at: "2026-08-01T00:00:00Z", context: { channel: "voice" } },
    ]);
    expect(carts.get("cart-3")).toEqual({ converted: true, delivered: false, active: false });
  });

  it("marks a cart active when a non-voice run is still active", () => {
    const carts = reduceCartRuns([
      { order_ref: "cart-4", status: "active", delivered_at: null, context: {} },
    ]);
    expect(carts.get("cart-4")?.active).toBe(true);
  });

  it("falls back to a synthetic key when order_ref is null, and still excludes voice rows", () => {
    const carts = reduceCartRuns([
      { order_ref: null, status: "cancelled", delivered_at: null, context: {} },
      { order_ref: null, status: "cancelled", delivered_at: "2026-08-01T00:00:00Z", context: { channel: "voice" } },
    ]);
    // Only the non-voice row should produce an entry.
    expect(carts.size).toBe(1);
  });
});
