import { describe, expect, it } from "vitest";
import { blankDesign, contentHash, makeBlock, normalizeBrand, parseDesign, type EmailDesign, type ProductInfo } from "./design";
import { applyMerge, inlineText, renderDesign, safeUrl, tagUrl } from "./render";
import { checkEmail, hasBlockers } from "./checks";
import { inBaseAudience, matchesAudience, parseRules, rulesFromLegacy, describeRules, type AudienceContact } from "./segments";
import { SYSTEM_TEMPLATES } from "./templates";

const brand = normalizeBrand({ footerAddress: "PROMUNCH, Indore, India" });
const product: ProductInfo = {
  id: "p1",
  title: "Diwali Snack Box",
  price: 555,
  compareAt: 650,
  image: "https://cdn.shopify.com/x.jpg",
  url: "https://promunch.in/products/diwali",
  inStock: true,
};
const ctx = { brand, products: { p1: product }, unsubscribeUrl: "https://admin.promunch.in/u/tok" };

describe("render", () => {
  it("always includes the unsubscribe link and postal address", () => {
    const html = renderDesign({ version: 1, theme: blankDesign().theme, blocks: [] }, ctx);
    expect(html).toContain("https://admin.promunch.in/u/tok");
    expect(html).toContain("PROMUNCH, Indore, India");
  });

  it("escapes text blocks so they cannot inject HTML", () => {
    const d: EmailDesign = { ...blankDesign(), blocks: [{ ...makeBlock("text"), text: "<script>x</script> **hi**" } as never] };
    const html = renderDesign(d, ctx);
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>hi</strong>");
  });

  it("renders products with price, strike-through compare-at, and skips sold-out ones", () => {
    const d: EmailDesign = {
      ...blankDesign(),
      blocks: [{ ...makeBlock("products"), items: ["p1", "gone", "p2"] } as never],
    };
    const html = renderDesign(d, { ...ctx, products: { ...ctx.products, p2: { ...product, id: "p2", title: "Sold Out Box", inStock: false } } });
    expect(html).toContain("Diwali Snack Box");
    expect(html).toContain("₹555");
    expect(html).toContain("line-through");
    expect(html).not.toContain("Sold Out Box");
  });

  it("adds UTM tags to own-store links only", () => {
    const utm = { campaign: "diwali-abc123" };
    expect(tagUrl("https://promunch.in/collections/all", utm)).toContain("utm_campaign=diwali-abc123");
    expect(tagUrl("https://promunch.in/x?utm_source=wa", utm)).toContain("utm_source=wa");
    expect(tagUrl("https://instagram.com/promunch", utm)).toBe("https://instagram.com/promunch");
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(inlineText("[go](javascript:alert(1))", "#000")).toContain('href="#"');
  });

  it("fills merge tags with escaping and fallbacks", () => {
    expect(applyMerge("Hi {{first_name|there}}!", { first_name: "" })).toBe("Hi there!");
    expect(applyMerge("Hi {{ first_name | there }}!", { first_name: "Asha" })).toBe("Hi Asha!");
    expect(applyMerge("{{first_name}}", { first_name: "<b>" })).toBe("&lt;b&gt;");
  });
});

