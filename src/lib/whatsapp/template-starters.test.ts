import { describe, expect, it } from "vitest";
import { TEMPLATE_STARTERS, draftFromStarter } from "./template-starters";
import { hasEmoji, validateTemplate } from "./template-rules";
import { toRulesDraft } from "./template-draft";

const withFile = (key: string) => {
  const s = TEMPLATE_STARTERS.find((x) => x.key === key)!;
  const d = draftFromStarter(s, []);
  return { ...d, header_media_url: d.header_type ? "https://promunch.in/sample.jpg" : null };
};

describe("template starters", () => {
  it("has the six expected starters with unique keys", () => {
    const keys = TEMPLATE_STARTERS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining(["general_update", "product_launch", "festive_offer", "back_in_stock", "review_request", "win_back"]),
    );
  });

  for (const s of TEMPLATE_STARTERS) {
    describe(s.title, () => {
      it("passes validateTemplate with zero errors and zero warnings", () => {
        const r = validateTemplate(toRulesDraft(withFile(s.key)));
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
      });

      it("is marketing with no footer (STOP is added automatically)", () => {
        expect(s.category).toBe("marketing");
        expect(draftFromStarter(s, []).footer).toBe("");
      });

      it("has no em dash anywhere", () => {
        const all = JSON.stringify(s);
        expect(all).not.toMatch(/—/);
      });

      it("writes the brand as PROMUNCH in capitals", () => {
        const text = [s.title, s.when, s.sends, s.benefit, s.body, ...s.buttons.map((b) => b.text)].join(" ");
        for (const m of text.match(/promunch/gi) ?? []) expect(m).toBe("PROMUNCH");
      });

      it("has no emoji in buttons, header or footer", () => {
        for (const b of s.buttons) expect(hasEmoji(b.text)).toBe(false);
        expect(hasEmoji(s.body)).toBe(false);
      });

      it("makes no specific product claims in the fixed copy", () => {
        const fixed = [s.body, ...s.buttons.map((b) => b.text)].join(" ");
        expect(fixed).not.toMatch(/\d+\s?(g|gm|grams?)\b/i); // protein numbers
        expect(fixed).not.toMatch(/₹|\brs\.?\s?\d|\binr\b/i); // prices
        expect(fixed).not.toMatch(/\d+\s?%|\bflat\s+\d+/i); // discounts
        expect(fixed).not.toMatch(/protein/i);
      });

      it("uses {{1}} as the customer's first name with a sample", () => {
        expect(s.body).toContain("{{1}}");
        expect(s.blankLabels["1"]).toBe("First name");
        expect(s.bodySamples["1"]).toBeTruthy();
      });

      it("has a label and sample for every blank", () => {
        for (const m of s.body.match(/\{\{(\d+)\}\}/g) ?? []) {
          const n = m.slice(2, -2);
          expect(s.blankLabels[n]).toBeTruthy();
          expect(s.bodySamples[n]).toBeTruthy();
        }
      });

      it("links only to promunch.in over https", () => {
        for (const b of s.buttons) if (b.type === "URL") expect(b.url).toMatch(/^https:\/\/promunch\.in(\/|$)/);
      });
    });
  }

  it("bumps the name to _v2 when it is taken", () => {
    const s = TEMPLATE_STARTERS.find((x) => x.key === "product_launch")!;
    expect(draftFromStarter(s, []).name).toBe("new_product_launch");
    expect(draftFromStarter(s, ["new_product_launch"]).name).toBe("new_product_launch_v2");
  });

  it("returns an independent copy (editing the draft never mutates the starter)", () => {
    const s = TEMPLATE_STARTERS[0];
    const d = draftFromStarter(s, []);
    d.buttons[0].text = "Changed";
    d.bodySamples["1"] = "X";
    expect(s.buttons[0].text).not.toBe("Changed");
    expect(s.bodySamples["1"]).not.toBe("X");
  });
});
