import { describe, it, expect } from "vitest";
import { cleanQuestion, KB_CHAR_BUDGET, planKb, questionTerms, rankPassages, splitPassages } from "./ask";

const master = {
  id: "m",
  name: "PROMUNCH Master KB",
  raw_text:
    "Shipping\nFree shipping on orders of ₹599 and above. ₹99 below that.\n\nCOD costs ₹50 extra. Prepaid gets 5% off.\n\nProducts\nChips and sticks are fried. Only Crunchies are roasted.",
};
const catalog = { id: "c", name: "Live Product Catalog", raw_text: "Edamame Himalayan Rock Salt 100g pouch ₹249" };

describe("planKb", () => {
  it("orders master first and reads the whole KB under the budget", () => {
    const plan = planKb([catalog, { id: "x", name: "Empty", raw_text: "  " }, master]);
    expect(plan.mode).toBe("whole");
    expect(plan.docs.map((d) => d.id)).toEqual(["m", "c"]);
    expect(plan.budget).toBe(KB_CHAR_BUDGET);
  });
  it("switches to search when the KB outgrows the budget", () => {
    const big = { id: "b", name: "Big", raw_text: "x".repeat(KB_CHAR_BUDGET + 1) };
    expect(planKb([big]).mode).toBe("search");
  });
});

describe("questionTerms", () => {
  it("drops filler words and adds simple singulars", () => {
    expect(questionTerms("Hi, are your chips roasted or fried?")).toEqual(["chips", "chip", "roasted", "fried"]);
  });
});

describe("splitPassages", () => {
  it("splits on blank lines and cuts long paragraphs at line breaks", () => {
    expect(splitPassages("a\n\n\nb")).toEqual(["a", "b"]);
    const long = Array.from({ length: 10 }, (_, i) => `line ${i} ${"y".repeat(80)}`).join("\n");
    const parts = splitPassages(long, 300);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 300)).toBe(true);
  });
});

describe("rankPassages", () => {
  it("puts the passage that answers the question first", () => {
    const top = rankPassages("Are chips roasted or fried?", [master, catalog]);
    expect(top[0].docName).toBe("PROMUNCH Master KB");
    expect(top[0].text).toContain("Chips and sticks are fried");
    expect(top[0].matched).toEqual(expect.arrayContaining(["chips", "fried", "roasted"]));
  });
  it("returns nothing for a question with no real words", () => {
    expect(rankPassages("hi?", [master])).toEqual([]);
  });
});

describe("cleanQuestion", () => {
  it("trims, collapses spaces and caps length", () => {
    expect(cleanQuestion("  is   COD  free? ")).toBe("is COD free?");
    expect(cleanQuestion("   ")).toBeNull();
    expect(cleanQuestion("q".repeat(400))!.length).toBe(300);
  });
});