describe("design", () => {
  it("parseDesign drops unknown blocks and bad colours", () => {
    const d = parseDesign({ theme: { accent: "red;x" }, blocks: [{ type: "evil" }, { type: "divider", id: "a" }] });
    expect(d?.blocks).toHaveLength(1);
    expect(d?.theme.accent).toMatch(/^#/);
    expect(parseDesign(null)).toBeNull();
  });

  it("contentHash changes when content changes", () => {
    const d = blankDesign();
    expect(contentHash("a", "b", d)).toBe(contentHash("a", "b", d));
    expect(contentHash("a", "b", d)).not.toBe(contentHash("a!", "b", d));
  });
});

describe("checks", () => {
  const base = (): EmailDesign => ({ ...blankDesign(), blocks: [{ ...makeBlock("button") } as never] });

  it("blocks em dashes, lowercase brand and Oltaflock", () => {
    for (const subject of ["Big sale — today", "New from Promunch", "Oltaflock presents"]) {
      expect(hasBlockers(checkEmail({ subject, previewText: "x", design: base() }))).toBe(true);
    }
    expect(hasBlockers(checkEmail({ subject: "New from PROMUNCH", previewText: "Visit promunch.in", design: base() }))).toBe(false);
  });

  it("blocks broken links and empty product blocks", () => {
    const d: EmailDesign = { ...blankDesign(), blocks: [{ ...makeBlock("button"), href: "promunch" } as never, { ...makeBlock("products") } as never] };
    const issues = checkEmail({ subject: "Hi", previewText: "x", design: d });
    expect(issues.filter((i) => i.level === "block")).toHaveLength(2);
  });

  it("every built-in template is free of copy-rule violations", () => {
    for (const t of SYSTEM_TEMPLATES) {
      const d = t.build();
      const issues = checkEmail({ subject: t.subject || "Subject", previewText: t.previewText || "Preview", design: d });
      const copy = issues.filter((i) => i.level === "block" && !/image|choose|upload/i.test(i.message));
      expect(copy, t.key).toEqual([]);
    }
  });
});

describe("segments", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const c = (over: Partial<AudienceContact> = {}): AudienceContact => ({
    id: "c1",
    email: "a@b.in",
    first_name: "A",
    last_name: null,
    status: "active",
    accepts_marketing: true,
    email_consent: null,
    total_orders: 2,
    total_spent: 900,
    first_purchase_date: "2026-01-01T00:00:00Z",
    last_purchase_date: "2026-05-01T00:00:00Z",
    city: "Indore",
    state: "MP",
    tags: ["hypd"],
    ...over,
  });
  const ctx = { now, suppressed: new Set<string>() };

  it("base audience requires email, active, consent and not suppressed", () => {
    expect(inBaseAudience(c(), new Set())).toBe(true);
    expect(inBaseAudience(c({ email: null }), new Set())).toBe(false);
    expect(inBaseAudience(c({ accepts_marketing: false }), new Set())).toBe(false);
    expect(inBaseAudience(c({ accepts_marketing: null, email_consent: "subscribed" }), new Set())).toBe(true);
    expect(inBaseAudience(c({ status: "unsubscribed" }), new Set())).toBe(false);
    expect(inBaseAudience(c(), new Set(["a@b.in"]))).toBe(false);
  });

  it("matches order, recency, city and tag rules", () => {
    const lapsed = parseRules({ conditions: [{ field: "total_orders", op: "gte", value: 1 }, { field: "last_order_days", op: "before", value: 90 }] });
    expect(matchesAudience(c(), lapsed, ctx)).toBe(true);
    expect(matchesAudience(c({ last_purchase_date: "2026-09-20T00:00:00Z" }), lapsed, ctx)).toBe(false);
    expect(matchesAudience(c(), parseRules({ conditions: [{ field: "city", op: "is", value: "indore" }] }), ctx)).toBe(true);
    expect(matchesAudience(c(), parseRules({ conditions: [{ field: "tag", op: "not", value: "HYPD" }] }), ctx)).toBe(false);
  });

  it("engaged and bought rules use the lookups", () => {
    const engaged = parseRules({ conditions: [{ field: "engaged_days", op: "within", value: 30 }] });
    expect(matchesAudience(c(), engaged, { ...ctx, engaged: new Map([[30, new Set(["c1"])]]) })).toBe(true);
    expect(matchesAudience(c(), engaged, { ...ctx, engaged: new Map([[30, new Set<string>()]]) })).toBe(false);
    const bought = parseRules({ conditions: [{ field: "bought", op: "has", value: "Edamame" }] });
    expect(matchesAudience(c(), bought, { ...ctx, buyers: new Map([["edamame", new Set(["a@b.in"])]]) })).toBe(true);
  });

  it("parseRules drops junk; legacy filters convert", () => {
    expect(parseRules({ conditions: [{ field: "nope", op: "x", value: 1 }, { field: "total_orders", op: "gte", value: "3" }] }).conditions).toEqual([
      { field: "total_orders", op: "gte", value: 3 },
    ]);
    expect(rulesFromLegacy({ audience: "vip" }).conditions[0]).toEqual({ field: "total_orders", op: "gte", value: 3 });
    expect(describeRules({ conditions: [] })).toBe("Everyone subscribed");
  });
});

import { attributeOrder, type OrderForAttribution } from "./attribution";
import { mergeText } from "./render";

describe("attribution", () => {
  const order = (over: Partial<OrderForAttribution> = {}): OrderForAttribution => ({
    shopify_id: "o1",
    order_number: "1001",
    total_price: 555,
    created_at: "2026-10-10T10:00:00Z",
    email: null,
    phone: "+91 98765 43210",
    utm_sources: [null, null],
    utm_campaigns: [null, null],
    is_creator: false,
    cancelled: false,
    ...over,
  });
  const lookups = () => ({
    campaignByUtm: new Map([["diwali-abc123", "camp1"]]),
    contactByEmail: new Map([["a@b.in", "c1"]]),
    contactByPhone: new Map([["9876543210", "c1"]]),
    clicksByContact: new Map([
      ["c1", [
        { kind: "campaign" as const, id: "camp2", contact_id: "c1", clicked_at: "2026-10-08T10:00:00Z" },
        { kind: "flow" as const, id: "flow1", contact_id: "c1", clicked_at: "2026-10-09T10:00:00Z" },
      ]],
    ]),
  });

  it("UTM match wins", () => {
    const r = attributeOrder(order({ utm_sources: ["email", null], utm_campaigns: ["Diwali-ABC123", null] }), lookups());
    expect(r).toMatchObject({ campaign_id: "camp1", model: "utm", contact_id: "c1" });
  });

  it("falls back to the latest click within 5 days, matched by phone", () => {
    expect(attributeOrder(order(), lookups())).toMatchObject({ flow_id: "flow1", model: "click_5d" });
  });

  it("ignores clicks older than 5 days or after the order", () => {
    expect(attributeOrder(order({ created_at: "2026-10-20T10:00:00Z" }), lookups())).toBeNull();
    expect(attributeOrder(order({ created_at: "2026-10-08T09:00:00Z" }), lookups())).toBeNull();
  });

  it("never credits creator seeds or cancelled orders", () => {
    expect(attributeOrder(order({ total_price: 0.01 }), lookups())).toBeNull();
    expect(attributeOrder(order({ is_creator: true }), lookups())).toBeNull();
    expect(attributeOrder(order({ cancelled: true }), lookups())).toBeNull();
  });
});

describe("mergeText", () => {
  it("fills subject tags without HTML escaping", () => {
    expect(mergeText("{{first_name|You}} & friends", { first_name: "" })).toBe("You & friends");
    expect(mergeText("Hi {{first_name}}, sale", { first_name: null })).toBe("Hi , sale");
  });
});
