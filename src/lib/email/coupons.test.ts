import { describe, expect, it, vi } from "vitest";
import {
  COUPON_ALPHABET,
  buildDiscountVariables,
  createShopifyDiscountApi,
  generateCouponCode,
  getOrCreateFlowCouponWith,
  randomCouponSuffix,
  type ClaimInput,
  type CouponDeps,
  type CouponRow,
  type CouponStore,
  type DiscountApi,
  type FlowCouponOpts,
} from "./coupons";

const NOW = Date.parse("2026-09-30T06:00:00Z");
const silent = { warn: vi.fn(), error: vi.fn() };

const baseOpts: FlowCouponOpts = {
  enrollmentId: "enr-1",
  stepIndex: 1,
  contactEmail: "a@example.com",
  percentOff: 10,
  expiresInDays: 7,
  fallbackCode: "WELCOME10",
  prefix: "WELCOME",
};

type MemRow = CouponRow & ClaimInput;

/** In-memory store with the same atomicity as the unique index. */
function memStore(seed: MemRow[] = []) {
  const rows: MemRow[] = [...seed];
  let seq = rows.length;
  const store: CouponStore = {
    async find(enr, pct) {
      return rows.find((r) => r.enrollment_id === enr && r.percent_off === pct) ?? null;
    },
    async insertClaim(row) {
      if (rows.some((r) => (r.enrollment_id === row.enrollment_id && r.percent_off === row.percent_off) || r.code === row.code)) {
        return { ok: false, reason: "conflict" };
      }
      const r: MemRow = { ...row, id: `row-${++seq}`, status: "pending", claimed_at: new Date(NOW).toISOString() };
      rows.push(r);
      return { ok: true, row: r };
    },
    async takeoverStale(id, olderThan) {
      const r = rows.find((x) => x.id === id && x.status === "pending" && x.claimed_at < olderThan);
      if (!r) return null;
      r.claimed_at = new Date(NOW).toISOString();
      return r;
    },
    async markActive(id, sid) {
      const r = rows.find((x) => x.id === id)!;
      r.status = "active";
      r.shopify_discount_id = sid;
    },
    async markFailed(id) {
      rows.find((x) => x.id === id)!.status = "failed";
    },
  };
  return { store, rows };
}

function fakeApi(overrides: Partial<DiscountApi> = {}) {
  const create = vi.fn<DiscountApi["create"]>(async () => ({ ok: true, id: "gid://shopify/DiscountCodeNode/1" }));
  const api: DiscountApi = {
    getToken: async () => "shpat_test",
    create,
    findByCode: async () => null,
    ...overrides,
  };
  return { api, create: (overrides.create as typeof create) ?? create };
}

function deps(store: CouponStore, api: DiscountApi, extra: Partial<CouponDeps> = {}): CouponDeps {
  return { store, api, now: () => NOW, sleep: async () => {}, log: silent, ...extra };
}

describe("code generation", () => {
  it("uses prefix + 8 unambiguous uppercase alnum chars", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCouponCode("welcome");
      expect(code).toMatch(/^WELCOME-[A-Z0-9]{8}$/);
      for (const ch of code.split("-")[1]) expect(COUPON_ALPHABET).toContain(ch);
      expect(code).not.toMatch(/-.*[01OIL]/);
    }
  });

  it("defaults prefix to PM and strips junk", () => {
    expect(generateCouponCode()).toMatch(/^PM-[A-Z0-9]{8}$/);
    expect(generateCouponCode("  ")).toMatch(/^PM-/);
    expect(generateCouponCode("come back!")).toMatch(/^COMEBACK-/);
  });

  it("rejection-samples bytes outside the unbiased range", () => {
    // 255 is >= 248 (largest multiple of 31 below 256) so it must be skipped.
    let call = 0;
    const random = (n: number) => {
      call++;
      return call === 1 ? new Uint8Array(n).fill(255) : new Uint8Array(n).fill(0);
    };
    expect(randomCouponSuffix(random)).toBe("AAAAAAAA");
  });

  it("builds a single-use, non-combinable percentage discount", () => {
    const v = buildDiscountVariables({ code: "PM-ABCDEFGH", title: "Email flow PM PM-ABCDEFGH", percentOff: 15, startsAt: "s", endsAt: "e" });
    expect(v.basicCodeDiscount).toMatchObject({
      code: "PM-ABCDEFGH",
      usageLimit: 1,
      appliesOncePerCustomer: true,
      context: { all: "ALL" },
      customerGets: { value: { percentage: 0.15 }, items: { all: true } },
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
    });
    expect(v.basicCodeDiscount).not.toHaveProperty("minimumRequirement");
  });
});

