import { describe, expect, it } from "vitest";
import { PROMUNCH_IG_HANDLE, cleanCopy, deliverablesLine, enforceBriefRules, validateBriefContent } from "./brief-content";
import { buildBriefUserPrompt, BRIEF_SYSTEM_PROMPT } from "./brief-prompt";
import type { BriefContent } from "./types";

const base = {
  concept: "A gym bag snack swap",
  hooks: ["Hook one", "Hook two", "Hook three"],
  script: "Line one\nLine two",
  talking_points: ["Crunchy"],
  must_say: ["PROMUNCH"],
  checklist: ["Good light"],
  donts: ["No competitor brands"],
  format: { length_sec: 30, aspect: "9:16", stories: 0 },
  dates: { draft_due: null, go_live: null },
  usage_rights_text: null,
};

describe("cleanCopy", () => {
  it("removes em and en dashes and capitalises PROMUNCH", () => {
    expect(cleanCopy("Try promunch — it's great")).toBe("Try PROMUNCH, it's great");
    expect(cleanCopy("Promunch–style")).toBe("PROMUNCH, style");
  });
  it("leaves handles and domains alone", () => {
    expect(cleanCopy("Tag @promunch.snacks and visit promunch.in")).toBe("Tag @promunch.snacks and visit promunch.in");
  });
});

describe("validateBriefContent", () => {
  it("accepts a well-formed brief and cleans copy", () => {
    const r = validateBriefContent({ ...base, concept: "promunch — fun" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.concept).toBe("PROMUNCH, fun");
  });
  it("rejects bad shapes", () => {
    expect(validateBriefContent(null).ok).toBe(false);
    expect(validateBriefContent([]).ok).toBe(false);
    expect(validateBriefContent({ ...base, hooks: [] }).ok).toBe(false);
    expect(validateBriefContent({ ...base, hooks: "x" }).ok).toBe(false);
    expect(validateBriefContent({ ...base, concept: "" }).ok).toBe(false);
    expect(validateBriefContent({ ...base, checklist: [1] }).ok).toBe(false);
    expect(validateBriefContent({ ...base, format: { length_sec: -1 } }).ok).toBe(false);
    expect(validateBriefContent({ ...base, script: "x".repeat(5000) }).ok).toBe(false);
  });
  it("defaults optional lists", () => {
    const r = validateBriefContent({ ...base, talking_points: undefined, must_say: undefined, donts: undefined });
    expect(r.ok).toBe(true);
  });
});

describe("enforceBriefRules", () => {
  const facts = {
    deliverables: { reels: 1, stories: 2, posts: 0 },
    discount_code: "RIYA10",
    usage_rights: "none" as const,
    usage_rights_days: null,
    draft_due: "18 Oct 2026",
    go_live: null,
  };
  it("adds tag, collab invite, code, deliverables and no-medical-claims", () => {
    const out = enforceBriefRules(base as BriefContent, facts);
    const list = out.checklist.join("\n");
    expect(list).toContain(PROMUNCH_IG_HANDLE);
    expect(list).toMatch(/collab/i);
    expect(list).toContain("RIYA10");
    expect(list).toContain("1 Reel + 2 Stories");
    expect(out.donts.join("\n")).toMatch(/medical/i);
    expect(out.dates.draft_due).toBe("18 Oct 2026");
    expect(out.usage_rights_text).toBeNull();
  });
  it("does not duplicate items already present", () => {
    const pre = {
      ...base,
      checklist: [`Tag ${PROMUNCH_IG_HANDLE}`, "Send a Collab invite", "Use code RIYA10", "Deliverables: 1 Reel + 2 Stories"],
      donts: ["No medical claims"],
    } as BriefContent;
    const out = enforceBriefRules(pre, facts);
    expect(out.checklist).toHaveLength(4);
    expect(out.donts).toHaveLength(1);
  });
  it("writes usage rights only when granted", () => {
    const out = enforceBriefRules({ ...base, usage_rights_text: "model text" } as BriefContent, facts);
    expect(out.usage_rights_text).toBeNull();
    const granted = enforceBriefRules(base as BriefContent, { ...facts, usage_rights: "partnership_ads", usage_rights_days: 30 });
    expect(granted.usage_rights_text).toMatch(/30 days/);
  });
});

describe("deliverablesLine", () => {
  it("formats counts", () => {
    expect(deliverablesLine({ reels: 1, stories: 0, posts: 0 })).toBe("1 Reel");
    expect(deliverablesLine({ reels: 2, stories: 1, posts: 1 })).toBe("2 Reels + 1 Story + 1 feed post");
    expect(deliverablesLine({ reels: 0, stories: 0, posts: 0 })).toBe("1 Reel");
  });
});

describe("brief prompt", () => {
  it("carries the brand rules and facts", () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/FRIED/);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/em dashes/);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/medical/);
    const p = buildBriefUserPrompt(
      {
        handle: "riya.fit",
        creator_name: "Riya",
        niche: ["fitness"],
        tier: "micro",
        followers: 20000,
        creator_notes: null,
        deal_notes: null,
        kit_name: "Starter",
        kit_items: [{ title: "Crunchies Peri Peri", qty: 2 }],
        deliverables: { reels: 1, stories: 1, posts: 0 },
        usage_rights: "none",
        usage_rights_days: null,
        discount_code: "RIYA10",
        draft_due: "18 Oct 2026",
        go_live: null,
      },
      "KB TEXT",
    );
    expect(p).toContain("KB TEXT");
    expect(p).toContain("@riya.fit");
    expect(p).toContain("fitness");
    expect(p).toContain("RIYA10");
    expect(p).toContain(PROMUNCH_IG_HANDLE);
    expect(p).toContain("exactly 3");
    expect(p).not.toMatch(/[—–]/);
  });
});
