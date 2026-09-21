import { assertEquals } from "jsr:@std/assert";
import { parseEmailDraftActionReq } from "./validate.ts";

const ID = "3f2a9c1e-8b7d-4e6f-a5b4-c3d2e1f0a9b8";
const ACTOR = "team@trypromunch.in";

const REV = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

Deno.test("skip needs only id + actor", () => {
  const r = parseEmailDraftActionReq({ action: "skip", email_thread_id: ID, actor_email: ACTOR });
  assertEquals(r, { ok: true, value: { action: "skip", email_thread_id: ID, actor_email: ACTOR } });
});

Deno.test("approve requires the draft_revision_id the approver saw", () => {
  assertEquals(
    parseEmailDraftActionReq({ action: "approve", email_thread_id: ID, actor_email: ACTOR }).ok,
    false,
  );
  assertEquals(
    parseEmailDraftActionReq({ action: "approve", email_thread_id: ID, actor_email: ACTOR, draft_revision_id: "v3" }).ok,
    false,
  );
  assertEquals(
    parseEmailDraftActionReq({ action: "approve", email_thread_id: ID, actor_email: ACTOR, draft_revision_id: REV }),
    { ok: true, value: { action: "approve", email_thread_id: ID, actor_email: ACTOR, draft_revision_id: REV } },
  );
});

Deno.test("rejects a non-uuid thread id", () => {
  const r = parseEmailDraftActionReq({
    action: "approve",
    email_thread_id: "1; drop",
    actor_email: ACTOR,
    draft_revision_id: REV,
  });
  assertEquals(r.ok, false);
});

Deno.test("rejects a missing actor email", () => {
  const r = parseEmailDraftActionReq({ action: "skip", email_thread_id: ID });
  assertEquals(r.ok, false);
});

Deno.test("rejects unknown actions and non-objects", () => {
  assertEquals(parseEmailDraftActionReq({ action: "send", email_thread_id: ID, actor_email: ACTOR }).ok, false);
  assertEquals(parseEmailDraftActionReq(null).ok, false);
  assertEquals(parseEmailDraftActionReq("approve").ok, false);
});

Deno.test("rewrite: feedback optional, trimmed, capped at 500", () => {
  assertEquals(
    parseEmailDraftActionReq({ action: "rewrite", email_thread_id: ID, actor_email: ACTOR }),
    { ok: true, value: { action: "rewrite", email_thread_id: ID, actor_email: ACTOR } },
  );
  assertEquals(
    parseEmailDraftActionReq({ action: "rewrite", email_thread_id: ID, actor_email: ACTOR, feedback: "  shorter  " }),
    { ok: true, value: { action: "rewrite", email_thread_id: ID, actor_email: ACTOR, feedback: "shorter" } },
  );
  assertEquals(
    parseEmailDraftActionReq({ action: "rewrite", email_thread_id: ID, actor_email: ACTOR, feedback: "x".repeat(501) }).ok,
    false,
  );
  assertEquals(
    parseEmailDraftActionReq({ action: "rewrite", email_thread_id: ID, actor_email: ACTOR, feedback: 5 }).ok,
    false,
  );
});

Deno.test("edit: body required, 1-8000 chars after trim", () => {
  assertEquals(parseEmailDraftActionReq({ action: "edit", email_thread_id: ID, actor_email: ACTOR }).ok, false);
  assertEquals(parseEmailDraftActionReq({ action: "edit", email_thread_id: ID, actor_email: ACTOR, body: "   " }).ok, false);
  assertEquals(
    parseEmailDraftActionReq({ action: "edit", email_thread_id: ID, actor_email: ACTOR, body: "x".repeat(8001) }).ok,
    false,
  );
  assertEquals(
    parseEmailDraftActionReq({ action: "edit", email_thread_id: ID, actor_email: ACTOR, body: " Hi there \n" }),
    { ok: true, value: { action: "edit", email_thread_id: ID, actor_email: ACTOR, body: "Hi there" } },
  );
});
