import { describe, expect, it } from "vitest";
import { canGrade, inHundred, isTestCampaign, lastCampaignSentence, periodSentences } from "./logic";

describe("test campaigns", () => {
  it("spots test sends", () => {
    expect(isTestCampaign({ name: "LIVE TEST Sep29 engine (Khush only)", sent: 0 })).toBe(true);
    expect(isTestCampaign({ name: "Diwali offer", sent: 1 })).toBe(true);
    expect(isTestCampaign({ name: "Diwali offer", sent: 800 })).toBe(false);
  });
  it("grades only real campaigns with 50+ sends", () => {
    expect(canGrade({ name: "Diwali", sent: 49 })).toBe(false);
    expect(canGrade({ name: "Diwali", sent: 50 })).toBe(true);
    expect(canGrade({ name: "live test", sent: 500 })).toBe(false);
  });
});

describe("inHundred", () => {
  it("rounds and clamps", () => {
    expect(inHundred(12, 278)).toBe(4);
    expect(inHundred(300, 278)).toBe(100);
    expect(inHundred(1, 0)).toBeNull();
  });
});

describe("sentences", () => {
  it("summarises a period without em dashes", () => {
    const out = periodSentences(30, { sent: 663, delivered: 637, read: 453, replies: 278, orders: 12, revenue: 13764, spend: 122 }, 217, 216);
    expect(out[0]).toContain("96 in 100");
    expect(out.join(" ")).toContain("₹13,764");
    expect(out.join(" ")).not.toContain("\u2014");
  });
  it("skips tests and says when it is too early", () => {
    const cards = [
      { name: "LIVE TEST x", sent: 0, readPct: 0, orders: 0, revenue: 0 },
      { name: "Edamame", sent: 20, readPct: 50, orders: 0, revenue: 0 },
    ];
    expect(lastCampaignSentence(cards)).toContain("too early");
    expect(lastCampaignSentence([cards[0]])).toBeNull();
  });
});
