import { describe, expect, it } from "vitest";
import { evaluateSendGuard, recipientUpperBound, validateEmailDraft, copyProblems, visibleText, type GuardInput } from "./brevo-send-guard";

const now = new Date("2026-09-17T06:00:00Z");
const ok: GuardInput = {
  channel: "email",
  action: "send_now",
  status: "draft",
  modifiedAt: "2026-09-17T11:00:00.000+05:30",
  testedVersions: ["2026-09-17T11:00:00.000+05:30"],
  listIds: [9],
  exclusionListIds: [],
  segmentIds: [],
  listSizes: new Map([[9, 1], [4, 582]]),
  syncTarget: "test",
  testListId: 9,
  confirmCount: 1,
  scheduledAt: null,
  now,
  smsEnabled: false,
  existingClaim: false,
};

describe("evaluateSendGuard", () => {
  it("passes a tested draft to the test list with a confirmed count", () => {
    expect(evaluateSendGuard(ok)).toEqual({ ok: true, recipientCount: 1 });
  });

  it("blocks a second send", () => {
    const r = evaluateSendGuard({ ...ok, existingClaim: true });
    expect(r.ok).toBe(false);
  });

  it("requires a test of the current version", () => {
    const r = evaluateSendGuard({ ...ok, modifiedAt: "2026-09-17T11:05:00.000+05:30" });
    expect(r.ok === false && r.errors.join(" ")).toContain("Send a test of the current version");
  });

  it("keeps test mode on the test list and off segments", () => {
    const r = evaluateSendGuard({ ...ok, listIds: [9, 4], confirmCount: 583 });
    expect(r.ok === false && r.errors.join(" ")).toContain("only go to the PROMUNCH TEST list");
    const s = evaluateSendGuard({ ...ok, segmentIds: [1] });
    expect(s.ok === false && s.errors.join(" ")).toContain("Segments can't be used");
    expect(evaluateSendGuard({ ...ok, testListId: null }).ok).toBe(false);
  });

  it("allows real lists in live mode", () => {
    expect(evaluateSendGuard({ ...ok, syncTarget: "live", listIds: [4], confirmCount: 582 })).toEqual({ ok: true, recipientCount: 582 });
  });

  it("requires the confirmed count to match", () => {
    expect(evaluateSendGuard({ ...ok, confirmCount: null }).ok).toBe(false);
    expect(evaluateSendGuard({ ...ok, syncTarget: "live", listIds: [4], confirmCount: 500 }).ok).toBe(false);
  });

  it("rejects sent campaigns, missing lists, off SMS and bad schedules", () => {
    expect(evaluateSendGuard({ ...ok, status: "sent" }).ok).toBe(false);
    expect(evaluateSendGuard({ ...ok, listIds: [], confirmCount: 0 }).ok).toBe(false);
    expect(evaluateSendGuard({ ...ok, channel: "sms" }).ok).toBe(false);
    expect(evaluateSendGuard({ ...ok, channel: "sms", smsEnabled: true }).ok).toBe(true);
    expect(evaluateSendGuard({ ...ok, action: "schedule", scheduledAt: "2026-09-17T06:02:00Z" }).ok).toBe(false);
    expect(evaluateSendGuard({ ...ok, action: "schedule", scheduledAt: "nope" }).ok).toBe(false);
    expect(evaluateSendGuard({ ...ok, action: "schedule", scheduledAt: "2026-09-18T06:00:00Z" }).ok).toBe(true);
    expect(evaluateSendGuard({ ...ok, status: "suspended" }).ok).toBe(true);
  });

  it("dedupes list ids when counting", () => {
    expect(recipientUpperBound([4, 4, 9, 77], ok.listSizes)).toBe(583);
  });
});

describe("copy rules", () => {
  it("flags em dashes, lowercase brand and Oltaflock", () => {
    expect(copyProblems("Snack smart — now")).toHaveLength(1);
    expect(copyProblems("Try Promunch today")).toHaveLength(1);
    expect(copyProblems("by Oltaflock")).toHaveLength(1);
    expect(copyProblems("PROMUNCH, Your Munchy Pal")).toEqual([]);
  });

  it("ignores links, addresses and handles when checking copy", () => {
    const html = '<p>Shop PROMUNCH</p><a href="https://promunch.in/x">promunch.in</a> hello@promunch.in @promunch.snacks <style>.promunch{}</style>';
    expect(copyProblems(visibleText(html))).toEqual([]);
  });
});

describe("validateEmailDraft", () => {
  const good = { name: "Diwali", subject: "PROMUNCH Diwali boxes", senderId: 2, htmlContent: "<p>Hi</p>", listIds: [9, 9] };
  it("accepts a full draft and dedupes lists", () => {
    const r = validateEmailDraft(good);
    expect(r.ok && r.draft.recipients).toEqual({ listIds: [9] });
  });
  it("requires content, sender and subject for create", () => {
    const r = validateEmailDraft({ name: "x" });
    expect(r.ok === false && r.errors).toEqual(expect.arrayContaining(["subject is required", "senderId is required", "add email content (HTML or a Brevo template)"]));
  });
  it("allows partial updates", () => {
    expect(validateEmailDraft({ subject: "New PROMUNCH subject" }, true)).toEqual({ ok: true, draft: { subject: "New PROMUNCH subject" } });
  });
  it("enforces brand copy and field formats", () => {
    const r = validateEmailDraft({ ...good, subject: "Promunch — sale", replyTo: "nope", utmCampaign: "bad utm", htmlContent: "<p>x</p>", templateId: 3 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.length).toBeGreaterThanOrEqual(4);
  });
});
