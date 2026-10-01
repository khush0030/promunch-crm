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
