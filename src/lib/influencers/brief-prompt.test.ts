import { describe, expect, it } from "vitest";
import { buildBriefKb, buildBriefUserPrompt, focusKeywords, type BriefPromptInput } from "./brief-prompt";

const KB = [
  "## About PROMUNCH\nWe make soya snacks and roasted edamame.",
  "### Soya Crunchies\nRoasted soya, up to 15.2 g protein per 30 g.",
  "### Roasted Edamame (new line)\nWhole edamame beans roasted in olive oil. 42.7 to 45.3 g protein per 100 g.",
  "### Chips\nChips are fried.",
].join("\n\n");

const INPUT: BriefPromptInput = {
  handle: "fitwithriya",
  creator_name: "Riya",
  niche: ["fitness"],
  tier: "micro",
  followers: 48000,
  creator_notes: null,
  deal_notes: null,
  kit_name: "Starter box",
  kit_items: [{ title: "Soya Crunchies", qty: 2 }],
  deliverables: { reels: 1, stories: 2, posts: 0 },
  usage_rights: "none",
  usage_rights_days: null,
  discount_code: "RIYA10",
  draft_due: "Fri, 9 Oct",
  go_live: null,
};

describe("focusKeywords", () => {
  it("keeps the product word, drops generic ones", () => {
    expect(focusKeywords("Roasted Edamame")).toEqual(["edamame"]);
    expect(focusKeywords("Soya Crunchies")).toEqual(["soya", "crunchies"]);
    expect(focusKeywords(null)).toEqual([]);
  });
});

describe("buildBriefKb", () => {
  it("puts every focus paragraph first under a facts heading", () => {
    const kb = buildBriefKb(KB, "Roasted Edamame");
    expect(kb.startsWith("### Roasted Edamame facts")).toBe(true);
    const facts = kb.slice(0, kb.indexOf("## Rest of the knowledge base"));
    expect(facts).toContain("olive oil");
    expect(facts).toContain("roasted edamame.");
    expect(facts).not.toContain("Soya Crunchies");
    expect(kb).toContain("Chips are fried.");
  });
  it("keeps facts even when the KB is longer than the budget", () => {
    const long = "### Filler\n" + "x".repeat(20000) + "\n\n### Roasted Edamame\nolive oil roasted";
    const kb = buildBriefKb(long, "Roasted Edamame");
    expect(kb.length).toBeLessThanOrEqual(12000);
    expect(kb).toContain("olive oil roasted");
  });
  it("without a focus it is the plain truncated KB", () => {
    expect(buildBriefKb(KB, null)).toBe(KB);
  });
});

describe("buildBriefUserPrompt focus", () => {
  it("tells the model the whole brief is about the hero product", () => {
    const p = buildBriefUserPrompt({ ...INPUT, focus: "Roasted Edamame", focus_notes: "office snacking" }, "kb");
    expect(p).toContain("HERO PRODUCT OF THIS CAMPAIGN: Roasted Edamame");
    expect(p).toContain("CAMPAIGN ANGLE: office snacking");
    expect(p).toContain("The WHOLE brief is about Roasted Edamame");
    expect(p).toContain("Do not feature or name any other PROMUNCH product");
  });
  it("adds nothing when no focus is set", () => {
    const p = buildBriefUserPrompt(INPUT, "kb");
    expect(p).not.toContain("HERO PRODUCT");
    expect(p).not.toContain("WHOLE brief");
  });
});
