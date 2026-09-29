// Pure helpers behind the email flow engine's send guards and renderers.
import { describe, expect, it, beforeAll } from "vitest";
import {
  bypassesFreqCap,
  computeSendDeferral,
  freqCapClearsAt,
  istHour,
  jitterMinutes,
  lastOtherMarketingAt,
  parseCapHours,
  pickVariantIndex,
  quietHoursDeferral,
  stepVariants,
  summarizeVariants,
  variantFor,
  withFromName,
} from "./send-guards";
import { renderPlainMarketingEmail } from "./plain-layout";
import { cartItemsHtml, itemImage, needsImageLookup } from "./cart-items";
import { personalize, personalizeSubject, PRODUCT_URL_FALLBACK } from "./personalize";
import { isStorefrontUrl, tokenizeStorefrontLinks } from "./link-tokens";

const H = 3_600_000;
// 2026-09-30 12:00 IST = 06:30 UTC
const noonIst = new Date("2026-09-30T06:30:00Z");

describe("quiet hours (09:00-21:00 IST)", () => {
  it("inside the window sends now", () => {
    expect(quietHoursDeferral(noonIst)).toBeNull();
    expect(quietHoursDeferral(new Date("2026-09-30T03:30:00Z"))).toBeNull(); // 09:00 IST exactly
    expect(quietHoursDeferral(new Date("2026-09-30T15:29:00Z"))).toBeNull(); // 20:59 IST
  });

  it("21:00 IST and later defers to tomorrow 09:00 IST", () => {
    const at = new Date("2026-09-30T15:30:00Z"); // 21:00 IST
    expect(quietHoursDeferral(at)!.toISOString()).toBe("2026-10-01T03:30:00.000Z");
    const late = new Date("2026-09-30T18:00:00Z"); // 23:30 IST
    expect(quietHoursDeferral(late)!.toISOString()).toBe("2026-10-01T03:30:00.000Z");
  });

  it("early morning defers to the same IST day 09:00", () => {
    // 02:00 IST on Oct 1 = 20:30 UTC Sep 30 (the UTC date is still yesterday)
    const at = new Date("2026-09-30T20:30:00Z");
    expect(istHour(at)).toBe(2);
    expect(quietHoursDeferral(at)!.toISOString()).toBe("2026-10-01T03:30:00.000Z");
  });

  it("adds jitter minutes and handles month/year rollover", () => {
    const at = new Date("2026-12-31T17:00:00Z"); // 22:30 IST Dec 31
    expect(quietHoursDeferral(at, { jitterMin: 7 })!.toISOString()).toBe("2027-01-01T03:37:00.000Z");
  });

  it("jitter is deterministic and bounded", () => {
    const j = jitterMinutes("enr-1:0");
    expect(j).toBe(jitterMinutes("enr-1:0"));
    expect(j).toBeGreaterThanOrEqual(0);
    expect(j).toBeLessThan(20);
    expect(jitterMinutes("x", 0)).toBe(0);
  });
});

describe("frequency cap", () => {
  it("cap window calc", () => {
    const now = noonIst;
    expect(freqCapClearsAt(null, 16, now)).toBeNull();
    expect(freqCapClearsAt(now.getTime() - 20 * H, 16, now)).toBeNull();
    expect(freqCapClearsAt(now.getTime() - 2 * H, 16, now)!.getTime()).toBe(now.getTime() + 14 * H);
    expect(freqCapClearsAt(now.getTime() - 2 * H, 0, now)).toBeNull(); // disabled
  });

  it("parses cap hours defensively", () => {
    expect(parseCapHours(undefined)).toBe(16);
    expect(parseCapHours("")).toBe(16);
    expect(parseCapHours("abc")).toBe(16);
    expect(parseCapHours("-3")).toBe(16);
    expect(parseCapHours("0")).toBe(0);
    expect(parseCapHours(24)).toBe(24);
    expect(parseCapHours(9999)).toBe(336);
    expect(parseCapHours(null, 12)).toBe(12);
  });

  it("ignores the enrolment's own earlier steps and the campaign's own sends", () => {
    const sends = [
      { contact_id: "c", at: 100, enrollment_id: "self" },
      { contact_id: "c", at: 50, enrollment_id: "other" },
      { contact_id: "c", at: 80, campaign_id: "camp" },
    ];
    expect(lastOtherMarketingAt(sends, { enrollmentId: "self" })).toBe(80);
    expect(lastOtherMarketingAt(sends, { campaignId: "camp" })).toBe(100);
    expect(lastOtherMarketingAt(undefined)).toBeNull();
  });

  it("only the first abandoned-cart email bypasses by default; step flag wins", () => {
    expect(bypassesFreqCap({}, "checkout_abandoned", 0)).toBe(true);
    expect(bypassesFreqCap({}, "checkout_abandoned", 1)).toBe(false);
    expect(bypassesFreqCap({}, "customer_created", 0)).toBe(false);
    expect(bypassesFreqCap({ bypass_freq_cap: false }, "checkout_abandoned", 0)).toBe(false);
    expect(bypassesFreqCap({ bypass_freq_cap: true }, "order_placed", 2)).toBe(true);
  });
});

