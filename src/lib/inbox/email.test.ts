import { describe, it, expect } from "vitest";
import {
  tabOf,
  sortQueue,
  stepIndex,
  clipText,
  EMAIL_TABS,
  actionOutcome,
  settleNotice,
  plainEdgeError,
  draftBlock,
  replyBlockedReason,
  UNCERTAIN_SEND_MESSAGE,
  REPLY_SENT_MESSAGE,
} from "./email";
import { DRAFT_CHANGED_MESSAGE, NOT_SENT_MESSAGE } from "./email-action";

describe("tabOf", () => {
  it("puts pending emails that need a reply in To approve", () => {
    expect(tabOf({ status: "pending", should_reply: true })).toBe("approve");
    expect(tabOf({ status: "pending", should_reply: null })).toBe("approve");
  });

  it("puts pending emails the classifier said need no reply in No reply needed", () => {
    expect(tabOf({ status: "pending", should_reply: false })).toBe("noreply");
  });

  it("maps sent and skipped regardless of should_reply", () => {
    expect(tabOf({ status: "sent", should_reply: true })).toBe("sent");
    expect(tabOf({ status: "sent", should_reply: false })).toBe("sent");
    expect(tabOf({ status: "skipped", should_reply: null })).toBe("skipped");
  });

  it("returns null for in-flight or failed threads, so they are never approvable", () => {
    expect(tabOf({ status: "sending", should_reply: true })).toBeNull();
    expect(tabOf({ status: "failed", should_reply: true })).toBeNull();
    expect(tabOf({ status: "", should_reply: null })).toBeNull();
  });

  it("lists the four tabs in display order", () => {
    expect(EMAIL_TABS).toEqual(["approve", "noreply", "sent", "skipped"]);
  });
});

