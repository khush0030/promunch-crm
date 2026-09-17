import { describe, expect, it } from "vitest";
import { parseBody, parseEvent, normalizeEvent, channelOf, verifyBearer } from "./brevo-webhook";

const marketingUnsub = {
  id: 123,
  camp_id: 6,
  email: "Someone@Gmail.com",
  "campaign name": "Rakhi Hamper",
  date_sent: "2026-08-20 10:52:59",
  date_event: "2026-08-21 09:00:00",
  event: "unsubscribe",
  tag: "",
  ts_sent: 1787215379,
  ts_event: 1787302800,
  ts: 1787306400,
};

const transactionalBounce = {
  event: "hard_bounce",
  email: "gone@example.com",
  id: 9,
  date: "2026-09-01 10:00:00",
  ts: 1788256800,
  "message-id": "<201798300811.5787683@relay.domain.com>",
  ts_event: 1788256800,
  subject: "Order",
  tag: "order",
  reason: "user unknown",
};

describe("normalizeEvent", () => {
  it("maps Brevo's inconsistent spellings", () => {
    expect(normalizeEvent("soft_bounced")).toBe("soft_bounce");
    expect(normalizeEvent("proxy _open")).toBe("proxy_open");
    expect(normalizeEvent("unsubscribed")).toBe("unsubscribe");
    expect(normalizeEvent("hardBounce")).toBe("hard_bounce");
    expect(normalizeEvent("click")).toBe("click");
  });
});

describe("channelOf", () => {
  it("detects marketing, transactional and sms", () => {
    expect(channelOf(marketingUnsub)).toBe("email_marketing");
    expect(channelOf(transactionalBounce)).toBe("email_transactional");
    expect(channelOf({ event: "delivered", to: "919000000000", sms_count: 1, messageId: 55 })).toBe("sms");
  });
});

describe("parseEvent", () => {
  it("parses a marketing unsubscribe into a suppression", () => {
    const e = parseEvent(marketingUnsub)!;
    expect(e).toMatchObject({
      channel: "email_marketing",
      event: "unsubscribe",
      email: "someone@gmail.com",
      campaignId: 6,
      suppress: "unsubscribe",
      occurredAt: new Date(1787302800 * 1000).toISOString(),
    });
  });

  it("parses a transactional hard bounce", () => {
    const e = parseEvent(transactionalBounce)!;
    expect(e).toMatchObject({ channel: "email_transactional", event: "hard_bounce", suppress: "bounce", reason: "user unknown", tag: "order" });
    expect(e.messageId).toContain("relay.domain.com");
  });

  it("maps spam to complaint and ignores engagement events", () => {
    expect(parseEvent({ ...marketingUnsub, event: "spam" })!.suppress).toBe("complaint");
    expect(parseEvent({ ...marketingUnsub, event: "opened" })!.suppress).toBeNull();
    expect(parseEvent({ ...marketingUnsub, event: "soft_bounced" })!.suppress).toBeNull();
  });

  it("never suppresses from SMS events", () => {
    const e = parseEvent({ event: "unsubscribe", to: "919000000000", sms_count: 1, messageId: 7, ts_event: 1788256800 })!;
    expect(e.channel).toBe("sms");
    expect(e.phone).toBe("919000000000");
    expect(e.suppress).toBeNull();
  });

  it("gives a redelivered event the same key and a different event a different key", () => {
    expect(parseEvent(marketingUnsub)!.eventKey).toBe(parseEvent({ ...marketingUnsub })!.eventKey);
    expect(parseEvent(marketingUnsub)!.eventKey).not.toBe(parseEvent({ ...marketingUnsub, event: "opened" })!.eventKey);
    const clickA = parseEvent({ ...marketingUnsub, event: "click", URL: "https://promunch.in/a" })!;
    const clickB = parseEvent({ ...marketingUnsub, event: "click", URL: "https://promunch.in/b" })!;
    expect(clickA.eventKey).not.toBe(clickB.eventKey);
  });

  it("falls back to date strings and ms epochs", () => {
    expect(parseEvent({ event: "delivered", email: "a@b.c", date: "2026-09-01 10:00:00" })!.occurredAt).toBe("2026-09-01T10:00:00.000Z");
    expect(parseEvent({ event: "delivered", email: "a@b.c", ts_epoch: 1788256800123 })!.occurredAt).toBe("2026-09-01T10:00:00.123Z");
  });

  it("returns null without an event name", () => {
    expect(parseEvent({ email: "a@b.c" })).toBeNull();
  });
});

describe("parseBody", () => {
  it("handles single and batched payloads, skipping junk", () => {
    expect(parseBody(marketingUnsub)).toHaveLength(1);
    expect(parseBody([marketingUnsub, transactionalBounce, null, "x", { nope: 1 }])).toHaveLength(2);
    expect(parseBody(null)).toHaveLength(0);
  });
});

describe("verifyBearer", () => {
  it("accepts only the exact token and fails closed", () => {
    expect(verifyBearer("Bearer s3cret", "s3cret")).toBe(true);
    expect(verifyBearer("bearer s3cret", "s3cret")).toBe(true);
    expect(verifyBearer("Bearer s3cre", "s3cret")).toBe(false);
    expect(verifyBearer("s3cret", "s3cret")).toBe(false);
    expect(verifyBearer(null, "s3cret")).toBe(false);
    expect(verifyBearer("Bearer x", null)).toBe(false);
  });
});
