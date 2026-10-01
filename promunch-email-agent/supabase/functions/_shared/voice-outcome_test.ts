import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clampOutcome, decideOutcomeEffects, OutcomeInput } from "./voice-outcome.ts";

const base = (o: Partial<OutcomeInput> = {}): OutcomeInput => ({
  purpose: "cart", status: "connected", durationS: 45, outcome: "will_buy", linkSent: false,
  toolAction: null, attemptNo: 1, maxAttempts: 2, ...o,
});

Deno.test("cart reached cancels WA nudges", () => {
  assertEquals(decideOutcomeEffects(base()), { reached: true, setDnd: false, cancelCartRuns: true, codEscalate: null });
});
Deno.test("cart: a 5s pickup is not reached, unless the link went out", () => {
  assertEquals(decideOutcomeEffects(base({ durationS: 5 })).cancelCartRuns, false);
  assertEquals(decideOutcomeEffects(base({ durationS: 5, linkSent: true })).cancelCartRuns, true);
});
Deno.test("cart no answer leaves WA flow alone", () => {
  assertEquals(decideOutcomeEffects(base({ status: "no_answer", durationS: 0 })),
    { reached: false, setDnd: false, cancelCartRuns: false, codEscalate: null });
});
Deno.test("do_not_call sets dnd", () => {
  assertEquals(decideOutcomeEffects(base({ outcome: "do_not_call" })).setDnd, true);
});
Deno.test("cod: tool already acted -> nothing more", () => {
  assertEquals(decideOutcomeEffects(base({ purpose: "cod_confirm", toolAction: "confirm" })).codEscalate, null);
});
Deno.test("cod: reached without a decision escalates", () => {
  const e = decideOutcomeEffects(base({ purpose: "cod_confirm", outcome: "callback_later" }));
  assertEquals(e.codEscalate !== null, true);
  assertEquals(e.cancelCartRuns, false);
});
Deno.test("cod: unanswered escalates only on the last attempt", () => {
  assertEquals(decideOutcomeEffects(base({ purpose: "cod_confirm", status: "busy", attemptNo: 1 })).codEscalate, null);
  assertEquals(decideOutcomeEffects(base({ purpose: "cod_confirm", status: "busy", attemptNo: 2 })).codEscalate !== null, true);
});
Deno.test("clampOutcome", () => {
  assertEquals(clampOutcome("Confirmed"), "confirmed");
  assertEquals(clampOutcome("lol"), "unknown");
  assertEquals(clampOutcome(undefined), "unknown");
});