describe("computeSendDeferral", () => {
  const base = { capHours: 16, bypassCap: false, jitterKey: "k" };

  it("sends now in-window with no recent email", () => {
    expect(computeSendDeferral({ ...base, now: noonIst, lastOtherMarketingAt: null })).toBeNull();
  });

  it("defers to cap clear when it lands in-window", () => {
    // last email 14h ago at noon IST → clears 14:00 IST
    const d = computeSendDeferral({ ...base, now: noonIst, lastOtherMarketingAt: noonIst.getTime() - 14 * H });
    expect(d!.reasons).toEqual(["freq_cap"]);
    expect(d!.until.getTime()).toBe(noonIst.getTime() + 2 * H);
  });

  it("cap clearing at night rolls to next 09:xx IST", () => {
    // last email 5h ago at noon → clears 04:00 IST next day → 09:00 + jitter
    const d = computeSendDeferral({ ...base, now: noonIst, lastOtherMarketingAt: noonIst.getTime() - 5 * H });
    expect(d!.reasons).toEqual(["freq_cap", "quiet_hours"]);
    const expected = Date.parse("2026-10-01T03:30:00Z") + jitterMinutes("k") * 60_000;
    expect(d!.until.getTime()).toBe(expected);
  });

  it("bypass skips the cap but not quiet hours", () => {
    expect(computeSendDeferral({ ...base, bypassCap: true, now: noonIst, lastOtherMarketingAt: noonIst.getTime() - H })).toBeNull();
    const night = new Date("2026-09-30T17:30:00Z"); // 23:00 IST
    const d = computeSendDeferral({ ...base, bypassCap: true, now: night, lastOtherMarketingAt: null });
    expect(d!.reasons).toEqual(["quiet_hours"]);
  });
});

describe("A/B variants", () => {
  const step = { subject: "Subject A", preview_text: "Pre A", subject_variants: ["Subject B"], preview_variants: [""] };

  it("builds variants with fallback to A's fields", () => {
    const vs = stepVariants(step);
    expect(vs).toEqual([
      { label: "A", subject: "Subject A", preview_text: "Pre A" },
      { label: "B", subject: "Subject B", preview_text: "Pre A" },
    ]);
    expect(stepVariants({ subject: "S", subject_variants: ["  "] })).toHaveLength(1);
    expect(stepVariants({ subject: "S", preview_variants: ["P2"] })[1]).toEqual({ label: "B", subject: "S", preview_text: "P2" });
  });

  it("picks deterministically and splits roughly evenly", () => {
    expect(pickVariantIndex("e1", 0, 1)).toBe(0);
    expect(pickVariantIndex("e1", 2, 2)).toBe(pickVariantIndex("e1", 2, 2));
    let b = 0;
    for (let i = 0; i < 2000; i++) b += pickVariantIndex(`enr-${i}`, 1, 2);
    expect(b).toBeGreaterThan(850);
    expect(b).toBeLessThan(1150);
    expect(variantFor({ subject: "only" }, "e", 0)).toEqual({ variant: { label: "A", subject: "only", preview_text: undefined }, tested: false });
    expect(variantFor(step, "e", 0).tested).toBe(true);
  });

  it("summarizes sends/opens/clicks by step+variant", () => {
    const stats = summarizeVariants([
      { step_index: 0, variant: "A", status: "sent", opened_at: "x", clicked_at: null },
      { step_index: 0, variant: "B", status: "sent", opened_at: "x", clicked_at: "x" },
      { step_index: 0, variant: "B", status: "sent", opened_at: null, clicked_at: null },
      { step_index: 0, variant: null, status: "sent", opened_at: null, clicked_at: null },
      { step_index: 0, variant: "B", status: "failed", opened_at: null, clicked_at: null },
    ]);
    expect(stats).toEqual([
      { step_index: 0, variant: "A", sends: 2, opens: 1, clicks: 0, open_rate: 0.5, click_rate: 0 },
      { step_index: 0, variant: "B", sends: 2, opens: 1, clicks: 1, open_rate: 0.5, click_rate: 0.5 },
    ]);
  });
});