describe("sortQueue", () => {
  const row = (id: string, urgency: string | null, created_at: string) => ({ id, urgency, created_at });

  it("orders critical, then high, then everything else", () => {
    const out = sortQueue([
      row("m", "medium", "2026-09-20T01:00:00Z"),
      row("h", "high", "2026-09-20T02:00:00Z"),
      row("c", "critical", "2026-09-20T03:00:00Z"),
      row("n", null, "2026-09-20T00:00:00Z"),
    ]);
    expect(out.map((r) => r.id)).toEqual(["c", "h", "n", "m"]);
  });

  it("puts the oldest first inside a group", () => {
    const out = sortQueue([
      row("c2", "critical", "2026-09-20T05:00:00Z"),
      row("c1", "critical", "2026-09-20T01:00:00Z"),
      row("m2", "medium", "2026-09-19T05:00:00Z"),
      row("low1", "low", "2026-09-18T05:00:00Z"),
    ]);
    expect(out.map((r) => r.id)).toEqual(["c1", "c2", "low1", "m2"]);
  });

  it("does not mutate its input", () => {
    const input = [row("a", null, "2026-09-20T05:00:00Z"), row("b", "critical", "2026-09-20T06:00:00Z")];
    sortQueue(input);
    expect(input.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("stepIndex", () => {
  const ids = ["a", "b", "c"];

  it("finds a middle item with both neighbours", () => {
    expect(stepIndex(ids, "b")).toEqual({ index: 1, total: 3, prev: "a", next: "c" });
  });

  it("has no prev on the first item", () => {
    expect(stepIndex(ids, "a")).toEqual({ index: 0, total: 3, prev: null, next: "b" });
  });

  it("has no next on the last item", () => {
    expect(stepIndex(ids, "c")).toEqual({ index: 2, total: 3, prev: "b", next: null });
  });

  it("falls back to the first item when the id is missing or null", () => {
    expect(stepIndex(ids, "zzz")).toEqual({ index: 0, total: 3, prev: null, next: "b" });
    expect(stepIndex(ids, null)).toEqual({ index: 0, total: 3, prev: null, next: "b" });
  });

  it("handles an empty queue", () => {
    expect(stepIndex([], "a")).toEqual({ index: 0, total: 0, prev: null, next: null });
  });
});

describe("clipText", () => {
  it("leaves short text alone", () => {
    expect(clipText("hello", 1200)).toEqual({ text: "hello", clipped: false });
  });

  it("cuts long text at the limit and marks it clipped", () => {
    const long = "x".repeat(1300);
    const out = clipText(long, 1200);
    expect(out.clipped).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(1201);
    expect(out.text.endsWith("…")).toBe(true);
  });

  it("treats null as empty", () => {
    expect(clipText(null, 1200)).toEqual({ text: "", clipped: false });
  });
});

describe("plainEdgeError", () => {
  it("maps known edge strings to plain sentences", () => {
    expect(plainEdgeError("already sent")).toBe("This reply was already sent.");
    expect(plainEdgeError("no current draft")).toBe("There's no draft to send yet.");
    expect(plainEdgeError("another revision was saved at the same time, try again")).toBe(DRAFT_CHANGED_MESSAGE);
    expect(plainEdgeError("draft changed")).toBe(DRAFT_CHANGED_MESSAGE);
    expect(plainEdgeError("thread not found")).toBe("This email no longer exists.");
  });

  it("keeps the route's own plain sentences", () => {
    expect(plainEdgeError("The edited draft can't be empty.")).toBe("The edited draft can't be empty.");
    expect(plainEdgeError(NOT_SENT_MESSAGE)).toBe(NOT_SENT_MESSAGE);
  });

  it("never returns raw unknown text", () => {
    expect(plainEdgeError("invalid_grant: token expired")).toBeNull();
    expect(plainEdgeError("Couldn't reach the email service: fetch failed")).toBeNull();
    expect(plainEdgeError(undefined)).toBeNull();
    expect(plainEdgeError(42)).toBeNull();
  });
});

describe("actionOutcome: approve", () => {
  const approve = (httpStatus: number | null, body: Record<string, unknown> | null) =>
    actionOutcome("approve", { httpStatus, body });

  it("treats a 200 ok as success and carries the status", () => {
    expect(approve(200, { ok: true, status: "sent" })).toEqual({ kind: "success", status: "sent" });
    expect(approve(200, { ok: true, status: "already_sent" })).toEqual({ kind: "success", status: "already_sent" });
  });

  it("says nothing went out only on the route's definite NOT_SENT 502", () => {
    const out = approve(502, { ok: false, error: NOT_SENT_MESSAGE });
    expect(out).toMatchObject({ kind: "failed", uncertain: false, message: NOT_SENT_MESSAGE, tone: "crit" });
  });

  it("is definite for edge errors that return before sending", () => {
    const out = approve(502, { ok: false, error: "no current draft" });
    expect(out).toMatchObject({ kind: "failed", uncertain: false });
    if (out.kind === "failed") expect(out.message).toContain("Nothing went to the customer.");
  });

  it("maps 409 draft_changed to the exact draft-changed copy", () => {
    expect(approve(409, { ok: false, status: "draft_changed", error: DRAFT_CHANGED_MESSAGE })).toMatchObject({
      kind: "failed",
      uncertain: false,
      message: DRAFT_CHANGED_MESSAGE,
    });
  });

  it("maps a 409 already sent to a plain sentence", () => {
    expect(approve(409, { ok: false, error: "already sent" })).toMatchObject({
      kind: "failed",
      uncertain: false,
      message: "This reply was already sent.",
    });
  });

  it("is uncertain on a network throw, a non-JSON body, a 504 or an unknown 5xx", () => {
    for (const out of [
      approve(null, null),
      approve(502, null),
      approve(504, { ok: false, error: "timeout" }),
      approve(500, { ok: false, error: "boom" }),
      approve(502, { ok: false, error: "Gmail send failed: 500" }),
    ]) {
      expect(out).toEqual({ kind: "failed", tone: "crit", message: UNCERTAIN_SEND_MESSAGE, uncertain: true });
    }
  });

  it("never says nothing went out on an uncertain failure", () => {
    const out = approve(null, null);
    if (out.kind === "failed") expect(out.message).not.toContain("Nothing went to the customer");
  });

  it("is definite for route refusals before the edge is called", () => {
    const out = approve(400, { ok: false, error: "Approve needs the id of the draft you reviewed." });
    expect(out).toMatchObject({ kind: "failed", uncertain: false });
    if (out.kind === "failed") {
      expect(out.message).toBe("Approve needs the id of the draft you reviewed. Nothing went to the customer.");
    }
  });
});

describe("actionOutcome: skip, edit, rewrite", () => {
  it("prefixes what did not happen and maps the edge text", () => {
    expect(actionOutcome("edit", { httpStatus: 409, body: { ok: false, error: "already sent" } })).toEqual({
      kind: "failed",
      tone: "crit",
      message: "The draft was not saved. This reply was already sent.",
      uncertain: false,
    });
    expect(
      actionOutcome("rewrite", { httpStatus: 409, body: { ok: false, error: "another revision was saved at the same time, try again" } }),
    ).toMatchObject({ message: `The draft was not rewritten. ${DRAFT_CHANGED_MESSAGE}` });
  });

  it("uses a generic sentence for unknown text", () => {
    expect(actionOutcome("skip", { httpStatus: 500, body: { ok: false, error: "relation x does not exist" } })).toMatchObject({
      kind: "failed",
      message: "The email was not skipped. Something went wrong, please try again.",
    });
    expect(actionOutcome("skip", { httpStatus: null, body: null })).toMatchObject({ kind: "failed", uncertain: false });
  });

  it("treats a 200 ok as success", () => {
    expect(actionOutcome("rewrite", { httpStatus: 200, body: { ok: true, status: "rewritten", revision: 3 } })).toEqual({
      kind: "success",
      status: "rewritten",
    });
  });
});

describe("settleNotice", () => {
  it("turns an uncertain send into 'sent' once the thread is on the Sent tab", () => {
    expect(settleNotice({ tone: "crit", message: UNCERTAIN_SEND_MESSAGE, uncertain: true }, "sent")).toEqual({
      tone: "plain",
      message: REPLY_SENT_MESSAGE,
    });
  });

  it("keeps the uncertain copy while the thread is still pending", () => {
    expect(settleNotice({ tone: "crit", message: UNCERTAIN_SEND_MESSAGE, uncertain: true }, "approve")).toEqual({
      tone: "crit",
      message: UNCERTAIN_SEND_MESSAGE,
    });
  });

  it("leaves definite notices alone", () => {
    expect(settleNotice({ tone: "crit", message: NOT_SENT_MESSAGE, uncertain: false }, "sent")).toEqual({
      tone: "crit",
      message: NOT_SENT_MESSAGE,
    });
  });
});

describe("draftBlock", () => {
  const fmt = (iso: string) => `at ${iso}`;
  const base = {
    tab: "approve" as const,
    status: "pending",
    from_email: "a@b.in",
    draft: { id: "d", body: "Draft body", revision: 2 },
    sent: null,
  };

  it("labels a sent thread with its sent_replies row", () => {
    expect(
      draftBlock({ ...base, tab: "sent", status: "sent", sent: { body: "Sent body", sent_at: "T", approved_by: "k@x.in" } }, fmt),
    ).toEqual({ kind: "sent", label: "Sent · k@x.in · at T", body: "Sent body" });
    expect(
      draftBlock({ ...base, tab: "sent", status: "sent", sent: { body: "Sent body", sent_at: "T", approved_by: null } }, fmt),
    ).toMatchObject({ label: "Sent · Slack · at T" });
  });

  it("says the copy wasn't recorded for a sent thread with no sent_replies row", () => {
    expect(draftBlock({ ...base, tab: "sent", status: "sent" }, fmt)).toEqual({
      kind: "sent",
      label: "Sent · copy not recorded",
      sublabel: "The draft that was current",
      body: "Draft body",
    });
  });

  it("shows the reviewing eyebrow on To approve", () => {
    expect(draftBlock(base, fmt)).toEqual({
      kind: "draft",
      label: "Draft · reply goes to a@b.in · grounded in Master KB",
      body: "Draft body",
    });
  });

  it("says not sent only for skipped, no-reply and failed", () => {
    expect(draftBlock({ ...base, tab: "skipped", status: "skipped" }, fmt)?.label).toBe("Draft · not sent");
    expect(draftBlock({ ...base, tab: "noreply" }, fmt)?.label).toBe("Draft · not sent");
    expect(draftBlock({ ...base, tab: null, status: "failed" }, fmt)?.label).toBe("Draft · not sent");
    expect(draftBlock({ ...base, tab: null, status: "sending" }, fmt)?.label).toBe("Draft · sending now");
  });

  it("returns null when there is nothing to show", () => {
    expect(draftBlock({ ...base, draft: null }, fmt)).toBeNull();
  });
});

describe("replyBlockedReason", () => {
  it("blocks a Shopify contact form and pulls the customer's address from the body", () => {
    const body = "You received a new message from your online store's contact form.\nName:\nKiran\nEmail:\nkiranvarma098@gmail.com\nBody:\nWhere is my order?";
    const out = replyBlockedReason("mailer@shopify.com", body);
    expect(out?.customerEmail).toBe("kiranvarma098@gmail.com");
    expect(out?.message).toBe(
      "Replies to this sender don't reach anyone. The customer wrote from kiranvarma098@gmail.com; reply to them directly from Gmail. Skip it once handled.",
    );
  });

  it("reads an Email: value on the same line too", () => {
    expect(replyBlockedReason("mailer@shopify.com", "Email: priya@example.com\nBody: hi")?.customerEmail).toBe("priya@example.com");
  });

  it("blocks a Shopify contact form with no Email: line", () => {
    expect(replyBlockedReason("Mailer@Shopify.com", "Name: someone\nBody: hi")).toEqual({
      customerEmail: null,
      message: "Replies to this sender don't reach anyone. Skip it once handled.",
    });
  });

  it("blocks no-reply style senders", () => {
    for (const from of [
      "noreply@mynusco.com",
      "no-reply@x.com",
      "donotreply@bank.in",
      "do-not-reply@y.com",
      "no_reply@x.com",
      "do_not_reply@y.com",
      "MAILER-DAEMON@googlemail.com",
      "postmaster@z.com",
      "notification@a.com",
      "notifications@github.com",
      "bounce+123@mail.b.com",
      "hello@noreply.brand.com",
    ]) {
      expect(replyBlockedReason(from, null), from).not.toBeNull();
    }
  });

  it("lets a normal address through", () => {
    expect(replyBlockedReason("ops@nashiktraders.in", "Email: other@x.com")).toBeNull();
    expect(replyBlockedReason("mailer@nashik.in", null)).toBeNull();
    expect(replyBlockedReason("noreen@gmail.com", null)).toBeNull();
  });
});
