import { describe, expect, it } from "vitest";
import { cartSubtotal, cartSummaryHtml, cleanTitle } from "./cart-items";
import { personalize } from "./personalize";

const ctx = (items: Array<{ price: number; quantity?: number; title?: string }>) => ({ items });

describe("cleanTitle", () => {
  it("drops the leading brand and tidies bracket spaces", () => {
    expect(cleanTitle("PROMUNCH Edamame Beans Travel Combo - Pack of 9 (25g each )")).toBe(
      "Edamame Beans Travel Combo - Pack of 9 (25g each)",
    );
  });
  it("drops a trailing | PROMUNCH", () => {
    expect(cleanTitle("Roasted Edamame Beans | Masala Mania | Pack of 2 | PROMUNCH")).toBe(
      "Roasted Edamame Beans | Masala Mania | Pack of 2",
    );
  });
  it("never returns empty", () => {
    expect(cleanTitle("PROMUNCH")).toBe("PROMUNCH");
  });
});

describe("cartSummaryHtml", () => {
  it("shows the rupee saving and free shipping when still above ₹599 after discount", () => {
    const html = cartSummaryHtml(ctx([{ price: 260 }, { price: 450 }]), 15);
    expect(cartSubtotal(ctx([{ price: 260 }, { price: 450 }]))).toBe(710);
    expect(html).toContain("₹710");
    expect(html).toContain("Your 15% off");
    expect(html).toContain("&minus;₹107"); // round(106.5)
    expect(html).toContain("FREE");
    expect(html).toContain("₹603");
    expect(html).not.toContain("more and shipping is free");
  });

  it("is honest when the discount drops the cart below the free-shipping line", () => {
    const html = cartSummaryHtml(ctx([{ price: 650 }]), 15); // 650 - 98 = 552
    expect(html).toContain("₹99");
    expect(html).toContain("₹651"); // 552 + 99
    expect(html).toContain("Add ₹47 more and shipping is free.");
  });

  it("multiplies by quantity and omits the discount row at 0%", () => {
    const html = cartSummaryHtml(ctx([{ price: 300, quantity: 2 }]), 0);
    expect(html).toContain("₹600");
    expect(html).not.toContain("% off");
  });

  it("renders nothing for an unpriced cart", () => {
    expect(cartSummaryHtml({}, 15)).toBe("");
  });
});

describe("personalize {{cart_summary}}", () => {
  it("only applies the discount when a code was actually issued", () => {
    const body = "{{cart_summary}}";
    expect(personalize(body, ctx([{ price: 710 }]), "A", 0, "CART15-XYZ", undefined, 15)).toContain("Your 15% off");
    expect(personalize(body, ctx([{ price: 710 }]), "A", 0, "", undefined, 15)).not.toContain("% off");
  });
});
