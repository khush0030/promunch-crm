import { describe, expect, it } from "vitest";
import { pickReviewProduct, reviewUrl, usesReviewTokens, type StoreProduct } from "./order-product";
import { personalize, personalizeSubject } from "./personalize";

const catalog = new Map<string, StoreProduct>([
  ["1", { id: "1", handle: "noodle-masala", title: "PROMUNCH Noodle Masala Soya Crunchies - 270gm", image: "https://cdn/n.png" }],
  ["2", { id: "2", handle: "edamame-combo", title: "PROMUNCH Roasted Edamame Beans Combo", image: null }],
]);

describe("pickReviewProduct", () => {
  it("picks the highest line value that exists in the catalog", () => {
    const p = pickReviewProduct({ items: [
      { product_id: 1, price: "260", quantity: 1 },
      { product_id: 2, price: "600", quantity: 1 },
      { product_id: 99, price: "5000", quantity: 1 },
    ] }, catalog);
    expect(p).toEqual({ title: "Roasted Edamame Beans Combo", url: "https://promunch.in/products/edamame-combo", image: null });
  });
  it("counts quantity and skips ₹0.01 creator seeds", () => {
    expect(pickReviewProduct({ items: [
      { product_id: 1, price: "260", quantity: 3 },
      { product_id: 2, price: "600", quantity: 1 },
    ] }, catalog)?.url).toContain("noodle-masala");
    expect(pickReviewProduct({ items: [{ product_id: 1, price: "0.01", quantity: 1 }] }, catalog)).toBeNull();
    expect(pickReviewProduct({ items: [{ product_id: 1, price: "260", quantity: 1 }] }, catalog)?.title).toBe("Noodle Masala Soya Crunchies");
  });
  it("is null with no items or no catalog", () => {
    expect(pickReviewProduct({}, catalog)).toBeNull();
    expect(pickReviewProduct({ items: [{ product_id: 1, price: 260 }] }, new Map())).toBeNull();
  });
});

describe("review links", () => {
  it("lands on the Judge.me widget of the product, with UTMs", () => {
    const u = reviewUrl({ title: "x", url: "https://promunch.in/products/noodle-masala", image: null }, 0);
    expect(u).toBe("https://promunch.in/products/noodle-masala?utm_source=email&utm_medium=flow&utm_campaign=review_request&utm_content=email_1#judgeme_product_reviews");
  });
  it("falls back to the store-wide review page", () => {
    expect(reviewUrl(null, 1)).toBe("https://promunch.in/pages/review-submission?utm_source=email&utm_medium=flow&utm_campaign=review_request&utm_content=email_2");
  });
  it("personalize fills {{review_url}} / {{review_product}} from ctx.review_product", () => {
    const ctx = { review_product: { title: "Noodle Masala Soya Crunchies - 270gm", url: "https://promunch.in/products/noodle-masala", image: null } };
    const html = personalize('<a href="{{review_url}}">Review {{review_product}}</a>', ctx, "A", 0);
    expect(html).toContain("products/noodle-masala?utm_source=email");
    expect(html).toContain("#judgeme_product_reviews");
    expect(html).toContain("Review Noodle Masala Soya Crunchies - 270gm");
    expect(personalizeSubject("How was your {{review_product}}?", {}, "A")).toBe("How was your order?");
  });
  it("detects review tokens", () => {
    expect(usesReviewTokens("x {{review_url}} y")).toBe(true);
    expect(usesReviewTokens("nothing here", undefined)).toBe(false);
  });
});

describe("reorder tokens", () => {
  const product = { title: "Noodle Masala Soya Crunchies", url: "https://promunch.in/products/noodle-masala", image: "https://cdn.shopify.com/s/files/n.png?v=1" };
  it("links the card and button to the product they bought", () => {
    const out = personalize("{{reorder_card}}|{{reorder_url}}", { review_product: product }, "A");
    expect(out).toContain("Noodle Masala Soya Crunchies");
    expect(out).toContain("n.png?v=1&amp;width=320");
    expect(out).toContain("https://promunch.in/products/noodle-masala?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=replenishment&amp;utm_content=email_1");
  });
  it("drops the card and falls back to Best Sellers when unknown", () => {
    expect(personalize("{{reorder_card}}|{{reorder_url}}", {}, "A")).toBe("|https://promunch.in/collections/best-sellers?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=replenishment&amp;utm_content=email_1");
  });
  it("triggers the catalog fetch", () => {
    expect(usesReviewTokens("x {{reorder_card}}")).toBe(true);
  });
});

describe("reorder tokens", () => {
  const product = { title: "Noodle Masala Soya Crunchies", url: "https://promunch.in/products/noodle-masala", image: "https://cdn.shopify.com/s/files/n.png?v=1" };
  it("links the card and button to the product they bought", () => {
    const out = personalize("{{reorder_card}}|{{reorder_url}}", { review_product: product }, "A");
    expect(out).toContain("Noodle Masala Soya Crunchies");
    expect(out).toContain("n.png?v=1&amp;width=320");
    expect(out).toContain("https://promunch.in/products/noodle-masala?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=replenishment&amp;utm_content=email_1");
  });
  it("drops the card and falls back to Best Sellers when unknown", () => {
    expect(personalize("{{reorder_card}}|{{reorder_url}}", {}, "A")).toBe("|https://promunch.in/collections/best-sellers?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=replenishment&amp;utm_content=email_1");
  });
  it("triggers the catalog fetch", () => {
    expect(usesReviewTokens("x {{reorder_card}}")).toBe(true);
  });
});

describe("reorder_url with a cart permalink", () => {
  it("prefers the one-tap cart link and keeps its storefront flag", () => {
    const out = personalize("{{reorder_url}}", { reorder_url: "https://promunch.in/cart/123:2?storefront=true" }, "A", 1);
    expect(out).toBe("https://promunch.in/cart/123:2?storefront=true&amp;utm_source=email&amp;utm_medium=flow&amp;utm_campaign=replenishment&amp;utm_content=email_2");
  });
});
