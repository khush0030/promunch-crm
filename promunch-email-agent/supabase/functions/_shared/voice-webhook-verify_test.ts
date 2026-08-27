import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyVoiceWebhook } from "./voice-webhook-verify.ts";

const row = { status: "dialing", attempt_id: "att_1", webhook_token: "tok_abc" };

Deno.test("accepts matching token + attempt on a dialing row", () => {
  assertEquals(verifyVoiceWebhook({ attempt_id: "att_1", token: "tok_abc" }, row), { ok: true });
});
Deno.test("rejects wrong token", () => {
  assertEquals(verifyVoiceWebhook({ attempt_id: "att_1", token: "tok_xyz" }, row).ok, false);
});
Deno.test("rejects wrong attempt", () => {
  assertEquals(verifyVoiceWebhook({ attempt_id: "att_2", token: "tok_abc" }, row).ok, false);
});
Deno.test("rejects replay on finished row", () => {
  assertEquals(verifyVoiceWebhook({ attempt_id: "att_1", token: "tok_abc" }, { ...row, status: "connected" }), { ok: false, reason: "already_finished" });
});
Deno.test("accepts a late webhook on a row the sweep marked unknown", () => {
  assertEquals(verifyVoiceWebhook({ attempt_id: "att_1", token: "tok_abc" }, { ...row, status: "unknown" }), { ok: true });
});
Deno.test("rejects missing row", () => {
  assertEquals(verifyVoiceWebhook({ attempt_id: "att_1", token: "tok_abc" }, null).ok, false);
});
