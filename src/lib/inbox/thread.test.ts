import { describe, expect, it } from "vitest";
import {
  statusWord,
  firstNameOf,
  maskPhone,
  timeIST,
  dayKeyIST,
  dayLabelIST,
  usedMasterKb,
  failedReason,
  waBubbles,
  igBubbles,
  latestInboundAt,
  waitingCodOrder,
  orderLabel,
  igReplyErrorCopy,
  waStatusPill,
  parseConversationId,
  NotFoundError,
  isNotFound,
  type WaMessageRow,
  type IgMessageRow,
} from "./thread";

// 2026-09-17 10:00 IST = 04:30Z
const NOW = Date.parse("2026-09-17T04:30:00Z");

function wa(over: Partial<WaMessageRow> & { created_at: string; direction: "inbound" | "outbound" }): WaMessageRow {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    type: "text",
    body: "hi",
    media_url: null,
    status: over.direction === "inbound" ? "received" : "sent",
    template_name: null,
    sent_by: null,
    ai_meta: null,
    ...over,
  };
}

describe("statusWord", () => {
  it("maps the ledger statuses to business words", () => {
    expect(statusWord("queued")).toBe("sending");
    expect(statusWord("received")).toBe("sending");
    expect(statusWord("sent")).toBe("sent");
    expect(statusWord("delivered")).toBe("delivered");
    expect(statusWord("read")).toBe("read");
    expect(statusWord("failed")).toBe("failed");
    expect(statusWord(null)).toBe("");
  });
});

describe("firstNameOf", () => {
  it("takes the first name from an email, Team otherwise", () => {
    expect(firstNameOf("khush@trypromunch.in")).toBe("Khush");
    expect(firstNameOf("parth.shah@trypromunch.in")).toBe("Parth");
    expect(firstNameOf("bot")).toBe("Team");
    expect(firstNameOf(null)).toBe("Team");
    expect(firstNameOf("")).toBe("Team");
  });
});

describe("maskPhone", () => {
  it("hides the last three digits of an Indian number", () => {
    expect(maskPhone("919823041234")).toBe("+91 98230 41xxx");
    expect(maskPhone("+91 98230 41234")).toBe("+91 98230 41xxx");
    expect(maskPhone("9823041234")).toBe("+91 98230 41xxx");
  });
  it("still masks other lengths and handles empty", () => {
    expect(maskPhone("447700900123")).toBe("+447700900xxx");
    expect(maskPhone(null)).toBe("");
  });
});

describe("IST time + day labels", () => {
  it("formats in IST regardless of process TZ", () => {
    expect(timeIST("2026-09-16T08:33:00Z")).toBe("14:03");
    expect(dayKeyIST("2026-09-16T20:30:00Z")).toBe("2026-09-17"); // 02:00 IST next day
  });
  it("says Today / Yesterday / weekday date", () => {
    expect(dayLabelIST("2026-09-17T01:00:00Z", NOW)).toBe("Today");
    expect(dayLabelIST("2026-09-16T01:00:00Z", NOW)).toBe("Yesterday");
    expect(dayLabelIST("2026-09-14T01:00:00Z", NOW)).toBe("Mon 14 Sep");
    expect(dayLabelIST("2025-12-25T01:00:00Z", NOW)).toBe("Thu 25 Dec 2025");
  });
});

describe("usedMasterKb", () => {
  it("is true only when chunks are recorded", () => {
    expect(usedMasterKb(null)).toBe(false);
    expect(usedMasterKb({ model: "gpt-4.1", usage: {} })).toBe(false);
    expect(usedMasterKb({ kb_chunks: [] })).toBe(false);
    expect(usedMasterKb({ kb_chunks: ["a"] })).toBe(true);
    expect(usedMasterKb({ chunks: 3 })).toBe(true);
  });
});

describe("failedReason", () => {
  it("translates Meta codes and falls back to the raw text", () => {
    expect(failedReason({ error: "(#131047) Re-engagement message" })).toMatch(/24-hour customer window/);
    expect(failedReason({ error: "weird" })).toBe("weird");
    expect(failedReason({ error: null, ai_meta: { error: "131026 undeliverable" } })).toMatch(/not be on WhatsApp/);
    expect(failedReason({})).toBe("Not delivered");
  });
});

