import { describe, expect, it } from "vitest";
import {
  buildDraftOrderInput,
  buildInfluencerDiscountVariables,
  buildOpsDispatchMessage,
  createInfluencerDiscountCode,
  createInfluencerOrder,
  formatInfluencerDiscountCode,
  indianProvinceCode,
  ShopifyDispatchError,
  toVariantGid,
  validateDispatchAddress,
} from "./shopify-dispatch";

const fullAddr = {
  name: "Riya Sharma",
  line1: "12 MG Road",
  line2: "Flat 4B",
  city: "Indore",
  state: "Madhya Pradesh",
  pincode: "452001",
  phone: "98765 43210",
};

describe("validateDispatchAddress", () => {
  it("accepts a complete address and normalises the phone", () => {
    const r = validateDispatchAddress(fullAddr);
    expect(r.ok).toBe(true);
    expect(r.address.phone).toBe("919876543210");
    expect(r.address.line2).toBe("Flat 4B");
  });

  it("lists every missing field", () => {
    const r = validateDispatchAddress({ line1: " ", city: "", state: null, pincode: "45200", phone: "123" });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["name", "line1", "city", "state", "pincode", "phone"]);
  });

  it("rejects a pincode starting with 0 and a null address", () => {
    expect(validateDispatchAddress({ ...fullAddr, pincode: "052001" }).missing).toEqual(["pincode"]);
    expect(validateDispatchAddress(null).ok).toBe(false);
  });

  it("falls back to the creator's name and phone", () => {
    const r = validateDispatchAddress({ ...fullAddr, name: null, phone: null }, { name: "riya.eats", phone: "919000000001" });
    expect(r.ok).toBe(true);
    expect(r.address.name).toBe("riya.eats");
    expect(r.address.phone).toBe("919000000001");
  });
});

describe("indianProvinceCode / toVariantGid", () => {
  it("maps names and codes", () => {
    expect(indianProvinceCode("Madhya Pradesh")).toBe("MP");
    expect(indianProvinceCode("tamil  nadu")).toBe("TN");
    expect(indianProvinceCode("Jammu & Kashmir")).toBe("JK");
    expect(indianProvinceCode("mh")).toBe("MH");
    expect(indianProvinceCode("Atlantis")).toBeNull();
  });
  it("normalises variant ids", () => {
    expect(toVariantGid("4455")).toBe("gid://shopify/ProductVariant/4455");
    expect(toVariantGid(4455)).toBe("gid://shopify/ProductVariant/4455");
    expect(toVariantGid("gid://shopify/ProductVariant/9")).toBe("gid://shopify/ProductVariant/9");
    expect(toVariantGid("gid://shopify/Product/9")).toBeNull();
    expect(toVariantGid("")).toBeNull();
  });
});

describe("buildDraftOrderInput", () => {
  const base = {
    deal: { id: "d1", code: "AbC123xyz789" },
    influencer: { handle: "Riya.Eats", full_name: "Riya Sharma", email: "riya@example.com", phone: null },
    address: validateDispatchAddress(fullAddr).address,
    kit: {
      name: "Starter kit",
      items: [
        { variant_id: "111", title: "Crunchies", qty: 2 },
        { variant_id: "gid://shopify/ProductVariant/111", title: "Crunchies dup", qty: 1 },
        { variant_id: "222", title: "Chips", qty: 1 },
      ],
    },
  };

  it("builds a ₹0 tagged draft with merged lines", () => {
    const { input } = buildDraftOrderInput(base);
    expect(input.lineItems).toEqual([
      { variantId: "gid://shopify/ProductVariant/111", quantity: 3 },
      { variantId: "gid://shopify/ProductVariant/222", quantity: 1 },
    ]);
    expect(input.appliedDiscount).toMatchObject({ value: 100, valueType: "PERCENTAGE", title: "PROMUNCH influencer barter" });
    expect(input.tags).toEqual(["Influencer", "influencer:riya.eats"]);
    expect(input.shippingLine).toEqual({ title: "Influencer kit", priceWithCurrency: { amount: "0.00", currencyCode: "INR" } });
    expect(input.note).toContain("AbC123xyz789");
    expect(input.phone).toBe("+919876543210");
    expect(input.email).toBe("riya@example.com");
    expect(input.shippingAddress).toMatchObject({
      firstName: "Riya",
      lastName: "Sharma",
      address1: "12 MG Road",
      zip: "452001",
      countryCode: "IN",
      provinceCode: "MP",
    });
    expect(String(input.note)).not.toContain("—");
  });

  it("omits a missing email and sends unknown states as free text", () => {
    const { input } = buildDraftOrderInput({
      ...base,
      influencer: { ...base.influencer, email: null },
      address: { ...base.address, state: "Atlantis" },
    });
    expect(input).not.toHaveProperty("email");
    expect(input.shippingAddress).toMatchObject({ province: "Atlantis" });
    expect(input.shippingAddress).not.toHaveProperty("provinceCode");
  });

  it("throws on a kit with bad items or no items", () => {
    expect(() => buildDraftOrderInput({ ...base, kit: { name: "x", items: [{ variant_id: "abc", title: "Bad", qty: 1 }] } })).toThrow(/Bad/);
    expect(() => buildDraftOrderInput({ ...base, kit: { name: "x", items: [{ variant_id: "1", title: "Zero", qty: 0 }] } })).toThrow(/Zero/);
    expect(() => buildDraftOrderInput({ ...base, kit: { name: "x", items: [] } })).toThrow(/no items/);
  });
});

