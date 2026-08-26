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
  recentCallWithin7d: false, callForThisCart: false,
};

Deno.test("eligibility verdicts", () => {
  assertEquals(voiceEligibility(base), { action: "call" });
  assertEquals(voiceEligibility({ ...base, enabled: false }).action, "defer");
  assertEquals(voiceEligibility({ ...base, cartTotal: 100, minCartValue: 599 }).action, "cancel");
  assertEquals(voiceEligibility({ ...base, voiceDnd: true }).action, "cancel");
  assertEquals(voiceEligibility({ ...base, optedIn: false }).action, "cancel");
  assertEquals(voiceEligibility({ ...base, inboundSinceEnrol: true }).action, "cancel");
  assertEquals(voiceEligibility({ ...base, callForThisCart: true }).action, "cancel");
  assertEquals(voiceEligibility({ ...base, recentCallWithin7d: true }).action, "cancel");
  // WA still pending and not stood down: wait for WA to finish first.
  assertEquals(voiceEligibility({ ...base, waDelivered: false, waPending: true }), { action: "defer", hours: 1, reason: "wa_pending" });
  // WA blocked by cap: call now.
  assertEquals(voiceEligibility({ ...base, waDelivered: false, waPending: true, waStoodDown: true }), { action: "call" });
  // Nothing delivered, nothing pending (WA rows failed/expired): call.
  assertEquals(voiceEligibility({ ...base, waDelivered: false, waPending: false }), { action: "call" });
});
