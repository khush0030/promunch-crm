import { describe, expect, it } from "vitest";
import { channelCounts, chipOf, csvCell, filterOrders, formatPhone, isCreatorSeed, matchesSearch, toCsv, viewTotals, type ViewOrder } from "./orders-view";

const o = (p: Partial<ViewOrder>): ViewOrder => ({
  order_number: "#342958", customer_name: "Shruti Taparia", phone: "919667730666", total: 550, created_at: "2026-10-08T10:00:00Z", channel: "web", ...p,
});

describe("formatPhone", () => {
  it("formats Indian numbers in any stored shape", () => {
    expect(formatPhone("919667730666")).toBe("+91 96677 30666");
    expect(formatPhone("+91 96677-30666")).toBe("+91 96677 30666");
    expect(formatPhone("9667730666")).toBe("+91 96677 30666");
    expect(formatPhone("09667730666")).toBe("+91 96677 30666");
  });
  it("leaves other countries as +digits and empty as empty", () => {
    expect(formatPhone("14155550123")).toBe("+14155550123");
    expect(formatPhone(null)).toBe("");
    expect(formatPhone("")).toBe("");
  });
});

describe("channels", () => {
  it("files creator seeds under HYPD and counts per chip", () => {
    expect(isCreatorSeed(o({ total: 0.01, channel: "hypd" }))).toBe(true);
    expect(isCreatorSeed(o({ is_creator: true }))).toBe(true);
    expect(isCreatorSeed(o({ total: 0 }))).toBe(false);
    expect(chipOf(o({ channel: "creator" }))).toBe("hypd");
    expect(chipOf(o({ channel: null }))).toBe("web");
    const rows = [o({}), o({ channel: "hypd" }), o({ channel: "amazon" }), o({ channel: "creator", total: 0.01 })];
    expect(channelCounts(rows)).toEqual({ all: 4, web: 1, hypd: 2, amazon: 1, other: 0 });
    expect(filterOrders(rows, "hypd", "")).toHaveLength(2);
  });

  it("leaves creator seeds out of the totals", () => {
    expect(viewTotals([o({ total: 550 }), o({ total: 199.5 }), o({ total: 0.01, channel: "hypd" })])).toEqual({ orders: 2, revenue: 749.5, seeds: 1 });
  });
});

describe("search", () => {
  it("matches order number, name and phone digits", () => {
    expect(matchesSearch(o({}), "")).toBe(true);
    expect(matchesSearch(o({}), "#3429")).toBe(true);
    expect(matchesSearch(o({}), "shruti")).toBe(true);
    expect(matchesSearch(o({}), "96677 30")).toBe(true);
    expect(matchesSearch(o({}), "+91 96677")).toBe(true);
    expect(matchesSearch(o({}), "deepika")).toBe(false);
    expect(matchesSearch(o({ order_number: "#1" }), "12")).toBe(false);
  });
});

describe("csv", () => {
  it("quotes and neutralises formulas", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+91 96677 30666")).toBe("'+91 96677 30666");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["A", "B"], [[1, "x"]])).toBe("A,B\r\n1,x");
  });
});