describe("plain founder format", () => {
  const html = renderPlainMarketingEmail({
    unsubscribeUrl: "https://crm.example/api/public/unsubscribe?token=a&b",
    bodyHtml: "<p>Hi Asha, Parth here.</p>",
    previewText: "A quick note <3",
    signature: "Parth\nFounder, PROMUNCH",
    footerAddress: "PROMUNCH, Dewas",
  });

  it("has no branded banner, keeps compliance footer", () => {
    expect(html).not.toContain("Your Munchy Pal");
    expect(html).not.toMatch(/background:#1B2A20/);
    expect(html).toContain("<p>Hi Asha, Parth here.</p>");
    expect(html).toContain('href="https://crm.example/api/public/unsubscribe?token=a&amp;b"');
    expect(html).toContain("Unsubscribe");
    expect(html).toContain("PROMUNCH, Dewas");
    expect(html).toContain("Parth<br>Founder, PROMUNCH");
    expect(html).toContain("A quick note &lt;3");
    expect(html).not.toContain("—");
  });

  it("omits signature when not set", () => {
    const h = renderPlainMarketingEmail({ unsubscribeUrl: "https://u", bodyHtml: "<p>x</p>", footerAddress: "A" });
    expect(h).not.toContain("margin:18px 0 0 0");
  });

  it("from name keeps the verified address and blocks header injection", () => {
    expect(withFromName("PROMUNCH <hello@promunch.in>", "Parth from PROMUNCH")).toBe("Parth from PROMUNCH <hello@promunch.in>");
    expect(withFromName("PROMUNCH <hello@promunch.in>", "")).toBe("PROMUNCH <hello@promunch.in>");
    expect(withFromName("hello@promunch.in", "Evil\r\nBcc: x <y>")).toBe("EvilBcc: x y <hello@promunch.in>");
  });
});

describe("cart items with images", () => {
  it("uses the item's own image, else catalog by variant id, else by title", () => {
    const images = new Map([["111", "https://cdn/v.jpg"], ["cream & onion crunchies", "https://cdn/t.jpg"]]);
    expect(itemImage({ image_url: "https://cdn/own.jpg" }, images)).toBe("https://cdn/own.jpg");
    expect(itemImage({ variant_id: 111, title: "X" }, images)).toBe("https://cdn/v.jpg");
    expect(itemImage({ title: "Cream & Onion Crunchies" }, images)).toBe("https://cdn/t.jpg");
    expect(itemImage({ title: "Unknown", image_url: "javascript:alert(1)" }, images)).toBeNull();
  });

  it("renders a 64px thumbnail with alt text, and no image cell when missing", () => {
    const html = cartItemsHtml({ items: [{ title: "Peri <Peri>", quantity: 2, price: 100, image_url: "https://cdn/p.jpg" }] });
    expect(html).toContain('width="64" height="64" alt="Peri &lt;Peri&gt;"');
    expect(html).toContain("₹200");
    const noImg = cartItemsHtml({ items: [{ title: "Plain", quantity: 1, price: 50 }] });
    expect(noImg).not.toContain("<img");
    expect(cartItemsHtml({})).toBe("");
    expect(needsImageLookup({ items: [{ title: "a" }] })).toBe(true);
    expect(needsImageLookup({ items: [{ title: "a", image_url: "https://x" }] })).toBe(false);
  });
});

describe("personalize: product tokens (browse abandonment)", () => {
  const ctx = { product: { title: "Peri Peri Crunchies", url: "https://promunch.in/products/peri", image: "https://cdn/peri.jpg", price: 249 } };

  it("fills product tokens", () => {
    const out = personalize('<a href="{{product.url}}">{{product.title}}</a> <img src="{{product.image}}" alt=""> {{product.price}}', ctx, "Asha");
    expect(out).toBe('<a href="https://promunch.in/products/peri">Peri Peri Crunchies</a> <img src="https://cdn/peri.jpg" alt=""> ₹249');
    expect(personalizeSubject("{{first_name}}, still thinking about {{product.title}}?", ctx, "Asha")).toBe("Asha, still thinking about Peri Peri Crunchies?");
  });

  it("falls back safely when product fields are null", () => {
    const out = personalize('<a href="{{product.url}}">see</a><img src="{{product.image}}" width="200"> {{product.price}}|', { product: { title: null, url: null, image: null, price: null } }, null);
    expect(out).toBe(`<a href="${PRODUCT_URL_FALLBACK}">see</a> |`);
    expect(personalizeSubject("{{product.title}} for {{product.price}}", {}, null)).toBe("your pick for");
  });

  it("{{product_image}} renders a linked img tag, or nothing", () => {
    const out = personalize("a{{product_image}}b", ctx, null);
    expect(out).toContain('<a href="https://promunch.in/products/peri"');
    expect(out).toContain('<img src="https://cdn/peri.jpg" width="280" alt="Peri Peri Crunchies"');
    expect(personalize("a{{product_image}}b", { product: { title: "x", url: null, image: null, price: null } }, null)).toBe("ab");
    expect(personalize("a{{product_image}}b", {}, null)).toBe("ab");
    expect(PRODUCT_URL_FALLBACK).toBe("https://promunch.in/collections/best-sellers");
  });

  it("keeps existing cart tokens working", () => {
    const out = personalize("{{first_name}} {{cart_total}} {{coupon_code}} {{checkout_url}}", { total: 650, checkout_url: "https://promunch.in/cart" }, "R", 1, "SAVE10");
    expect(out).toContain("R ₹650 SAVE10 https://promunch.in/cart?utm_source=email");
    expect(out).toContain("utm_content=email_2");
  });
});

describe("storefront pm_c link tokens", () => {
  beforeAll(() => {
    process.env.UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || "test-secret";
  });

  it("only touches promunch.in links and never unsubscribe", () => {
    expect(isStorefrontUrl("https://promunch.in/x")).toBe(true);
    expect(isStorefrontUrl("https://www.promunch.in/x")).toBe(true);
    expect(isStorefrontUrl("https://evilpromunch.in/x")).toBe(false);
    expect(isStorefrontUrl("https://promunch-crm.vercel.app/api/public/unsubscribe")).toBe(false);
    const tok = (u: string) => `${u}${u.includes("?") ? "&" : "?"}pm_c=T`;
    const html = [
      '<a href="https://promunch.in/cart?utm_source=email&amp;utm_content=email_1">cart</a>',
      "<a href='https://www.promunch.in/'>home</a>",
      '<a href="https://promunch-crm.vercel.app/api/public/unsubscribe?token=abc">Unsubscribe</a>',
      '<a href="https://instagram.com/promunch">ig</a>',
    ].join("");
    const out = tokenizeStorefrontLinks(html, tok);
    expect(out).toContain('href="https://promunch.in/cart?utm_source=email&amp;utm_content=email_1&amp;pm_c=T"');
    expect(out).toContain("href='https://www.promunch.in/?pm_c=T'");
    expect(out).toContain('href="https://promunch-crm.vercel.app/api/public/unsubscribe?token=abc"');
    expect(out).toContain('href="https://instagram.com/promunch"');
  });

  it("works end to end with the real withContactToken, keeping UTMs", async () => {
    const { withContactToken } = await import("./browse-abandon");
    const out = tokenizeStorefrontLinks('<a href="https://promunch.in/p?utm_source=email">x</a>', (u) => withContactToken(u, "c-1"));
    const href = out.match(/href="([^"]+)"/)![1].replace(/&amp;/g, "&");
    const u = new URL(href);
    expect(u.searchParams.get("utm_source")).toBe("email");
    expect(u.searchParams.get("pm_c")).toBeTruthy();
  });
});
