import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cartVoiceEligibility, CartVoiceInput, codCallDueBefore, codVoiceEligibility, CodVoiceInput,
  inCallWindow, istHour, nextWindowOpen,
} from "./voice-eligibility.ts";

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

const cart = (o: Partial<CartVoiceInput> = {}): CartVoiceInput => ({
  enabled: true, inWindow: true, cartTotal: 500, minCartValue: 0, voiceDnd: false, optedIn: true,
  inboundSinceEnrol: false, openTicket: false, allowlisted: true, cartDialled: false, cartInFlight: false,
  connectedWithin7d: false, waAlreadySent: false, ...o,
});

Deno.test("cart: happy path calls", () => {
  assertEquals(cartVoiceEligibility(cart()), { action: "call" });
});
Deno.test("cart: outside window cancels (WA flow takes over), never defers", () => {
  assertEquals(cartVoiceEligibility(cart({ inWindow: false })), { action: "cancel", reason: "outside_call_window" });
});
Deno.test("cart: in-flight dial defers 15 min", () => {
  assertEquals(cartVoiceEligibility(cart({ cartInFlight: true })), { action: "defer", minutes: 15, reason: "call_in_flight" });
});
Deno.test("cart: one real dial per cart", () => {
  assertEquals(cartVoiceEligibility(cart({ cartDialled: true })).action, "cancel");
});
Deno.test("cart: call-first, no call once a WA cart message already went out", () => {
  assertEquals(cartVoiceEligibility(cart({ waAlreadySent: true })), { action: "cancel", reason: "wa_already_sent" });
});
Deno.test("cart: every guard cancels", () => {
  for (const o of [
    { enabled: false }, { voiceDnd: true }, { optedIn: false }, { inboundSinceEnrol: true },
    { openTicket: true }, { allowlisted: false }, { connectedWithin7d: true }, { waAlreadySent: true }, { cartTotal: 100, minCartValue: 499 },
  ] as Partial<CartVoiceInput>[]) {
    assertEquals(cartVoiceEligibility(cart(o)).action, "cancel", JSON.stringify(o));
  }
});

const NOW = Date.parse("2026-10-01T06:30:00Z"); // 12:00 IST
const cod = (o: Partial<CodVoiceInput> = {}): CodVoiceInput => ({
  enabled: true, inWindow: true, status: "pending", voiceDnd: false, allowlisted: true,
  attempts: 0, maxAttempts: 2, lastCallStatus: null, lastCallAtMs: null, nowMs: NOW, retryHours: 3, ...o,
});

Deno.test("cod: first attempt calls", () => {
  assertEquals(codVoiceEligibility(cod()), { action: "call" });
});
Deno.test("cod: retry only after spacing", () => {
  assertEquals(codVoiceEligibility(cod({ attempts: 1, lastCallStatus: "no_answer", lastCallAtMs: NOW - 2 * 3600_000 })),
    { action: "skip", reason: "retry_spacing" });
  assertEquals(codVoiceEligibility(cod({ attempts: 1, lastCallStatus: "no_answer", lastCallAtMs: NOW - 3 * 3600_000 })),
    { action: "call" });
});
Deno.test("cod: guards skip", () => {
  assertEquals(codVoiceEligibility(cod({ status: "confirmed" })).action, "skip");
  assertEquals(codVoiceEligibility(cod({ attempts: 2 })).action, "skip");
  assertEquals(codVoiceEligibility(cod({ lastCallStatus: "dialing", lastCallAtMs: NOW - 10 * 3600_000 })).action, "skip");
  assertEquals(codVoiceEligibility(cod({ voiceDnd: true })).action, "skip");
  assertEquals(codVoiceEligibility(cod({ inWindow: false })).action, "skip");
  assertEquals(codVoiceEligibility(cod({ enabled: false })).action, "skip");
  assertEquals(codVoiceEligibility(cod({ allowlisted: false })).action, "skip");
});
Deno.test("cod: due-before = now minus reminder + voice delay", () => {
  assertEquals(codCallDueBefore(NOW, 6, 2), new Date(NOW - 8 * 3600_000).toISOString());
});