describe("getOrCreateFlowCouponWith", () => {
  it("claims, creates in Shopify, marks active, returns the unique code", async () => {
    const { store, rows } = memStore();
    const { api, create } = fakeApi();
    const code = await getOrCreateFlowCouponWith(baseOpts, deps(store, api));
    expect(code).toMatch(/^WELCOME-[A-Z0-9]{8}$/);
    expect(create).toHaveBeenCalledTimes(1);
    const input = create.mock.calls[0][1];
    expect(input.code).toBe(code);
    expect(input.title).toBe(`Email flow WELCOME ${code}`);
    expect(input.endsAt).toBe(new Date(NOW + 7 * 86_400_000).toISOString());
    expect(rows[0]).toMatchObject({ status: "active", code, shopify_discount_id: "gid://shopify/DiscountCodeNode/1" });
  });

  it("is idempotent: a retry reuses the stored code without calling Shopify", async () => {
    const { store } = memStore();
    const { api, create } = fakeApi();
    const a = await getOrCreateFlowCouponWith(baseOpts, deps(store, api));
    const b = await getOrCreateFlowCouponWith({ ...baseOpts, stepIndex: 2 }, deps(store, api));
    expect(b).toBe(a);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a different percentage gets its own code", async () => {
    const { store } = memStore();
    const { api, create } = fakeApi();
    const a = await getOrCreateFlowCouponWith(baseOpts, deps(store, api));
    const b = await getOrCreateFlowCouponWith({ ...baseOpts, percentOff: 15 }, deps(store, api));
    expect(b).not.toBe(a);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("concurrent ticks create exactly one discount", async () => {
    const { store } = memStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const create = vi.fn<DiscountApi["create"]>(async () => {
      await gate;
      return { ok: true, id: "gid://x/1" };
    });
    const { api } = fakeApi({ create });
    // Loser's poll releases the winner, then sees 'active'.
    const sleep = async () => release();
    const [a, b] = await Promise.all([
      getOrCreateFlowCouponWith(baseOpts, deps(store, api, { sleep })),
      getOrCreateFlowCouponWith(baseOpts, deps(store, api, { sleep })),
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a).toMatch(/^WELCOME-/);
  });

  it("loser falls back (never creates) when the winner stays pending", async () => {
    const { store } = memStore([
      { id: "r1", enrollment_id: "enr-1", percent_off: 10, step_index: 1, code: "WELCOME-AAAAAAAA", expires_at: "", status: "pending", claimed_at: new Date(NOW - 1000).toISOString() },
    ]);
    const { api, create } = fakeApi();
    expect(await getOrCreateFlowCouponWith(baseOpts, deps(store, api))).toBe("WELCOME10");
    expect(create).not.toHaveBeenCalled();
  });

  it("takes over a stale pending claim with the SAME code and adopts a duplicate", async () => {
    const { store, rows } = memStore([
      { id: "r1", enrollment_id: "enr-1", percent_off: 10, step_index: 1, code: "WELCOME-BBBBBBBB", expires_at: "", status: "pending", claimed_at: new Date(NOW - 10 * 60_000).toISOString() },
    ]);
    const create = vi.fn<DiscountApi["create"]>(async () => ({ ok: false, duplicate: true, error: "taken" }));
    const { api } = fakeApi({ create, findByCode: async () => "gid://existing" });
    expect(await getOrCreateFlowCouponWith(baseOpts, deps(store, api))).toBe("WELCOME-BBBBBBBB");
    expect(create.mock.calls[0][1].code).toBe("WELCOME-BBBBBBBB");
    expect(rows[0]).toMatchObject({ status: "active", shopify_discount_id: "gid://existing" });
  });

  it("falls back without claiming when no token is configured", async () => {
    const { store, rows } = memStore();
    const { api, create } = fakeApi({ getToken: async () => null });
    expect(await getOrCreateFlowCouponWith(baseOpts, deps(store, api))).toBe("WELCOME10");
    expect(create).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("falls back and marks failed on Shopify error; later calls stay on fallback", async () => {
    const { store, rows } = memStore();
    const create = vi.fn<DiscountApi["create"]>(async () => ({ ok: false, duplicate: false, error: "HTTP 403 (token lacks write_discounts scope or is invalid)" }));
    const { api } = fakeApi({ create });
    expect(await getOrCreateFlowCouponWith(baseOpts, deps(store, api))).toBe("WELCOME10");
    expect(rows[0].status).toBe("failed");
    expect(await getOrCreateFlowCouponWith(baseOpts, deps(store, api))).toBe("WELCOME10");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("never throws: store explosions return the fallback", async () => {
    const { api } = fakeApi();
    const broken = memStore().store;
    broken.find = async () => {
      throw new Error("db down");
    };
    expect(await getOrCreateFlowCouponWith(baseOpts, deps(broken, api))).toBe("WELCOME10");
  });

  it("returns the code even if the markActive write fails after Shopify created it", async () => {
    const { store } = memStore();
    store.markActive = async () => {
      throw new Error("write failed");
    };
    const { api } = fakeApi();
    expect(await getOrCreateFlowCouponWith(baseOpts, deps(store, api))).toMatch(/^WELCOME-/);
  });

  it("rejects invalid options with the fallback", async () => {
    const { store } = memStore();
    const { api, create } = fakeApi();
    expect(await getOrCreateFlowCouponWith({ ...baseOpts, percentOff: 0 }, deps(store, api))).toBe("WELCOME10");
    expect(await getOrCreateFlowCouponWith({ ...baseOpts, expiresInDays: -1 }, deps(store, api))).toBe("WELCOME10");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("createShopifyDiscountApi (mocked fetch)", () => {
  const input = { code: "PM-ABCDEFGH", title: "t", percentOff: 10, startsAt: "s", endsAt: "e" };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("posts the mutation to the pinned GraphQL endpoint and returns the node id", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      json({ data: { discountCodeBasicCreate: { codeDiscountNode: { id: "gid://1" }, userErrors: [] } } }));
    const api = createShopifyDiscountApi({ fetchImpl: fetchImpl as unknown as typeof fetch, domain: "shop.myshopify.com", getSecret: async () => "tok" });
    expect(await api.getToken()).toBe("tok");
    expect(await api.create("tok", input)).toEqual({ ok: true, id: "gid://1" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/shop\.myshopify\.com\/admin\/api\/\d{4}-\d{2}\/graphql\.json$/);
    expect((init?.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("tok");
    expect(JSON.parse(String(init?.body)).variables.basicCodeDiscount.code).toBe("PM-ABCDEFGH");
  });

  it("flags duplicate-code userErrors and access-denied errors", async () => {
    const dup = createShopifyDiscountApi({
      fetchImpl: (async () => json({ data: { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ code: "TAKEN", message: "Code must be unique" }] } } })) as unknown as typeof fetch,
      domain: "d", getSecret: async () => "tok",
    });
    expect(await dup.create("tok", input)).toMatchObject({ ok: false, duplicate: true });

    const denied = createShopifyDiscountApi({
      fetchImpl: (async () => json({ errors: [{ message: "Access denied for discountCodeBasicCreate field. Required access: `write_discounts`" }] })) as unknown as typeof fetch,
      domain: "d", getSecret: async () => "tok",
    });
    const r = await denied.create("tok", input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/write_discounts/);
  });

  it("never throws on network failure", async () => {
    const api = createShopifyDiscountApi({
      fetchImpl: (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
      domain: "d", getSecret: async () => "tok",
    });
    expect(await api.create("tok", input)).toMatchObject({ ok: false, duplicate: false });
    expect(await api.findByCode("tok", "X")).toBeNull();
  });

  it("returns null token when neither access token nor client credentials exist", async () => {
    const prev = [process.env.SHOPIFY_CLIENT_ID, process.env.SHOPIFY_CLIENT_SECRET];
    delete process.env.SHOPIFY_CLIENT_ID;
    delete process.env.SHOPIFY_CLIENT_SECRET;
    try {
      const api = createShopifyDiscountApi({ fetchImpl: vi.fn() as unknown as typeof fetch, domain: "d", getSecret: async () => "placeholder_needs_real_token" });
      expect(await api.getToken()).toBeNull();
    } finally {
      if (prev[0] !== undefined) process.env.SHOPIFY_CLIENT_ID = prev[0];
      if (prev[1] !== undefined) process.env.SHOPIFY_CLIENT_SECRET = prev[1];
    }
  });
});
