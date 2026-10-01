import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeAttempt } from "./sarvam.ts";

Deno.test("normalizeAttempt maps Sarvam analytics rows", () => {
  const a = normalizeAttempt({
    attempt_id: "att-1", interaction_id: "NO_INTERACTION", connectivity_status: "No_Answer",
    duration_in_seconds: "0", failure_reason: "NO_FAILURE", agent_variables: { call_disposition: "unknown" },
  });
  assertEquals(a, {
    attemptId: "att-1", interactionId: null, status: "no_answer", durationSeconds: 0,
    failureReason: null, agentVariables: { call_disposition: "unknown" },
  });
});
Deno.test("normalizeAttempt: unfinished attempt is unknown", () => {
  assertEquals(normalizeAttempt({ attempt_id: "x", connectivity_status: "in_progress" }).status, "unknown");
});
