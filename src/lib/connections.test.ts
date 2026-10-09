import { describe, expect, it } from "vitest";
import {
  amazonConn, freshness, gmailConn, humanize, instagramConn, openaiConn, resendConn, shopifyConn, statusFromEvents,
  summarize, voiceConn, whatsappConn, type ConnEvent,
} from "./connections";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const hAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const e = (level: ConnEvent["level"], h: number, event = "x", message: string | null = null): ConnEvent => ({ level, event, message, created_at: hAgo(h) });

describe("statusFromEvents", () => {
  it("is unknown with no events and follows the newest event", () => {
    expect(statusFromEvents([], NOW)).toBe("unknown");
    expect(statusFromEvents([e("error", 1)], NOW)).toBe("down");
    expect(statusFromEvents([e("warn", 1)], NOW)).toBe("degraded");
  });
  it("treats a success after the last error as recovered", () => {
    expect(statusFromEvents([e("info", 1), e("error", 2)], NOW)).toBe("healthy");
  });
});

describe("freshness + humanize", () => {
  it("grades by age", () => {
    expect(freshness(null, 6, 48, NOW)).toBe("unknown");
    expect(freshness(hAgo(2), 6, 48, NOW)).toBe("healthy");
    expect(freshness(hAgo(20), 6, 48, NOW)).toBe("degraded");
    expect(freshness(hAgo(60), 6, 48, NOW)).toBe("down");
  });
  it("never shows object dumps or stack traces", () => {
    expect(humanize("[object Object]", "fb")).toBe("fb");
    expect(humanize("at foo (x.ts:1)", "fb")).toBe("fb");
    expect(humanize("Token expired", "fb")).toBe("Token expired");
  });
});

describe("per-service rules", () => {
  it("Shopify is healthy with a recent order, flags a quiet store, and surfaces errors", () => {
    expect(shopifyConn({ lastOrderAt: hAgo(1), events: [] }, NOW).status).toBe("healthy");
    expect(shopifyConn({ lastOrderAt: hAgo(72), events: [] }, NOW).status).toBe("degraded");
    expect(shopifyConn({ lastOrderAt: null, events: [] }, NOW).status).toBe("unknown");
    const down = shopifyConn({ lastOrderAt: hAgo(1), events: [e("error", 0.5, "x", "Webhook HMAC failed")] }, NOW);
    expect(down.status).toBe("down");
    expect(down.headline).toBe("Webhook HMAC failed");
  });

  it("WhatsApp reads quality and the send counts", () => {
    const c = whatsappConn({ events: [], lastInboundAt: hAgo(1), lastOutboundAt: hAgo(2), sent24h: 40, failed24h: 2, quality: "GREEN" }, NOW);
    expect(c.status).toBe("healthy");
    expect(c.headline).toBe("Quality high · 40 sent in 24h · 2 failed");
    expect(c.lastAt).toBe(hAgo(1));
    expect(whatsappConn({ events: [], lastInboundAt: hAgo(1), lastOutboundAt: null, sent24h: 2, failed24h: 30, quality: null }, NOW).status).toBe("degraded");
    expect(whatsappConn({ events: [], lastInboundAt: hAgo(1), lastOutboundAt: null, sent24h: 0, failed24h: 0, quality: "RED" }, NOW).status).toBe("degraded");
  });

  it("Amazon goes stale after 6 hours", () => {
    expect(amazonConn({ lastSyncAt: hAgo(1) }, NOW).status).toBe("healthy");
    expect(amazonConn({ lastSyncAt: hAgo(10) }, NOW).status).toBe("degraded");
  });

  it("Resend is not judged by quiet days, only failures", () => {
    expect(resendConn({ lastSentAt: hAgo(200), sent24h: 0, failed24h: 0 }).status).toBe("healthy");
    expect(resendConn({ lastSentAt: hAgo(1), sent24h: 1, failed24h: 3 }).status).toBe("degraded");
    expect(resendConn({ lastSentAt: null, sent24h: 0, failed24h: 0 }).status).toBe("unknown");
  });

  it("Gmail flags a missing or expired watch", () => {
    expect(gmailConn({ events: [e("info", 1)], watch: { expiration: hAgo(-24 * 5) }, lastReceivedAt: hAgo(1) }, NOW).status).toBe("healthy");
    expect(gmailConn({ events: [e("info", 1)], watch: { expiration: hAgo(1) }, lastReceivedAt: hAgo(1) }, NOW).status).toBe("down");
    expect(gmailConn({ events: [e("info", 1)], watch: null, lastReceivedAt: hAgo(1) }, NOW).status).toBe("degraded");
  });

  it("Voice is off when both call types are off, degraded when calls cannot start", () => {
    expect(voiceConn({ codOn: false, cartOn: false, lastCallAt: hAgo(1), calls24h: 0, notStarted24h: 0 }).status).toBe("off");
    const on = voiceConn({ codOn: true, cartOn: true, lastCallAt: hAgo(1), calls24h: 4, notStarted24h: 0 });
    expect(on.status).toBe("healthy");
    expect(on.headline).toBe("COD calls on · cart calls on · last call");
    expect(voiceConn({ codOn: true, cartOn: false, lastCallAt: hAgo(1), calls24h: 4, notStarted24h: 3 }).status).toBe("degraded");
  });

  it("Instagram respects the pause switch", () => {
    expect(instagramConn({ paused: true, events: [] }, NOW).status).toBe("off");
    expect(instagramConn({ paused: false, events: [e("info", 2)] }, NOW).status).toBe("healthy");
  });

  it("OpenAI flags credits and a draft backlog", () => {
    expect(openaiConn({ events: [e("error", 1, "credits_exhausted")], awaitingDraft: 0 }, NOW).status).toBe("down");
    expect(openaiConn({ events: [e("info", 1)], awaitingDraft: 2 }, NOW).status).toBe("degraded");
  });

  it("summary leaves switched-off services out of the total", () => {
    const s = summarize([
      amazonConn({ lastSyncAt: hAgo(1) }, NOW),
      amazonConn({ lastSyncAt: hAgo(20) }, NOW),
      instagramConn({ paused: true, events: [] }, NOW),
    ]);
    expect(s).toEqual({ total: 2, working: 1, needLook: 1, off: 1 });
  });
});
