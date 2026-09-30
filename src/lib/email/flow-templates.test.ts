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

  it("cart, browse and welcome are 15% only; win-back is the only 20%", () => {
    for (const k of ["abandoned_cart", "browse_abandonment", "welcome"]) {
      for (const st of templateByKey(k)!.steps) {
        if (st.coupon) expect(st.coupon.percent_off, k).toBe(15);
        expect(`${st.subject} ${st.body_html}`, k).not.toContain("20%");
      }
    }
    expect(templateByKey("win_back")!.steps[0].coupon?.percent_off).toBe(20);
  });

  it("welcome countdown ends before the code does", () => {
    const steps = templateByKey("welcome")!.steps;
    const lastDay = steps.reduce((d, st) => d + st.delay_hours, 0) / 24;
    expect(lastDay).toBe(7);
    expect(steps[0].coupon!.expires_in_days).toBeGreaterThanOrEqual(lastDay + 2);
  });

  it("browse email 1 is a no-discount reminder; the 15% starts at email 2", () => {
    const [first, second] = templateByKey("browse_abandonment")!.steps;
    expect(first.coupon).toBeUndefined();
    expect(`${first.subject} ${first.preview_text} ${first.body_html}`).not.toMatch(/\b(5|10|15|20|25)% off|off \d+%|coupon_code/i);
    expect(second.coupon?.percent_off).toBe(15);
  });

  it("review and replenishment emails defer to WhatsApp", () => {
    for (const s of templateByKey("review_request")!.steps) expect(s.skip_if_wa_journey).toBe("review");
    for (const s of templateByKey("replenishment")!.steps) expect(s.skip_if_wa_journey).toBe("replenishment");
  });
});
