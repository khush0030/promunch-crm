import { describe, expect, it } from "vitest";
import { button, couponBox, divider, h1, p, productGrid, reviewQuote, signature } from "./brand-blocks";
import { renderPlainMarketingEmail } from "./plain-layout";
import { EMAIL_BRAND, EMAIL_COLORS, EMAIL_FONT, EMAIL_HEADING_FONT } from "./brand-tokens";
import { DEFAULT_BRAND } from "../email-studio/design";
import { renderDesign } from "../email-studio/render";
import { DEFAULT_THEME } from "../email-studio/design";
import { SYSTEM_TEMPLATES } from "../email-studio/templates";

describe("brand blocks", () => {
  it("h1 escapes text and uses the storefront heading font + 28px", () => {
    const h = h1("Salt & <Pepper>");
    expect(h).toContain("Salt &amp; &lt;Pepper&gt;");
    expect(h).toContain("font-size:28px");
    expect(h).toContain(EMAIL_HEADING_FONT);
  });

  it("p keeps author HTML and styles bare links brand red + underlined", () => {
    const h = p('Hi <strong>Asha</strong>, <a href="https://promunch.in">shop</a>');
    expect(h).toContain("<strong>Asha</strong>");
    expect(h).toContain(`<a href="https://promunch.in" style="color:${EMAIL_COLORS.brand};text-decoration:underline;">`);
    expect(h).toContain("font-size:16px");
  });

  it("p leaves links that already carry a style alone", () => {
    const h = p('<a href="x" style="color:red">y</a>');
    expect(h).toContain('style="color:red"');
    expect(h.match(/style=/g)?.length).toBe(2);
  });

  it("button: solid is brand red with white text, outline is white with red text", () => {
    const s = button("Shop now", "https://promunch.in/?a=1&b=2");
    expect(s).toContain(`background:${EMAIL_COLORS.brand}`);
    expect(s).toContain("text-transform:uppercase");
    expect(s).toContain(`color:${EMAIL_COLORS.onBrand}`);
    expect(s).toContain('href="https://promunch.in/?a=1&amp;b=2"');
    const o = button("More", "{{checkout_url}}", "outline");
    expect(o).toContain(`background:${EMAIL_COLORS.card}`);
    expect(o).toContain(`border:2px solid ${EMAIL_COLORS.brand}`);
    expect(o).toContain('href="{{checkout_url}}"');
  });

  it("couponBox keeps merge-tag codes and optional note", () => {
    const c = couponBox("{{coupon_code}}", "10% off", "Valid 7 days");
    expect(c).toContain("{{coupon_code}}");
    expect(c).toContain("Valid 7 days");
    expect(couponBox("X", "Y")).not.toContain("undefined");
  });

  it("productGrid renders 1 to 3 fluid cards that stack without media queries", () => {
    expect(productGrid([])).toBe("");
    const g = productGrid([
      { title: "Crunchies", url: "https://promunch.in/a", image: "https://cdn/x.jpg", price: "₹199" },
      { title: "Edamame", url: "https://promunch.in/b" },
      { title: "Chips", url: "https://promunch.in/c" },
      { title: "Fourth", url: "https://promunch.in/d" },
    ]);
    expect(g).not.toContain("Fourth");
    expect((g.match(/display:inline-block;width:100%;max-width:/g) ?? []).length).toBe(3);
    expect(g).toContain("₹199");
    expect(g).toContain('src="https://cdn/x.jpg"');
  });

  it("reviewQuote clamps stars and escapes", () => {
    const r = reviewQuote("Best <snack>", "Asha, Pune", 9);
    expect(r).toContain("&lt;snack&gt;");
    expect((r.match(/&#9733;/g) ?? []).length).toBe(5);
    expect(reviewQuote("ok", "A")).not.toContain("&#9733;");
  });

  it("divider + signature", () => {
    expect(divider()).toContain(`border-top:1px solid ${EMAIL_COLORS.line}`);
    const s = signature("Parth", "Founder, PROMUNCH");
    expect(s).toContain("<strong>Parth</strong>");
    expect(s).toContain("Founder, PROMUNCH");
  });

  it("no block emits an em dash", () => {
    const all = [h1("a"), p("b"), button("c", "d"), couponBox("e", "f", "g"), productGrid([{ title: "h", url: "i" }]), reviewQuote("j", "k", 4), divider(), signature("l", "m")].join("");
    expect(all).not.toContain("—");
  });
});

describe("one brand style everywhere", () => {
  it("Studio default theme + brand kit come from the storefront tokens", () => {
    expect(DEFAULT_THEME.accent).toBe(EMAIL_COLORS.brand);
    expect(DEFAULT_BRAND.logoUrl).toBe(EMAIL_BRAND.logoUrl);
    expect(DEFAULT_THEME).toMatchObject({
      background: EMAIL_COLORS.page,
      content: EMAIL_COLORS.card,
      text: EMAIL_COLORS.ink,
      button: EMAIL_COLORS.brand,
      buttonText: EMAIL_COLORS.onBrand,
    });
  });

  it("every built-in Studio template uses the brand theme, has one solid CTA, and puts it above the products", () => {
    for (const t of SYSTEM_TEMPLATES) {
      const d = t.build();
      const expected = t.category === "diwali" ? { ...DEFAULT_THEME, background: EMAIL_COLORS.brandDeep } : DEFAULT_THEME;
      expect(d.theme, t.key).toEqual(expected);
      const types = d.blocks.map((x) => x.type);
      expect(types, t.key).not.toContain("social");
      const solid = d.blocks.filter((x) => x.type === "button" && x.variant === "solid");
      expect(solid.length, t.key).toBe(1);
      const firstProducts = types.indexOf("products");
      if (firstProducts >= 0) expect(types.indexOf("button"), t.key).toBeLessThan(firstProducts);
    }
  });

  it("plain founder email uses the same font, 16px body and ink colour", () => {
    const h = renderPlainMarketingEmail({ unsubscribeUrl: "https://u", bodyHtml: "<p>x</p>", footerAddress: "A" });
    expect(h).toContain(EMAIL_FONT);
    expect(h).toContain("font-size:16px");
    expect(h).toContain(`color:${EMAIL_COLORS.ink}`);
  });

  it("Studio render shows the storefront logo on a white backing, loads the site fonts, and keeps the footer", () => {
    const html = renderDesign(
      { version: 1, theme: DEFAULT_THEME, blocks: [{ id: "a", type: "logo", align: "center", showTagline: true }] },
      { brand: DEFAULT_BRAND, products: {}, unsubscribeUrl: "https://u/x" },
    );
    expect(html).toContain(EMAIL_BRAND.logoUrl.replace(/&/g, "&amp;"));
    expect(html).toContain('bgcolor="#FFFFFF"');
    expect(html).toContain("fonts.googleapis.com/css2?family=Archivo+Black");
    expect(html).toContain("Your Munchy Pal");
    expect(html).toContain('href="https://u/x"');
  });
});
