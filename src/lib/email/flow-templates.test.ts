import { describe, expect, it } from "vitest";
import { FLOW_TEMPLATES, V1_FLOW_KEYS, templateByKey } from "./flow-templates";

// Copy guards for the gallery templates (AGENTS.md §5 + offer rules, 2026-09-30).
const text = (html: string) => html.replace(/<[^>]+>/g, " ");
const allCopy = (s: (typeof FLOW_TEMPLATES)[number]["steps"][number]) =>
  [s.subject, ...(s.subject_variants ?? []), s.preview_text ?? "", ...(s.preview_variants ?? []), text(s.body_html)].join(" ");

describe("flow templates", () => {
  it("ships every flow in the content pack", () => {
    for (const k of V1_FLOW_KEYS) expect(templateByKey(k), k).toBeTruthy();
  });

  for (const t of FLOW_TEMPLATES) {
    t.steps.forEach((s, i) => {
      const id = `${t.key} step ${i + 1}`;
      const copy = allCopy(s);
      it(`${id}: no em/en dashes, PROMUNCH in caps, no Oltaflock`, () => {
        expect(copy).not.toMatch(/[–—]/);
        expect(copy).not.toMatch(/oltaflock/i);
        expect(copy.replace(/promunch\.in|hello@promunch|@?promunch\.snacks|@PromunchYourMunchyPal/gi, "")).not.toMatch(/\b(Promunch|promunch)\b/);
      });
      it(`${id}: every percent in the copy matches the coupon`, () => {
        const pcts = [...copy.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
        for (const pct of pcts) expect(pct, id).toBe(s.coupon?.percent_off);
      });
      it(`${id}: coupon steps use unique codes with no static fallback`, () => {
        if (/\{\{\s*coupon_code\s*\}\}/.test(copy)) expect(s.coupon, id).toBeTruthy();
        if (s.coupon) {
          expect(s.coupon_code).toBe("");
          expect([15, 20]).toContain(s.coupon.percent_off);
        }
      });
      it(`${id}: founder notes are plain with a signature`, () => {
        if (s.format === "plain") expect(s.signature).toBeTruthy();
      });
    });
  }

  it("abandonment flows stay at 15% (never 20%); welcome escalates to 20%", () => {
    for (const k of ["abandoned_cart", "browse_abandonment"]) {
      for (const s of templateByKey(k)!.steps) {
        if (s.coupon) expect(s.coupon.percent_off, k).toBe(15);
        expect(`${s.subject} ${s.body_html}`, k).not.toContain("20%");
      }
    }
    const w = templateByKey("welcome")!.steps;
    expect(w[0].coupon?.percent_off).toBe(15);
    expect(w[w.length - 1].coupon?.percent_off).toBe(20);
  });

  it("review and replenishment emails defer to WhatsApp", () => {
    for (const s of templateByKey("review_request")!.steps) expect(s.skip_if_wa_journey).toBe("review");
    for (const s of templateByKey("replenishment")!.steps) expect(s.skip_if_wa_journey).toBe("replenishment");
  });
});
