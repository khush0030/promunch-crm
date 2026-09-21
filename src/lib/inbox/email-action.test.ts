import { describe, expect, it } from "vitest";
import {
  EDIT_MAX_CHARS,
  FEEDBACK_MAX_CHARS,
  DRAFT_CHANGED_MESSAGE,
  ALREADY_ANSWERED_MESSAGE,
  GMAIL_CHECK_FAILED_MESSAGE,
  NOT_SENT_MESSAGE,
  isEmailThreadId,
  parseEmailDraftAction,
  routeStatusFor,
  shapeActionResponse,
} from "./email-action";

const REV = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("parseEmailDraftAction", () => {
  it("accepts skip with no extra fields", () => {
    expect(parseEmailDraftAction({ action: "skip" })).toEqual({ ok: true, value: { action: "skip" } });
  });

  it("approve requires the draft_revision_id the approver saw", () => {
    expect(parseEmailDraftAction({ action: "approve" }).ok).toBe(false);
    expect(parseEmailDraftAction({ action: "approve", draft_revision_id: "v2" }).ok).toBe(false);
    expect(parseEmailDraftAction({ action: "approve", draft_revision_id: 7 }).ok).toBe(false);
    expect(parseEmailDraftAction({ action: "approve", draft_revision_id: REV })).toEqual({
      ok: true,
      value: { action: "approve", draft_revision_id: REV },
    });
  });

  it("drops unexpected fields like email_thread_id or actor_email from the client", () => {
    expect(
      parseEmailDraftAction({
        action: "approve",
        draft_revision_id: REV,
        actor_email: "evil@x.com",
        email_thread_id: "x",
      }),
    ).toEqual({ ok: true, value: { action: "approve", draft_revision_id: REV } });
  });

  it("rejects missing, unknown and non-object bodies", () => {
    expect(parseEmailDraftAction(null).ok).toBe(false);
    expect(parseEmailDraftAction([]).ok).toBe(false);
    expect(parseEmailDraftAction("approve").ok).toBe(false);
    expect(parseEmailDraftAction({}).ok).toBe(false);
    expect(parseEmailDraftAction({ action: "send" }).ok).toBe(false);
  });

  it("rewrite: feedback is optional, trimmed and capped", () => {
    expect(parseEmailDraftAction({ action: "rewrite" })).toEqual({ ok: true, value: { action: "rewrite" } });
    expect(parseEmailDraftAction({ action: "rewrite", feedback: "   " })).toEqual({
      ok: true,
      value: { action: "rewrite" },
    });
    expect(parseEmailDraftAction({ action: "rewrite", feedback: " shorter " })).toEqual({
      ok: true,
      value: { action: "rewrite", feedback: "shorter" },
    });
    expect(parseEmailDraftAction({ action: "rewrite", feedback: "x".repeat(FEEDBACK_MAX_CHARS) }).ok).toBe(true);
    expect(parseEmailDraftAction({ action: "rewrite", feedback: "x".repeat(FEEDBACK_MAX_CHARS + 1) }).ok).toBe(false);
    expect(parseEmailDraftAction({ action: "rewrite", feedback: 42 }).ok).toBe(false);
  });

  it("edit: body must be 1-8000 characters after trimming", () => {
    expect(parseEmailDraftAction({ action: "edit" }).ok).toBe(false);
    expect(parseEmailDraftAction({ action: "edit", body: "  \n " }).ok).toBe(false);
    expect(parseEmailDraftAction({ action: "edit", body: "x".repeat(EDIT_MAX_CHARS) }).ok).toBe(true);
    expect(parseEmailDraftAction({ action: "edit", body: "x".repeat(EDIT_MAX_CHARS + 1) }).ok).toBe(false);
    expect(parseEmailDraftAction({ action: "edit", body: " Hi Ria,\nThanks! \n" })).toEqual({
      ok: true,
      value: { action: "edit", body: "Hi Ria,\nThanks!" },
    });
  });
});

describe("isEmailThreadId", () => {
  it("accepts uuids only", () => {
    expect(isEmailThreadId("3f2a9c1e-8b7d-4e6f-a5b4-c3d2e1f0a9b8")).toBe(true);
    expect(isEmailThreadId("123")).toBe(false);
    expect(isEmailThreadId("3f2a9c1e-8b7d-4e6f-a5b4-c3d2e1f0a9b8; drop")).toBe(false);
  });
});

describe("routeStatusFor", () => {
  it("passes success and user-facing refusals through, maps the rest to 502", () => {
    expect(routeStatusFor(200)).toBe(200);
    expect(routeStatusFor(400)).toBe(400);
    expect(routeStatusFor(404)).toBe(404);
    expect(routeStatusFor(409)).toBe(409);
    expect(routeStatusFor(401)).toBe(502);
    expect(routeStatusFor(500)).toBe(502);
    expect(routeStatusFor(503)).toBe(502);
  });
});

describe("shapeActionResponse", () => {
  it("maps already_answered to 409 saying nothing was sent", () => {
    expect(
      shapeActionResponse(409, { ok: false, status: "already_answered", error: "already answered in gmail" }),
    ).toEqual({
      status: 409,
      body: { ok: false, status: "already_answered", error: ALREADY_ANSWERED_MESSAGE },
    });
  });

  it("maps gmail_check_failed to 502 saying nothing was sent", () => {
    expect(
      shapeActionResponse(502, { ok: false, status: "gmail_check_failed", error: "could not check gmail" }),
    ).toEqual({
      status: 502,
      body: { ok: false, status: "gmail_check_failed", error: GMAIL_CHECK_FAILED_MESSAGE },
    });
    expect(ALREADY_ANSWERED_MESSAGE).toBe("Already answered in Gmail. Nothing was sent.");
    expect(GMAIL_CHECK_FAILED_MESSAGE).toBe("Couldn't check Gmail, so nothing was sent. Try again in a minute.");
  });

  it("maps draft_changed to 409 with the review message", () => {
    expect(shapeActionResponse(409, { ok: false, error: "draft changed", status: "draft_changed" })).toEqual({
      status: 409,
      body: { ok: false, status: "draft_changed", error: DRAFT_CHANGED_MESSAGE },
    });
  });

  it("maps a send that never started to 502 saying nothing was sent", () => {
    expect(shapeActionResponse(500, { ok: false, error: "could not start the send" })).toEqual({
      status: 502,
      body: { ok: false, error: NOT_SENT_MESSAGE },
    });
  });

  it("passes success and refusals through, other failures become 502 with the edge error", () => {
    expect(shapeActionResponse(200, { ok: true, status: "sent" })).toEqual({
      status: 200,
      body: { ok: true, status: "sent" },
    });
    expect(shapeActionResponse(200, { ok: true, status: "already_sent" }).status).toBe(200);
    expect(shapeActionResponse(409, { ok: false, error: "already sent" })).toEqual({
      status: 409,
      body: { ok: false, error: "already sent" },
    });
    expect(shapeActionResponse(500, { ok: false, error: "gmail 403" })).toEqual({
      status: 502,
      body: { ok: false, error: "gmail 403" },
    });
    expect(shapeActionResponse(401, { error: "unauthorized" }).status).toBe(502);
    expect(shapeActionResponse(503, {})).toEqual({
      status: 502,
      body: { ok: false, error: "email service failed" },
    });
  });
});
