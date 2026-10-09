import { describe, expect, it } from "vitest";
import { parseVoicePeriod, summarizeVoice, type SummaryCall } from "./voice-summary";

const call = (p: Partial<SummaryCall>): SummaryCall => ({
  purpose: "cod_confirm", status: "connected", outcome: null, wa_id: "919800000001", created_at: "2026-10-08T10:00:00Z", ...p,
});

describe("parseVoicePeriod", () => {
  it("defaults to 7d", () => {
    expect(parseVoicePeriod(null)).toBe("7d");
    expect(parseVoicePeriod("junk")).toBe("7d");
    expect(parseVoicePeriod("24h")).toBe("24h");
    expect(parseVoicePeriod("30d")).toBe("30d");
  });
});

describe("summarizeVoice", () => {
  it("is all zeros with no calls", () => {
    expect(summarizeVoice([], []).successRate).toBe(0);
    expect(summarizeVoice([], []).calls).toBe(0);
  });

  it("counts call states and COD outcomes", () => {
    const s = summarizeVoice([
      call({ outcome: "confirmed" }),
      call({ outcome: "cancel_requested" }),
      call({ status: "no_answer" }),
      call({ status: "busy" }),
      call({ status: "start_failed" }),
      call({ status: "dialing" }),
    ], []);
    expect(s).toMatchObject({ calls: 6, reached: 2, confirmed: 1, cancelled: 1, noAnswer: 2, notStarted: 1, waiting: 1 });
    // 1 confirmed out of 5 calls that started.
    expect(s.successRate).toBe(20);
  });

  it("credits a cart call only for an order on that number within 72h after it", () => {
    const calls = [
      call({ purpose: "cart", wa_id: "91A", created_at: "2026-10-01T10:00:00Z" }),
      call({ purpose: "cart", wa_id: "91B", created_at: "2026-10-01T10:00:00Z" }),
      call({ purpose: "cart", wa_id: "91C", created_at: "2026-10-01T10:00:00Z" }),
    ];
    const s = summarizeVoice(calls, [
      { customer_phone: "91A", shopify_created_at: "2026-10-02T10:00:00Z", total_price: "749" },
      { customer_phone: "91B", shopify_created_at: "2026-09-30T10:00:00Z", total_price: 500 }, // before the call
      { customer_phone: "91C", shopify_created_at: "2026-10-05T10:00:00Z", total_price: 500 }, // after 72h
    ]);
    expect(s.cartOrdered).toBe(1);
    expect(s.cartOrderedValue).toBe(749);
    expect(s.successRate).toBe(33);
  });
});