describe("waBubbles", () => {
  it("maps directions, senders and day separators in IST order", () => {
    const items = waBubbles(
      [
        wa({ id: "3", direction: "outbound", created_at: "2026-09-17T02:00:00Z", sent_by: "khush@trypromunch.in", status: "delivered", body: "On it" }),
        wa({ id: "1", direction: "inbound", created_at: "2026-09-16T08:33:00Z", body: "Hello" }),
        wa({ id: "2", direction: "outbound", created_at: "2026-09-16T08:34:00Z", sent_by: "bot", status: "read", body: "Hi there", ai_meta: { kb_chunks: ["x"] } }),
        wa({ id: "4", direction: "outbound", created_at: "2026-09-17T02:05:00Z", template_name: "order_update", status: "sent", body: "Your order" }),
      ],
      null,
      NOW,
    );
    expect(items).toEqual([
      { kind: "day", label: "Yesterday" },
      { kind: "in", text: "Hello", meta: "14:03", mediaUrl: undefined },
      { kind: "bot", text: "Hi there", meta: "Bot · 14:04 · from Master KB · read", mediaUrl: undefined, failed: undefined },
      { kind: "day", label: "Today" },
      { kind: "human", text: "On it", meta: "Khush · 07:30 · delivered", mediaUrl: undefined, failed: undefined },
      { kind: "template", text: "Your order", meta: "Template order_update · 07:35", mediaUrl: undefined, failed: undefined },
    ]);
  });

  it("adds the handed-off line at ticket_opened_at and a failed reason", () => {
    const items = waBubbles(
      [
        wa({ id: "1", direction: "inbound", created_at: "2026-09-17T02:00:00Z", body: "confirm my order" }),
        wa({ id: "2", direction: "outbound", created_at: "2026-09-17T02:10:00Z", sent_by: "bot", status: "failed", error: "(#131049) healthy ecosystem", body: "x" }),
      ],
      { ticket_status: "open", ticket_opened_at: "2026-09-17T02:01:00Z", escalation_reason: "customer asked to confirm a COD order" },
      NOW,
    );
    expect(items[0]).toEqual({ kind: "day", label: "Today" });
    expect(items[1].kind).toBe("in");
    expect(items[2]).toEqual({ kind: "system", text: "Bot handed off: customer asked to confirm a COD order" });
    expect(items[3].kind).toBe("bot");
    expect((items[3] as { failed?: string }).failed).toMatch(/marketing limit/);
  });

  it("shows media as a bubble with a fallback word and no handed-off line without a ticket", () => {
    const items = waBubbles(
      [wa({ id: "1", direction: "inbound", created_at: "2026-09-17T02:00:00Z", body: null, type: "image", media_url: "https://x/y.jpg" })],
      { ticket_status: "none", ticket_opened_at: "2026-09-01T00:00:00Z", escalation_reason: "old" },
      NOW,
    );
    expect(items).toEqual([
      { kind: "day", label: "Today" },
      { kind: "in", text: "Photo", meta: "07:30", mediaUrl: "https://x/y.jpg" },
    ]);
  });
});

describe("igBubbles", () => {
  it("treats ai_generated or sent_by bot as the bot", () => {
    const rows: IgMessageRow[] = [
      { id: "1", direction: "inbound", text: "hey", media_url: null, status: "received", sent_by: null, ai_generated: false, created_at: "2026-09-17T02:00:00Z" },
      { id: "2", direction: "outbound", text: "hi!", media_url: null, status: "sent", sent_by: "human", ai_generated: true, created_at: "2026-09-17T02:01:00Z" },
      { id: "3", direction: "outbound", text: "sure", media_url: null, status: "failed", sent_by: "human", ai_generated: false, error: "window_closed", created_at: "2026-09-17T02:02:00Z" },
    ];
    const items = igBubbles(rows, NOW);
    expect(items).toEqual([
      { kind: "day", label: "Today" },
      { kind: "in", text: "hey", meta: "07:30", mediaUrl: undefined },
      { kind: "bot", text: "hi!", meta: "Bot · 07:31 · sent", mediaUrl: undefined, failed: undefined },
      { kind: "human", text: "sure", meta: "Team · 07:32 · failed", mediaUrl: undefined, failed: "window_closed" },
    ]);
  });
});

