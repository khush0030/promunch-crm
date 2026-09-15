import { describe, it, expect } from "vitest";
import { parsePeriod, periodWindow, previousWindow, pctChange } from "./period";
import { channelOf, isRevenueOrder } from "./channel";
import { formatINR, formatLakh, formatAxisTicks } from "./money";

describe("parsePeriod", () => {
  it("defaults unknown/missing input to 30d", () => {
    expect(parsePeriod("x")).toBe("30d");
    expect(parsePeriod(null)).toBe("30d");
    expect(parsePeriod(undefined)).toBe("30d");
  });
  it("passes through recognised keys", () => {
    expect(parsePeriod("7d")).toBe("7d");
    expect(parsePeriod("30d")).toBe("30d");
    expect(parsePeriod("90d")).toBe("90d");
    expect(parsePeriod("12m")).toBe("12m");
  });
});

describe("periodWindow", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");
  it("7d is the last 7x24h ending now", () => {
    const w = periodWindow("7d", now);
    expect(w.to).toEqual(now);
    expect(w.from).toEqual(new Date("2026-09-08T12:00:00.000Z"));
  });
  it("30d is the last 30x24h ending now", () => {
    const w = periodWindow("30d", now);
    expect(w.to).toEqual(now);
    expect(w.from).toEqual(new Date("2026-08-16T12:00:00.000Z"));
  });
  it("90d is the last 90x24h ending now", () => {
    const w = periodWindow("90d", now);
    expect(w.to).toEqual(now);
    expect(w.from).toEqual(new Date("2026-06-17T12:00:00.000Z"));
  });
  it("12m is the last 365x24h ending now", () => {
    const w = periodWindow("12m", now);
    expect(w.to).toEqual(now);
    expect(w.from).toEqual(new Date("2025-09-15T12:00:00.000Z"));
  });
});

describe("previousWindow", () => {
  it("has the same length and ends exactly at the original from", () => {
    const w = { from: new Date("2026-09-08T12:00:00.000Z"), to: new Date("2026-09-15T12:00:00.000Z") };
    const prev = previousWindow(w);
    expect(prev.to).toEqual(w.from);
    expect(prev.to.getTime() - prev.from.getTime()).toBe(w.to.getTime() - w.from.getTime());
  });
});

describe("pctChange", () => {
  it("rounds to the nearest integer", () => {
    expect(pctChange(118, 100)).toBe(18);
  });
  it("returns null when previous is 0", () => {
    expect(pctChange(5, 0)).toBe(null);
  });
});

describe("channelOf", () => {
  it("classifies the D2C web store", () => {
    expect(channelOf({ source_name: "web" })).toBe("web");
    expect(channelOf({ source_name: "368925802497" })).toBe("web");
  });
  it("classifies HYPD by known marketplace id", () => {
    expect(channelOf({ source_name: "341128478721" })).toBe("hypd");
  });
  it("classifies HYPD by name match", () => {
    expect(channelOf({ source_name: "HYPD App" })).toBe("hypd");
  });
  it("creator rows are always creator, regardless of source", () => {
    expect(channelOf({ is_creator: true })).toBe("creator");
    expect(channelOf({ is_creator: true, source_name: "web" })).toBe("creator");
  });
  it("other numeric source_name ids are other marketplaces", () => {
    expect(channelOf({ source_name: "12345" })).toBe("other");
  });
  it("classifies amazon by name match", () => {
    expect(channelOf({ source_name: "Amazon.in" })).toBe("amazon");
  });
  it("empty/unset attribution with no source_name defaults to web", () => {
    expect(channelOf({})).toBe("web");
  });
  it("an unrecognised non-empty source_name or utm falls back to other", () => {
    expect(channelOf({ source_name: "some-app" })).toBe("other");
    expect(channelOf({ first_utm_source: "google" })).toBe("other");
  });
});

describe("isRevenueOrder", () => {
  it("excludes voided/refunded orders case-insensitively", () => {
    expect(isRevenueOrder({ financial_status: "refunded" })).toBe(false);
    expect(isRevenueOrder({ financial_status: "REFUNDED" })).toBe(false);
    expect(isRevenueOrder({ financial_status: "Voided" })).toBe(false);
  });
  it("excludes creator seed orders", () => {
    expect(isRevenueOrder({ is_creator: true })).toBe(false);
  });
  it("includes a normal paid order", () => {
    expect(isRevenueOrder({ financial_status: "paid" })).toBe(true);
  });
});

describe("formatLakh", () => {
  it("formats lakhs with one decimal, stripped when .0", () => {
    expect(formatLakh(940000)).toBe("₹9.4L");
  });
  it("formats thousands with a k suffix", () => {
    expect(formatLakh(86000)).toBe("₹86k");
  });
  it("formats sub-thousand as whole rupees", () => {
    expect(formatLakh(980)).toBe("₹980");
  });
});

describe("formatINR", () => {
  it("formats with Indian digit grouping", () => {
    expect(formatINR(142300)).toBe("₹1,42,300");
  });
});

describe("formatAxisTicks", () => {
  it("uses one lakh unit for every tick, with a decimal only when needed", () => {
    expect(formatAxisTicks([0, 80000, 160000, 240000, 320000])).toEqual(["₹0", "₹0.8L", "₹1.6L", "₹2.4L", "₹3.2L"]);
    expect(formatAxisTicks([0, 100000, 200000, 300000, 400000])).toEqual(["₹0", "₹1L", "₹2L", "₹3L", "₹4L"]);
    expect(formatAxisTicks([0, 50000, 100000, 150000, 200000])).toEqual(["₹0", "₹0.5L", "₹1L", "₹1.5L", "₹2L"]);
  });
  it("uses thousands when the largest tick is under a lakh", () => {
    expect(formatAxisTicks([0, 12000, 24000, 36000, 48000])).toEqual(["₹0", "₹12k", "₹24k", "₹36k", "₹48k"]);
    expect(formatAxisTicks([0, 500, 1000, 1500, 2000])).toEqual(["₹0", "₹0.5k", "₹1k", "₹1.5k", "₹2k"]);
  });
  it("uses whole rupees below a thousand", () => {
    expect(formatAxisTicks([0, 25, 50, 75, 100])).toEqual(["₹0", "₹25", "₹50", "₹75", "₹100"]);
  });
  it("picks the unit from the largest absolute tick", () => {
    expect(formatAxisTicks([-200000, 0, 200000])).toEqual(["-₹2L", "₹0", "₹2L"]);
  });
  it("handles an empty list", () => {
    expect(formatAxisTicks([])).toEqual([]);
  });
});