describe("discount code helpers", () => {
  it("formats MUNCH-<HANDLE6>10", () => {
    expect(formatInfluencerDiscountCode("riya.eats_99")).toBe("MUNCH-RIYAEA10");
    expect(formatInfluencerDiscountCode("ab")).toBe("MUNCH-AB10");
    expect(formatInfluencerDiscountCode("...")).toBe("MUNCH-PAL10");
    expect(formatInfluencerDiscountCode("riya.eats", "x7")).toBe("MUNCH-RIYAEAX710");
  });
  it("builds 10% once-per-customer, no end date", () => {
    const v = buildInfluencerDiscountVariables("MUNCH-RIYAEA10", "Riya.Eats", "2026-10-07T00:00:00.000Z").basicCodeDiscount;
    expect(v.customerGets.value.percentage).toBe(0.1);
    expect(v.appliesOncePerCustomer).toBe(true);
    expect(v.endsAt).toBeNull();
    expect(v).not.toHaveProperty("usageLimit");
    expect(v.title).toBe("PROMUNCH influencer @riya.eats");
  });
  it("ops message", () => {
    expect(buildOpsDispatchMessage({ handle: "riya.eats", kitName: "Starter kit", orderName: "#2301", city: "Indore", pincode: "452001" })).toBe(
      "Influencer kit to ship: @riya.eats, Starter kit, order #2301, Indore 452001",
    );
  });
});

// ---- GraphQL flow with a scripted fetch -------------------------------------

type Step = { match: string; status?: number; body?: unknown; throws?: Error };

function scripted(steps: Step[]) {
  const calls: { query: string; variables: unknown }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body));
    calls.push({ query, variables });
    const step = steps.shift();
    if (!step) throw new Error(`unexpected call: ${query.slice(0, 60)}`);
    expect(query).toContain(step.match);
    if (step.throws) throw step.throws;
    return new Response(JSON.stringify(step.body ?? {}), { status: step.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, getToken: async () => "tok", domain: "test.myshopify.com" };
}

const orderArgs = {
  deal: { id: "d1", code: "AbC123xyz789" },
  influencer: { handle: "riya.eats", full_name: "Riya Sharma", email: null, phone: null },
  address: fullAddr,
  kit: { name: "Starter kit", items: [{ variant_id: "111", title: "Crunchies", qty: 1 }] },
};
const ORDER = { id: "gid://shopify/Order/555", name: "#2301", statusPageUrl: "https://shop/status" };

