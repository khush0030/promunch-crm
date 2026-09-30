// Pure helpers behind the email flow engine's send guards and renderers.
import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// DB / provider seams for the tick() tests at the bottom. Only the modules that
// touch Supabase, Resend, Shopify or env are mocked; the pure helpers tested
// above are the real ones.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let rowSeq = 0;
class FakeQ {
  private f: Array<(r: Row) => boolean> = [];
  private op: "select" | "update" | "insert" = "select";
  private patch: Row = {};
  private one = false;
  private lim = Infinity;
  constructor(private t: string) { db[t] ??= []; }
  select() { return this; }
  eq(c: string, v: unknown) { this.f.push((r) => r[c] === v); return this; }
  lte(c: string, v: string) { this.f.push((r) => String(r[c]) <= v); return this; }
  in(c: string, vs: unknown[]) { this.f.push((r) => vs.includes(r[c])); return this; }
  not() { return this; }
  or() { return this; }
  order() { return this; }
  range() { return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.one = true; return this; }
  update(p: Row) { this.op = "update"; this.patch = p; return this; }
  insert(r: Row) { this.op = "insert"; this.patch = r; return this; }
  private run() {
    const t = db[this.t];
    if (this.op === "insert") {
      const row: Row = { id: `r${++rowSeq}`, ...this.patch };
      if (this.t === "email_sends" && t.some((x) => x.enrollment_id === row.enrollment_id && x.step_index === row.step_index && x.status !== "failed")) {
        return { data: null, error: { code: "23505", message: "duplicate" } };
      }
      t.push(row);
      return { data: [row], error: null };
    }
    const rows = t.filter((r) => this.f.every((fn) => fn(r)));
    if (this.op === "update") { rows.forEach((r) => Object.assign(r, this.patch)); return { data: rows, error: null }; }
    const out = rows.slice(0, this.lim);
    return { data: this.one ? (out[0] ?? null) : out, error: null };
  }
  then<T>(res: (v: { data: unknown; error: unknown }) => T, rej?: (e: unknown) => T) {
    return Promise.resolve(this.run()).then(res, rej);
  }
}
const sendEmailMock = vi.fn(async (_opts: { to: string; subject: string; html: string }) => ({ data: { id: "re_1" }, error: null }));
const couponMock = vi.fn(async (_o: unknown) => "");
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { from: (t: string) => new FakeQ(t) } }));
vi.mock("@/lib/resend", () => ({ sendEmail: (o: { to: string; subject: string; html: string }) => sendEmailMock(o), DEFAULT_FROM: "PROMUNCH <hello@promunch.in>" }));
vi.mock("./coupons", () => ({ getOrCreateFlowCoupon: (o: unknown) => couponMock(o) }));
vi.mock("@/lib/email-studio/audience-server", () => ({ getFreqCapHours: async () => 0, recentMarketingSends: async () => [] }));
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
  couponProblem,
  mentionsCouponToken,
  waJourneyOverlap,
  waRunWasSent,
  enrolmentRefs,
  toWaId,
  type WaJourneyRunRow,
} from "./send-guards";
import { tick } from "./flow-engine";
import { pickContactId } from "./enroll";
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

  it("renders a 92px thumbnail with alt text and qty, and no image cell when missing", () => {
    const html = cartItemsHtml({ items: [{ title: "Peri <Peri>", quantity: 2, price: 100, image_url: "https://cdn/p.jpg" }] });
    expect(html).toContain('width="92" height="92" alt="Peri &lt;Peri&gt;"');
    expect(html).toContain("Qty 2");
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

// ---------------------------------------------------------------------------
// Coupon safety
// ---------------------------------------------------------------------------
describe("couponProblem", () => {
  const ok = { subject: "Hi", html: "<p>Your code PM-ABCD2345</p>" };
  it("blocks a minting step whose code came back empty", () => {
    expect(couponProblem({ step: { coupon: { percent_off: 15 }, body_html: "<p>{{coupon_code}}</p>" }, coupon: "", rendered: { subject: "Hi", html: "<p></p>" } })).toBe("coupon unavailable");
    expect(couponProblem({ step: { coupon: { percent_off: 15 }, body_html: "<p>no tag</p>" }, coupon: "  ", rendered: ok })).toBe("coupon unavailable");
  });
  it("blocks an empty coupon slot in any copy field even without step.coupon", () => {
    expect(couponProblem({ step: { subject: "{{coupon_code}} inside", body_html: "x" }, coupon: "", rendered: ok })).toBe("coupon unavailable");
    expect(couponProblem({ step: { subject: "s", body_html: "x", subject_variants: ["Use {{ coupon_code }}"] }, coupon: "", rendered: ok })).toBe("coupon unavailable");
  });
  it("blocks a coupon tag that survived rendering", () => {
    expect(couponProblem({ step: { subject: "s", body_html: "{{coupon}}" }, coupon: "", rendered: { subject: "s", html: "<p>{{coupon}}</p>" } })).toMatch(/coupon unavailable/);
    expect(couponProblem({ step: { coupon: { percent_off: 20 }, body_html: "x" }, coupon: "PM-X", rendered: { subject: "Code {{COUPON_CODE}}", html: "" } })).toMatch(/unrendered/);
  });
  it("passes a minted code and coupon-free steps", () => {
    expect(couponProblem({ step: { coupon: { percent_off: 15 }, body_html: "{{coupon_code}}" }, coupon: "PM-ABCD2345", rendered: ok })).toBeNull();
    expect(couponProblem({ step: { subject: "Welcome", body_html: "<p>hello</p>" }, coupon: "", rendered: ok })).toBeNull();
    expect(couponProblem({ step: { coupon: { percent_off: 0 }, body_html: "hi" }, coupon: "", rendered: ok })).toBeNull();
    expect(mentionsCouponToken("{{ first_name }}")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WhatsApp overlap guard
// ---------------------------------------------------------------------------
describe("WhatsApp overlap guard", () => {
  const now = new Date("2026-09-30T06:30:00Z");
  const run = (o: Partial<WaJourneyRunRow>): WaJourneyRunRow => ({
    journey_key: "review_request", status: "completed", order_ref: "#2050",
    delivered_at: null, updated_at: "2026-09-25T06:00:00Z", next_action_at: "2026-09-25T06:00:00Z", ...o,
  });

  it("normalises phones like the WA code", () => {
    expect(toWaId("98765 43210")).toBe("919876543210");
    expect(toWaId("+91-98765-43210")).toBe("919876543210");
    expect(toWaId("09876543210")).toBe("919876543210");
    expect(toWaId("12345")).toBeNull();
    expect(toWaId(null)).toBeNull();
  });

  it("only completed or delivered runs count as sent", () => {
    expect(waRunWasSent({ status: "completed", delivered_at: null })).toBe(true);
    expect(waRunWasSent({ status: "active", delivered_at: "2026-09-25T06:00:00Z" })).toBe(true);
    for (const st of ["active", "cancelled", "failed", "expired", "converted"]) {
      expect(waRunWasSent({ status: st, delivered_at: null })).toBe(false);
    }
  });

  it("collects order and checkout refs from the enrolment context", () => {
    expect(enrolmentRefs({ order_ref: "#2050", checkout_token: "t1", checkout_tokens: ["t0", "t1"] }).sort()).toEqual(["#2050", "t0", "t1"]);
    expect(enrolmentRefs(null)).toEqual([]);
  });

  it("same order: skips only when WA sent for THAT order", () => {
    expect(waJourneyOverlap({ kind: "review", runs: [run({})], refs: ["#2050"], now })).toEqual({ ref: "#2050" });
    expect(waJourneyOverlap({ kind: "review", runs: [run({ order_ref: "#2049" })], refs: ["#2050"], now })).toBeNull();
    // Old send for the same order still counts (the window is for ref-less enrolments).
    expect(waJourneyOverlap({ kind: "review", runs: [run({ updated_at: "2026-01-01T00:00:00Z" })], refs: ["#2050"], now })).toEqual({ ref: "#2050" });
  });

  it("unsent / other-journey runs never cause a skip", () => {
    expect(waJourneyOverlap({ kind: "review", runs: [run({ status: "active" })], refs: ["#2050"], now })).toBeNull();
    expect(waJourneyOverlap({ kind: "review", runs: [run({ status: "cancelled" })], refs: [], now })).toBeNull();
    expect(waJourneyOverlap({ kind: "replenishment", runs: [run({})], refs: ["#2050"], now })).toBeNull();
  });

  it("cart matches by checkout token", () => {
    const cart = run({ journey_key: "abandoned_checkout", order_ref: "tok-9" });
    expect(waJourneyOverlap({ kind: "cart", runs: [cart], refs: ["tok-8", "tok-9"], now })).toEqual({ ref: "tok-9" });
    expect(waJourneyOverlap({ kind: "cart", runs: [cart], refs: ["tok-1"], now })).toBeNull();
  });

  it("no refs: any matching send in the last 30 days", () => {
    const rep = (at: string) => run({ journey_key: "replenishment_reminder", updated_at: at, next_action_at: at });
    expect(waJourneyOverlap({ kind: "replenishment", runs: [rep("2026-09-10T00:00:00Z")], refs: [], now })).toEqual({ ref: "#2050" });
    expect(waJourneyOverlap({ kind: "replenishment", runs: [rep("2026-08-20T00:00:00Z")], refs: [], now })).toBeNull();
    // delivered_at wins over updated_at as the send time
    expect(waJourneyOverlap({ kind: "replenishment", runs: [run({ journey_key: "replenishment_reminder", status: "active", delivered_at: "2026-09-29T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" })], refs: [], now })).not.toBeNull();
  });
});

describe("pickContactId (case-insensitive enrol lookup)", () => {
  it("prefers the lowercase row, else the first match", () => {
    expect(pickContactId([{ id: "a", email: "Foo@X.com" }, { id: "b", email: "foo@x.com" }], "FOO@x.com")).toBe("b");
    expect(pickContactId([{ id: "a", email: "Foo@X.com" }], "foo@x.com")).toBe("a");
    expect(pickContactId([], "foo@x.com")).toBeNull();
    expect(pickContactId(null, "foo@x.com")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// tick(): coupon safety + WA overlap, end to end against the fake DB
// ---------------------------------------------------------------------------
describe("tick()", () => {
  const NOW = new Date("2026-09-30T06:30:00Z"); // 12:00 IST, inside the send window
  const H = 3_600_000;
  const offerStep = { type: "email", delay_hours: 0, subject: "Your 15% code", body_html: "<p>Use {{coupon_code}}</p>", coupon: { percent_off: 15 }, coupon_code: "" };

  function seed(steps: Row[], enr: Partial<Row> = {}, contact: Partial<Row> = {}) {
    for (const k of Object.keys(db)) delete db[k];
    db.flows = [{ id: "f1", status: "active", steps, trigger_type: "order_placed" }];
    db.flow_enrollments = [{ id: "e1", flow_id: "f1", contact_id: "c1", current_step: 0, context: { order_ref: "#2050" }, deadline_at: null, attempts: 0, status: "active", next_action_at: new Date(NOW.getTime() - 1000).toISOString(), ...enr }];
    db.contacts = [{ id: "c1", email: "buyer@x.com", phone: "98765 43210", first_name: "Asha", status: "active", accepts_marketing: true, ...contact }];
    db.suppressions = [];
    db.email_sends = [];
    db.wa_journey_runs = [];
  }

  beforeAll(() => {
    process.env.UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || "test-secret";
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    sendEmailMock.mockClear();
    couponMock.mockReset();
    couponMock.mockResolvedValue("");
  });
  afterEach(() => vi.useRealTimers());

  it("never sends an offer with no code: releases the claim, retries in 1h, counts the attempt", async () => {
    seed([offerStep]);
    const r = await tick();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(r.failed).toBe(1);
    expect(db.email_sends).toHaveLength(1);
    expect(db.email_sends[0]).toMatchObject({ status: "failed", error: "coupon unavailable" });
    const e = db.flow_enrollments[0];
    expect(e).toMatchObject({ status: "active", current_step: 0, attempts: 1, last_error: "coupon unavailable" });
    expect(Date.parse(e.next_action_at as string)).toBe(NOW.getTime() + H);

    // An hour later the mint works: the released claim is re-taken and ONE email goes out.
    vi.setSystemTime(new Date(NOW.getTime() + H + 1000));
    couponMock.mockResolvedValue("PM-ABCD2345");
    const r2 = await tick();
    expect(r2.sent).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].html).toContain("PM-ABCD2345");
    expect(db.email_sends.filter((s) => s.status === "sent")).toHaveLength(1);
    expect(db.flow_enrollments[0].status).toBe("completed");

    // A third tick has nothing due and sends nothing.
    await tick();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("fails the enrolment with 'coupon unavailable' after MAX_ATTEMPTS", async () => {
    seed([offerStep], { attempts: 4 });
    await tick();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(db.flow_enrollments[0]).toMatchObject({ status: "failed", last_error: "coupon unavailable", attempts: 5 });
  });

  it("blocks an unsupported coupon tag that would render literally", async () => {
    seed([{ type: "email", delay_hours: 0, subject: "Hi", body_html: "<p>Code: {{coupon}}</p>" }]);
    await tick();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(db.email_sends[0]).toMatchObject({ status: "failed" });
    expect(String(db.email_sends[0].error)).toMatch(/coupon unavailable/);
  });

  it("skips a review step WhatsApp already sent for the same order (no send, no claim)", async () => {
    const review = { type: "email", delay_hours: 0, subject: "How was it?", body_html: "<p>Review</p>", skip_if_wa_journey: "review" };
    const next = { type: "email", delay_hours: 48, subject: "Later", body_html: "<p>x</p>" };
    seed([review, next]);
    db.wa_journey_runs = [{ journey_key: "review_request", wa_id: "919876543210", status: "completed", order_ref: "#2050", delivered_at: null, updated_at: "2026-09-29T00:00:00Z", next_action_at: "2026-09-29T00:00:00Z" }];
    const r = await tick();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
    expect(db.email_sends).toHaveLength(0);
    expect(db.flow_enrollments[0]).toMatchObject({ status: "active", current_step: 1 });
    expect(Date.parse(db.flow_enrollments[0].next_action_at as string)).toBe(NOW.getTime() + 48 * H);
  });

  it("sends the review email when WhatsApp's ask was for a different order or not sent", async () => {
    const review = { type: "email", delay_hours: 0, subject: "How was it?", body_html: "<p>Review</p>", skip_if_wa_journey: "review" };
    seed([review]);
    db.wa_journey_runs = [
      { journey_key: "review_request", wa_id: "919876543210", status: "completed", order_ref: "#2049", delivered_at: null, updated_at: "2026-09-29T00:00:00Z", next_action_at: null },
      { journey_key: "review_request", wa_id: "919876543210", status: "active", order_ref: "#2050", delivered_at: null, updated_at: "2026-09-29T00:00:00Z", next_action_at: null },
    ];
    const r = await tick();
    expect(r.sent).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});
