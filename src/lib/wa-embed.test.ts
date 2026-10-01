import { describe, expect, it } from "vitest";
import { buildEmbedJs, normalizeGrowthConfig, popupSuccessInner, renderPopupInner } from "./wa-embed";
import { POPUP_CONSENT_TEXT, POPUP_EMAIL_CONSENT_TEXT } from "./wa-engagement";

const on = (popup: Record<string, unknown> = {}) => normalizeGrowthConfig({ popup: { enabled: true, ...popup }, widget: { enabled: false } });

describe("popup email + code", () => {
  it("defaults to an optional email field with the two-channel consent line", () => {
    const cfg = on();
    expect(cfg.popup.email).toBe("optional");
    const html = renderPopupInner(cfg.popup);
    expect(html).toContain('data-pmwa="email"');
    expect(html).toContain("Email (optional)");
    expect(html).toContain(POPUP_EMAIL_CONSENT_TEXT);
  });
  it("phone-only keeps the WhatsApp-only consent line", () => {
    const html = renderPopupInner(on({ email: "off" }).popup);
    expect(html).not.toContain('data-pmwa="email"');
    expect(html).toContain(POPUP_CONSENT_TEXT);
  });
  it("cleans the discount code and shows it after signup", () => {
    const cfg = on({ discountCode: " promunch10<script> " });
    expect(cfg.popup.discountCode).toBe("PROMUNCH10SCRIPT");
    expect(popupSuccessInner(cfg.popup, "919981310247")).toContain("PROMUNCH10SCRIPT");
    expect(popupSuccessInner(on().popup, "919981310247")).not.toContain('data-pmwa="copy"');
  });
  it("emits valid JavaScript that posts the email and the shown consent text", () => {
    const js = buildEmbedJs(on({ discountCode: "PROMUNCH10" }), { appOrigin: "https://admin.promunch.in", widgetLink: null, waNumber: "919981310247" });
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain("email:em||undefined");
    expect(js).toContain(JSON.stringify(POPUP_EMAIL_CONSENT_TEXT).slice(1, -1));
  });
});

describe("embed email check (runs in the shopper's browser)", () => {
  it("keeps its regex escapes, so ordinary emails pass and junk fails", () => {
    const js = buildEmbedJs(on(), { appOrigin: "https://admin.promunch.in", widgetLink: null, waNumber: "919981310247" });
    const src = js.match(/!(\/\^\[\^\\s@\]\+@.*?\$\/)\.test\(em\)/)?.[1];
    expect(src).toBeTruthy();
    const re = new Function(`return ${src}`)() as RegExp;
    for (const ok of ["sam@gmail.com", "kmutha@vippysoya.com", "a.b+s@site.co.in"]) expect(re.test(ok)).toBe(true);
    for (const bad of ["sam@gmail", "sam gmail.com", "@x.com", "a b@c.com"]) expect(re.test(bad)).toBe(false);
  });
});