describe("createInfluencerOrder", () => {
  it("creates then completes, recording the draft first", async () => {
    const deps = scripted([
      { match: "draftOrderCreate", body: { data: { draftOrderCreate: { draftOrder: { id: "gid://shopify/DraftOrder/1" }, userErrors: [] } } } },
      { match: "draftOrderComplete", body: { data: { draftOrderComplete: { draftOrder: { id: "x", status: "COMPLETED", order: ORDER }, userErrors: [] } } } },
    ]);
    const recorded: string[] = [];
    const r = await createInfluencerOrder({ ...orderArgs, onDraftCreated: async (id) => void recorded.push(id) }, deps);
    expect(recorded).toEqual(["gid://shopify/DraftOrder/1"]);
    expect(r).toEqual({
      order_id: "555",
      order_gid: ORDER.id,
      order_name: "#2301",
      order_status_url: "https://shop/status",
      draft_order_id: "gid://shopify/DraftOrder/1",
    });
  });

  it("surfaces userErrors from draftOrderCreate as a definite failure", async () => {
    const deps = scripted([
      { match: "draftOrderCreate", body: { data: { draftOrderCreate: { draftOrder: null, userErrors: [{ field: ["lineItems", "0"], message: "Variant not found" }] } } } },
    ]);
    const e = await createInfluencerOrder(orderArgs, deps).catch((x) => x);
    expect(e).toBeInstanceOf(ShopifyDispatchError);
    expect(e.ambiguous).toBe(false);
    expect(e.message).toContain("lineItems.0: Variant not found");
  });

  it("resumes a completed draft without creating anything", async () => {
    const deps = scripted([{ match: "draftOrder(id", body: { data: { draftOrder: { id: "d", status: "COMPLETED", order: ORDER } } } }]);
    const r = await createInfluencerOrder({ ...orderArgs, resumeDraftId: "gid://shopify/DraftOrder/1" }, deps);
    expect(r.order_name).toBe("#2301");
    expect(deps.calls).toHaveLength(1);
  });

  it("resumes an open draft by completing the SAME draft", async () => {
    const deps = scripted([
      { match: "draftOrder(id", body: { data: { draftOrder: { id: "d", status: "OPEN", order: null } } } },
      { match: "draftOrderComplete", body: { data: { draftOrderComplete: { draftOrder: { id: "d", status: "COMPLETED", order: ORDER }, userErrors: [] } } } },
    ]);
    const r = await createInfluencerOrder({ ...orderArgs, resumeDraftId: "gid://shopify/DraftOrder/1" }, deps);
    expect(r.order_id).toBe("555");
    expect(deps.calls[1].variables).toEqual({ id: "gid://shopify/DraftOrder/1" });
  });

  it("timeout on complete: adopts the order if the re-read shows it completed", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const deps = scripted([
      { match: "draftOrderCreate", body: { data: { draftOrderCreate: { draftOrder: { id: "gid://shopify/DraftOrder/1" }, userErrors: [] } } } },
      { match: "draftOrderComplete", throws: abort },
      { match: "draftOrder(id", body: { data: { draftOrder: { id: "d", status: "COMPLETED", order: ORDER } } } },
    ]);
    const r = await createInfluencerOrder(orderArgs, deps);
    expect(r.order_id).toBe("555");
  });

  it("timeout on complete with an unreadable draft stays ambiguous (caller keeps the lock)", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const deps = scripted([
      { match: "draftOrderCreate", body: { data: { draftOrderCreate: { draftOrder: { id: "gid://shopify/DraftOrder/1" }, userErrors: [] } } } },
      { match: "draftOrderComplete", throws: abort },
      { match: "draftOrder(id", throws: abort },
    ]);
    const e = await createInfluencerOrder(orderArgs, deps).catch((x) => x);
    expect(e).toBeInstanceOf(ShopifyDispatchError);
    expect(e.ambiguous).toBe(true);
    expect(deps.calls.some((c) => c.query.includes("draftOrderDelete"))).toBe(false);
  });

  it("definite complete failure deletes the draft", async () => {
    const deps = scripted([
      { match: "draftOrderCreate", body: { data: { draftOrderCreate: { draftOrder: { id: "gid://shopify/DraftOrder/1" }, userErrors: [] } } } },
      { match: "draftOrderComplete", body: { data: { draftOrderComplete: { draftOrder: null, userErrors: [{ field: null, message: "Out of stock" }] } } } },
      { match: "draftOrder(id", body: { data: { draftOrder: { id: "d", status: "OPEN", order: null } } } },
      { match: "draftOrderDelete", body: { data: { draftOrderDelete: { deletedId: "d", userErrors: [] } } } },
    ]);
    const e = await createInfluencerOrder(orderArgs, deps).catch((x) => x);
    expect(e.ambiguous).toBe(false);
    expect(e.message).toContain("Out of stock");
  });

  it("flags a missing write_draft_orders scope", async () => {
    const deps = scripted([{ match: "draftOrderCreate", status: 403, body: { errors: "access denied" } }]);
    const e = await createInfluencerOrder(orderArgs, deps).catch((x) => x);
    expect(e.message).toMatch(/write_draft_orders/);
  });

  it("refuses an incomplete address before calling Shopify", async () => {
    const deps = scripted([]);
    const e = await createInfluencerOrder({ ...orderArgs, address: { ...fullAddr, pincode: "12" } }, deps).catch((x) => x);
    expect(e.message).toContain("pincode");
    expect(deps.calls).toHaveLength(0);
  });
});

describe("createInfluencerDiscountCode", () => {
  it("creates the base code", async () => {
    const deps = scripted([
      { match: "discountCodeBasicCreate", body: { data: { discountCodeBasicCreate: { codeDiscountNode: { id: "gid://d/1" }, userErrors: [] } } } },
    ]);
    const r = await createInfluencerDiscountCode("riya.eats", deps);
    expect(r).toEqual({ code: "MUNCH-RIYAEA10", discount_id: "gid://d/1", adopted: false });
  });

  it("adopts its own code when TAKEN, else tries a suffix", async () => {
    const taken = { data: { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ code: "TAKEN", message: "Code must be unique" }] } } };
    const own = scripted([
      { match: "discountCodeBasicCreate", body: taken },
      { match: "codeDiscountNodeByCode", body: { data: { codeDiscountNodeByCode: { id: "gid://d/9", codeDiscount: { title: "PROMUNCH influencer @riya.eats" } } } } },
    ]);
    expect(await createInfluencerDiscountCode("riya.eats", own)).toEqual({ code: "MUNCH-RIYAEA10", discount_id: "gid://d/9", adopted: true });

    const other = scripted([
      { match: "discountCodeBasicCreate", body: taken },
      { match: "codeDiscountNodeByCode", body: { data: { codeDiscountNodeByCode: { id: "gid://d/2", codeDiscount: { title: "PROMUNCH influencer @riya.eatsalot" } } } } },
      { match: "discountCodeBasicCreate", body: { data: { discountCodeBasicCreate: { codeDiscountNode: { id: "gid://d/3" }, userErrors: [] } } } },
    ]);
    const r = await createInfluencerDiscountCode("riya.eats", { ...other, suffix: () => "Q7" });
    expect(r.code).toBe("MUNCH-RIYAEAQ710");
  });
});