describe("latestInboundAt", () => {
  it("prefers the freshest inbound from either source", () => {
    expect(latestInboundAt("2026-09-16T00:00:00Z", [{ direction: "inbound", created_at: "2026-09-17T00:00:00Z" }])).toBe("2026-09-17T00:00:00Z");
    expect(latestInboundAt("2026-09-18T00:00:00Z", [{ direction: "inbound", created_at: "2026-09-17T00:00:00Z" }])).toBe("2026-09-18T00:00:00Z");
    expect(latestInboundAt(null, [{ direction: "outbound", created_at: "2026-09-17T00:00:00Z" }])).toBeNull();
  });
});

describe("waitingCodOrder", () => {
  const orders = [
    { shopify_id: "1", order_number: "2230", customer_phone: "+91 98230 41234", confirmation_status: "confirmed", shopify_created_at: "2026-09-10T00:00:00Z" },
    { shopify_id: "2", order_number: "2231", customer_phone: "9823041234", confirmation_status: "pending", shopify_created_at: "2026-09-12T00:00:00Z" },
    { shopify_id: "3", order_number: "2236", customer_phone: "919823041234", confirmation_status: "needs_call", shopify_created_at: "2026-09-15T00:00:00Z" },
    { shopify_id: "4", order_number: "2240", customer_phone: "919999999999", confirmation_status: "pending", shopify_created_at: "2026-09-16T00:00:00Z" },
  ];
  it("matches by last 10 digits and picks the latest waiting order", () => {
    expect(waitingCodOrder(orders, "919823041234")?.shopify_id).toBe("3");
    expect(waitingCodOrder(orders, "911111111111")).toBeNull();
    expect(waitingCodOrder(orders, null)).toBeNull();
    expect(waitingCodOrder([], "919823041234")).toBeNull();
  });
  it("formats the order label", () => {
    expect(orderLabel("2231")).toBe("#2231");
    expect(orderLabel("#2231")).toBe("#2231");
    expect(orderLabel(null)).toBe("");
  });
});

describe("igReplyErrorCopy", () => {
  it("uses the exact copy for the window errors", () => {
    expect(igReplyErrorCopy(403, "window_closed")).toBe("Instagram only allows replies within 24 hours of their last message.");
    expect(igReplyErrorCopy(403, "human_agent_required")).toBe("Outside the 24-hour window. Human agent replies are not enabled yet.");
    expect(igReplyErrorCopy(500, "boom")).toBe("Reply failed: boom");
    expect(igReplyErrorCopy(500, null)).toBe("Reply failed. Try again.");
  });
});

describe("waStatusPill", () => {
  it("one pill per status", () => {
    expect(waStatusPill("bot")).toEqual({ tone: "info", text: "Bot is replying" });
    expect(waStatusPill("human")).toEqual({ tone: "warn", text: "You are replying" });
    expect(waStatusPill("closed")).toEqual({ tone: "good", text: "Closed" });
  });
});

describe("parseConversationId", () => {
  it("splits the channel prefix from the id", () => {
    expect(parseConversationId("wa-abc-123")).toEqual({ channel: "wa", id: "abc-123" });
    expect(parseConversationId("ig-x")).toEqual({ channel: "ig", id: "x" });
    expect(parseConversationId("em-9")).toEqual({ channel: "em", id: "9" });
    expect(parseConversationId("sms-1")).toBeNull();
    expect(parseConversationId("wa-")).toBeNull();
    expect(parseConversationId(undefined)).toBeNull();
  });
});

describe("isNotFound", () => {
  it("is true only for a tagged 404", () => {
    expect(isNotFound(new NotFoundError())).toBe(true);
    expect(isNotFound(Object.assign(new Error("x"), { status: 404 }))).toBe(true);
    expect(isNotFound(Object.assign(new Error("x"), { status: 500 }))).toBe(false);
    expect(isNotFound(new TypeError("Failed to fetch"))).toBe(false);
    expect(isNotFound(null)).toBe(false);
    expect(isNotFound(undefined)).toBe(false);
  });
});
