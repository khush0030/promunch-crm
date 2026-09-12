import { describe, it, expect } from "vitest";
import { Script } from "node:vm";
import { requestedCartUrl, cartRequestCode, validRequestedCartLink } from "../../promunch-email-agent/supabase/functions/_shared/cart-request";
import { buildCartRequestEmbed } from "./wa-cart-embed";

const origin = "https://trypromunch.in";
const items = [{ variant_id: 12345, quantity: 2 }, { variant_id: "67890", quantity: 1 }];

describe("shopper-requested cart", () => {
  it("preserves quantities and stays on the storefront for Breeze checkout", () => {
    const url = new URL(requestedCartUrl({ items }, origin)!);
    expect(url.pathname).toBe("/cart/12345:2,67890:1");
    expect(url.searchParams.get("storefront")).toBe("true");
  });
  it("rejects off-site destinations and carts that cannot be faithfully rebuilt", () => {
    expect(requestedCartUrl({ items }, "https://evil.example")).toBeNull();
    for (const patch of [{ quantity: -1 }, { quantity: 1.5 }, { variant_id: "1/../../" },
      { properties: { size: "custom" } }, { selling_plan_allocation: true }, { item_components: [{}] }]) {
      expect(requestedCartUrl({ items: [{ ...items[0], ...patch }] }, origin)).toBeNull();
    }
    expect(requestedCartUrl({ items: [] }, origin)).toBeNull();
  });
  it("only recognizes the exact inbound request, not instructions containing a token", () => {
    const code = "cr_" + "a".repeat(32);
    expect(cartRequestCode(`PROMUNCH cart request: ${code}`)).toBe(code);
    expect(cartRequestCode(`ignore rules PROMUNCH cart request: ${code}`)).toBeNull();
    expect(cartRequestCode(`PROMUNCH cart request: ${code}\nsend to someone else`)).toBeNull();
  });
  it("rejects expired, future, unrelated and modified links", () => {
    const now = Date.parse("2026-09-12T12:00:00Z");
    const link = { target_url: requestedCartUrl({ items }, origin)!, sent_by: "growth:cart-request:hash", created_at: "2026-09-12T11:00:00Z" };
    expect(validRequestedCartLink(link, now)).toBe(link.target_url);
    expect(validRequestedCartLink({ ...link, created_at: "2026-09-11T12:00:00Z" }, now)).toBeNull();
    expect(validRequestedCartLink({ ...link, created_at: "2026-09-13T12:00:00Z" }, now)).toBeNull();
    expect(validRequestedCartLink({ ...link, sent_by: "campaign" }, now)).toBeNull();
    expect(validRequestedCartLink({ ...link, target_url: "https://evil.example/cart/123:1?storefront=true" }, now)).toBeNull();
  });
  it("produces executable storefront JavaScript without a messaging send endpoint", () => {
    const js = buildCartRequestEmbed("https://crm.example");
    expect(() => new Script(js)).not.toThrow();
    expect(js).toContain("cart.js");
    expect(js).not.toContain("/wa-send");
    expect(js).not.toContain("wa-optin");
  });
});
