import { describe, it, expect } from "vitest";
import {
  AUDIENCE_PRESETS, DEFAULT_AUDIENCE_PRESET, POPUP_CONSENT_TEXT, TIER_TAGS,
  audienceWarning, coldCount, presetTags, tierFromTag, tierOf,
} from "./wa-engagement";

describe("tier tags", () => {
  it("round-trips a tier tag", () => {
    expect(tierFromTag("tier:engaged")).toBe("engaged");
    expect(tierFromTag("tier:suppressed")).toBe("suppressed");
    expect(tierFromTag("rfm:vip")).toBeNull();
    expect(tierFromTag("tier:nonsense")).toBeNull();
  });

  it("finds the tier on a contact's tag array and ignores other namespaces", () => {
    expect(tierOf(["buyer", "rfm:vip", "tier:reachable"])).toBe("reachable");
    expect(tierOf(["buyer", "rfm:vip"])).toBeNull();
    expect(tierOf(null)).toBeNull();
    expect(tierOf([])).toBeNull();
  });
});

describe("audience presets", () => {
  it("defaults new campaigns to engaged only", () => {
    expect(DEFAULT_AUDIENCE_PRESET).toBe("engaged");
    const first = AUDIENCE_PRESETS[0];
    expect(presetTags(first)).toEqual([TIER_TAGS.engaged]);
  });

  it("never targets suppressed contacts through a preset", () => {
    for (const p of AUDIENCE_PRESETS) {
      expect(presetTags(p)).not.toContain(TIER_TAGS.suppressed);
    }
  });

  it("resolves everyone to no tag filter at all", () => {
    const everyone = AUDIENCE_PRESETS.find((p) => p.key === "everyone")!;
    expect(presetTags(everyone)).toEqual([]);
  });

  it("builds a union ladder for the warm preset", () => {
    const warm = AUDIENCE_PRESETS.find((p) => p.key === "warm")!;
    expect(presetTags(warm)).toEqual([TIER_TAGS.engaged, TIER_TAGS.reachable, TIER_TAGS.subscribed]);
  });
});

describe("coldCount", () => {
  it("counts imported and suppressed as cold, since both still receive an unfiltered blast", () => {
    expect(coldCount({ engaged: 73, reachable: 6, imported: 998, suppressed: 336 })).toBe(1334);
    expect(coldCount({ engaged: 73 })).toBe(0);
  });
});

describe("audienceWarning", () => {
  it("stays quiet on a clean audience", () => {
    expect(audienceWarning(73, { engaged: 73 }, 0.9)).toBeNull();
    expect(audienceWarning(0, {}, 0.9)).toBeNull();
  });

  it("names the real counts and the measured block rate", () => {
    const w = audienceWarning(1410, { engaged: 73, reachable: 6, imported: 998, suppressed: 333 }, 0.9);
    expect(w).not.toBeNull();
    expect(w!.severity).toBe("danger");
    expect(w!.text).toContain("1,331 of these 1,410 contacts have never messaged us.");
    expect(w!.text).toContain("Meta blocked 9 in 10 marketing messages");
    expect(w!.text).toContain("333 are suppressed");
  });

  it("says nothing about Meta when there is no recent send to measure", () => {
    const w = audienceWarning(100, { engaged: 60, imported: 40 }, null);
    expect(w!.text).toContain("40 of these 100 contacts have never messaged us.");
    expect(w!.text).not.toContain("Meta blocked");
    expect(w!.severity).toBe("warn");
  });

  it("escalates to danger once at least half the audience is cold", () => {
    expect(audienceWarning(100, { engaged: 51, imported: 49 }, 0.9)!.severity).toBe("warn");
    expect(audienceWarning(100, { engaged: 50, imported: 50 }, 0.9)!.severity).toBe("danger");
  });
});

describe("consent wording", () => {
  it("is the exact sentence the storefront popup shows, in brand voice", () => {
    expect(POPUP_CONSENT_TEXT).toContain("PROMUNCH");
    expect(POPUP_CONSENT_TEXT).toContain("STOP");
    // Em dashes are banned in customer-facing copy.
    expect(POPUP_CONSENT_TEXT).not.toContain("—");
    expect(POPUP_CONSENT_TEXT.toLowerCase()).not.toContain("oltaflock");
  });
});
