// Run: deno test supabase/functions/_shared/opt-keywords_test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isStartText, isStopTap, isStopText } from "./opt-keywords.ts";

Deno.test("stop tap: template quick-reply button 'Stop promotions'", () => {
  assert(isStopTap({ type: "button", button: { text: "Stop promotions", payload: "Stop promotions" } }));
  assert(isStopTap({ type: "button", button: { text: "  STOP  " } }));
  assert(isStopTap({ type: "button", button: { text: "Something", payload: "stop promotions" } }));
});

Deno.test("stop tap: interactive button_reply", () => {
  assert(isStopTap({ type: "interactive", interactive: { button_reply: { id: "x", title: "Stop Promotions" } } }));
});

Deno.test("stop tap: exact match only; other taps and text are not opt-outs", () => {
  assertEquals(isStopTap({ type: "button", button: { text: "Confirm order", payload: "CONFIRM_123" } }), false);
  assertEquals(isStopTap({ type: "button", button: { text: "Stop promotions please" } }), false);
  assertEquals(isStopTap({ type: "interactive", interactive: { list_reply: { title: "stop" } } }), false);
  assertEquals(isStopTap({ type: "text", text: { body: "stop" } }), false); // text handled by isStopText
  assertEquals(isStopTap(null), false);
});

Deno.test("stop/start text keywords unchanged", () => {
  assert(isStopText("STOP"));
  assert(isStopText(" stop promotions "));
  assert(isStopText("opt-out"));
  assertEquals(isStopText("please stop sending my order"), false);
  assert(isStartText("Start"));
  assertEquals(isStartText("start my order"), false);
});

Deno.test("stop tap: COD gate + service quick replies + journey buttons are never opt-outs", () => {
  const taps = [
    { type: "button", button: { text: "Confirm order", payload: "CONFIRM_1234567890" } },
    { type: "button", button: { text: "Cancel order", payload: "CANCEL_1234567890" } },
    { type: "interactive", interactive: { button_reply: { id: "CONFIRM_1234567890", title: "Confirm" } } },
    { type: "interactive", interactive: { button_reply: { id: "CANCEL_1234567890", title: "Cancel" } } },
    { type: "button", button: { text: "Track my order", payload: "HELP_TRACK_2083" } },
    { type: "button", button: { text: "Leave a review", payload: "Leave a review" } },
    { type: "button", button: { text: "Shop now", payload: "Shop now" } },
    { type: "button", button: { text: "Stopped by the store", payload: "x" } },
    { type: "button", button: { text: "Don't stop", payload: "x" } },
  ];
  for (const t of taps) assertEquals(isStopTap(t), false, JSON.stringify(t));
});
