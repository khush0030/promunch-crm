import { describe, expect, it } from "vitest";
import {
  EDIT_MAX_CHARS,
  FEEDBACK_MAX_CHARS,
  isEmailThreadId,
  parseEmailDraftAction,
  routeStatusFor,
} from "./email-action";

describe("parseEmailDraftAction", () => {
  it("accepts approve and skip with no extra fields", () => {
    expect(parseEmailDraftAction({ action: "approve" })).toEqual({ ok: true, value: { action: "approve" } });
    expect(parseEmailDraftAction({ action: "skip" })).toEqual({ ok: true, value: { action: "skip" } });
  });

  it("drops unexpected fields like email_thread_id or actor_email from the client", () => {
    expect(
      parseEmailDraftAction({ action: "approve", actor_email: "evil@x.com", email_thread_id: "x" }),
    ).toEqual({ ok: true, value: { action: "approve" } });
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
