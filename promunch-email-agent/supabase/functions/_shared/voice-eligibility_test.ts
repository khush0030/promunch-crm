import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { inCallWindow, istHour, nextWindowOpen, voiceEligibility, VoiceEligibilityInput } from "./voice-eligibility.ts";

// 2026-08-26T04:30:00Z = 10:00 IST
const T_1000_IST = Date.parse("2026-08-26T04:30:00Z");
const T_1959_IST = Date.parse("2026-08-26T14:29:00Z");
const T_2000_IST = Date.parse("2026-08-26T14:30:00Z");
const T_0230_IST = Date.parse("2026-08-25T21:00:00Z"); // 02:30 IST on Aug 26

Deno.test("istHour converts UTC to IST", () => {
  assertEquals(istHour(T_1000_IST), 10);
  assertEquals(istHour(T_0230_IST), 2);
});

Deno.test("window is start-inclusive, end-exclusive", () => {
  assertEquals(inCallWindow(T_1000_IST, 10, 20), true);
  assertEquals(inCallWindow(T_1959_IST, 10, 20), true);
  assertEquals(inCallWindow(T_2000_IST, 10, 20), false);
  assertEquals(inCallWindow(T_0230_IST, 10, 20), false);
});

Deno.test("nextWindowOpen is the next IST start hour strictly after now", () => {
  assertEquals(nextWindowOpen(T_0230_IST, 10).toISOString(), "2026-08-26T04:30:00.000Z");
  assertEquals(nextWindowOpen(T_2000_IST, 10).toISOString(), "2026-08-27T04:30:00.000Z");
  assertEquals(nextWindowOpen(T_1000_IST, 10).toISOString(), "2026-08-27T04:30:00.000Z");
});

const base: VoiceEligibilityInput = {
  enabled: true, cartTotal: 748, minCartValue: 0, voiceDnd: false, optedIn: true,
  inboundSinceEnrol: false, waDelivered: true, waStoodDown: false, waPending: false,
  cartConnected: false, cartAttempts: 0, cartInFlight: false, connectedWithin7d: false,
};

Deno.test("eligibility verdicts", () => {
  assertEquals(voiceEligibility(base), { action: "call" });
  assertEquals(voiceEligibility({ ...base, enabled: false }).action, "defer");
  assertEquals(voiceEligibility({ ...base, cartTotal: 100, minCartValue: 599 }).action, "cancel");
  // WA still pending and not stood down: wait for WA to finish first.
  assertEquals(voiceEligibility({ ...base, waDelivered: false, waPending: true }), { action: "defer", hours: 1, reason: "wa_pending" });
  // WA blocked by cap: call now.
  assertEquals(voiceEligibility({ ...base, waDelivered: false, waPending: true, waStoodDown: true }), { action: "call" });
  // Nothing delivered, nothing pending (WA rows failed/expired): call.
  assertEquals(voiceEligibility({ ...base, waDelivered: false, waPending: false }), { action: "call" });
});

// Regression: opted-out / DND still block first, unaffected by the retry rework.
Deno.test("opted-out and DND still block", () => {
  assertEquals(voiceEligibility({ ...base, voiceDnd: true }).action, "cancel");
  assertEquals(voiceEligibility({ ...base, optedIn: false }).action, "cancel");
  assertEquals(voiceEligibility({ ...base, inboundSinceEnrol: true }).action, "cancel");
});

// Finding 1: the documented retries must actually be reachable.
Deno.test("a connected call permanently blocks this cart", () => {
  assertEquals(voiceEligibility({ ...base, cartConnected: true, cartAttempts: 1 }),
    { action: "cancel", reason: "cart_already_connected" });
});

Deno.test("a single no_answer/busy/start_failed/unknown attempt allows exactly one more dial", () => {
  // One prior real attempt (no_answer, busy, or an unresolved 'unknown' that
  // did get an attempt_id) — not connected, not in flight: the retry fires.
  assertEquals(voiceEligibility({ ...base, cartAttempts: 1 }), { action: "call" });
});

Deno.test("two attempts hit the lifetime cap and cancel", () => {
  assertEquals(voiceEligibility({ ...base, cartAttempts: 2 }),
    { action: "cancel", reason: "cart_attempt_cap_reached" });
  // Cap holds even past 2 (defensive — should never exceed it in practice).
  assertEquals(voiceEligibility({ ...base, cartAttempts: 3 }).action, "cancel");
});

Deno.test("an in-flight dialing row defers, it does not cancel", () => {
  assertEquals(voiceEligibility({ ...base, cartInFlight: true }),
    { action: "defer", hours: 1, reason: "call_in_flight" });
});

Deno.test("connected within 7 days on ANY cart blocks a new cart", () => {
  assertEquals(voiceEligibility({ ...base, connectedWithin7d: true }),
    { action: "cancel", reason: "connected_within_7d" });
});

Deno.test("cartConnected and connectedWithin7d both take priority over the attempt cap", () => {
  // Even with 0 attempts recorded on THIS cart, a per-customer 7d connection
  // still blocks — the cap is per-cart, the 7d rule is per-customer.
  assertEquals(voiceEligibility({ ...base, cartAttempts: 0, connectedWithin7d: true }).action, "cancel");
});
