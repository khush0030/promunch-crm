import { assertEquals } from "jsr:@std/assert";
import { claimLossOutcome, isStaleDraft } from "./approve-guard.ts";

Deno.test("isStaleDraft: no expectation never blocks (Slack callers)", () => {
  assertEquals(isStaleDraft(undefined, "a"), false);
  assertEquals(isStaleDraft(null, "a"), false);
  assertEquals(isStaleDraft("", "a"), false);
});

Deno.test("isStaleDraft: blocks only when the shown revision is not current", () => {
  assertEquals(isStaleDraft("a", "a"), false);
  assertEquals(isStaleDraft("a", "b"), true);
});

Deno.test("claimLossOutcome: sent/sending read as already sent, anything else did not start", () => {
  assertEquals(claimLossOutcome("sent"), "already_sent");
  assertEquals(claimLossOutcome("sending"), "already_sent");
  assertEquals(claimLossOutcome("pending"), "not_started");
  assertEquals(claimLossOutcome("skipped"), "not_started");
  assertEquals(claimLossOutcome("failed"), "not_started");
  assertEquals(claimLossOutcome(null), "not_started");
  assertEquals(claimLossOutcome(undefined), "not_started");
});
