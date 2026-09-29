// Unique single-use Shopify discount codes for email flow steps.
//
// WHY: flow emails used one static code for everyone (PROMUNCH10 / WELCOME10 /
// COMEBACK15), which leaks to coupon sites. getOrCreateFlowCoupon mints one code
// per (enrollment, percent_off) via Admin GraphQL discountCodeBasicCreate.
//
// Safety model (mirrors the never-message-twice claim discipline):
//   - NEVER throws. Any failure (no token, missing write_discounts scope, API
//     error, 8s timeout, DB error) returns the caller's static fallbackCode.
//   - Atomic claim first: insert a 'pending' row into email_flow_coupons with
//     the code chosen up front. unique(enrollment_id, percent_off) means two
//     concurrent ticks can't both create a discount; the loser waits briefly for
//     the winner's code and otherwise uses the fallback.
//   - Retry reuses the stored code. A 'pending' row left by a crashed process
//     (> 5 min) is taken over atomically and re-created with the SAME code;
//     Shopify rejects duplicate codes, so we adopt the existing discount rather
//     than minting a second one.
//
// Token: SHOPIFY_ACCESS_TOKEN via getSecret() (Settings -> API keys, env
// fallback). If absent, the Dev Dashboard client-credentials pair
// SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET (same names as the edge side) is
// exchanged for a ~24h token. Needs the write_discounts scope.

export const SHOPIFY_DISCOUNT_API_VERSION = "2026-07";
const DEFAULT_STORE = "a1e4f4-2.myshopify.com";
const SHOPIFY_TIMEOUT_MS = 8_000;
const STALE_PENDING_MS = 5 * 60_000;
const LOSER_POLL_MS = [400, 800, 1200];

// No 0/O/1/I/L: codes get read off phone screens and typed by hand.
export const COUPON_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export type FlowCouponOpts = {
  // contactEmail is accepted for logging/future use; restricting a discount to
  // one buyer needs a Shopify customer id, so codes are open to all buyers but
  // single-use (usageLimit 1).
  enrollmentId: string;
  stepIndex: number;
  contactEmail: string;
  percentOff: number;
  expiresInDays: number;
  fallbackCode: string;
  prefix?: string;
};

export type CouponRow = {
  id: string;
  code: string;
  status: "pending" | "active" | "failed";
  claimed_at: string;
  shopify_discount_id?: string | null;
};

export type ClaimInput = {
  enrollment_id: string;
  step_index: number;
  percent_off: number;
  code: string;
  expires_at: string;
};

/** Persistence seam (service-role Supabase in prod, in-memory in tests). */
export interface CouponStore {
  find(enrollmentId: string, percentOff: number): Promise<CouponRow | null>;
  /** Atomic insert. "conflict" when (enrollment_id, percent_off) or code already exists. */
  insertClaim(row: ClaimInput): Promise<{ ok: true; row: CouponRow } | { ok: false; reason: "conflict" | "error"; message?: string }>;
  /** Atomically re-claim a stale pending row; returns the row only if this caller won. */
  takeoverStale(id: string, olderThanIso: string): Promise<CouponRow | null>;
  markActive(id: string, shopifyDiscountId: string | null): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

export type ShopifyCreateResult =
  | { ok: true; id: string | null }
  | { ok: false; duplicate: boolean; error: string };

export interface DiscountApi {
  /** null when no usable token is configured. */
  getToken(): Promise<string | null>;
  create(token: string, input: DiscountInput): Promise<ShopifyCreateResult>;
  findByCode(token: string, code: string): Promise<string | null>;
}

export type DiscountInput = {
  code: string;
  title: string;
  percentOff: number;
  startsAt: string;
  endsAt: string;
};

type Logger = Pick<Console, "warn" | "error">;

export type CouponDeps = {
  store: CouponStore;
  api: DiscountApi;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: (n: number) => Uint8Array;
  log?: Logger;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function defaultRandom(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

/** 8 chars from COUPON_ALPHABET, rejection-sampled so every char is equally likely. */
export function randomCouponSuffix(random: (n: number) => Uint8Array = defaultRandom, len = 8): string {
  const max = 256 - (256 % COUPON_ALPHABET.length);
  let out = "";
  while (out.length < len) {
    for (const b of random(len * 2)) {
      if (b >= max) continue;
      out += COUPON_ALPHABET[b % COUPON_ALPHABET.length];
      if (out.length === len) break;
    }
  }
  return out;
}

export function sanitizePrefix(prefix?: string): string {
  const p = (prefix ?? "PM").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return p || "PM";
}

export function generateCouponCode(prefix?: string, random?: (n: number) => Uint8Array): string {
  return `${sanitizePrefix(prefix)}-${randomCouponSuffix(random)}`;
}

export function buildDiscountVariables(input: DiscountInput) {
  return {
    basicCodeDiscount: {
      title: input.title,
      code: input.code,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      usageLimit: 1,
      appliesOncePerCustomer: true,
      context: { all: "ALL" },
      customerGets: {
        value: { percentage: Math.round(input.percentOff * 100) / 10_000 },
        items: { all: true },
      },
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
    },
  };
}

// ---------------------------------------------------------------------------
// Core (dependency-injected; the exported wrapper wires prod deps)
// ---------------------------------------------------------------------------

export async function getOrCreateFlowCouponWith(opts: FlowCouponOpts, deps: CouponDeps): Promise<string> {
  const log = deps.log ?? console;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fallback = opts.fallbackCode;
  const tag = `[flow-coupon enr=${opts.enrollmentId} pct=${opts.percentOff}]`;

  try {
    const pct = Number(opts.percentOff);
    const days = Number(opts.expiresInDays);
    if (!opts.enrollmentId || !Number.isFinite(pct) || pct <= 0 || pct > 100 || !Number.isFinite(days) || days <= 0) {
      log.warn(`${tag} invalid options, using fallback ${fallback}`);
      return fallback;
    }

    // 1. Already have one for this enrollment + percentage? Reuse it.
    let existing = await deps.store.find(opts.enrollmentId, pct);
    if (existing) {
      const resolved = await resolveExisting(existing, opts, deps, { log, now, sleep, tag });
      return resolved ?? fallback;
    }

    // 2. No token -> don't burn a claim row; a later tick can mint once configured.
    const token = await deps.api.getToken();
    if (!token) {
      log.warn(`${tag} no Shopify admin token configured, using fallback ${fallback}`);
      return fallback;
    }

    // 3. Atomic claim with the code chosen up front.
    const startsAt = new Date(now()).toISOString();
    const endsAt = new Date(now() + days * 86_400_000).toISOString();
    let claim: Awaited<ReturnType<CouponStore["insertClaim"]>> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateCouponCode(opts.prefix, deps.random);
      claim = await deps.store.insertClaim({
        enrollment_id: opts.enrollmentId,
        step_index: opts.stepIndex,
        percent_off: pct,
        code,
        expires_at: endsAt,
      });
      if (claim.ok || claim.reason === "error") break;
      // Conflict: either a concurrent tick claimed this enrollment (reuse theirs)
      // or an astronomically unlikely code collision (retry with a new code).
      existing = await deps.store.find(opts.enrollmentId, pct);
      if (existing) {
        const resolved = await resolveExisting(existing, opts, deps, { log, now, sleep, tag });
        return resolved ?? fallback;
      }
    }
    if (!claim || !claim.ok) {
      log.error(`${tag} claim insert failed (${claim && !claim.ok ? claim.message ?? claim.reason : "unknown"}), using fallback ${fallback}`);
      return fallback;
    }

    // 4. We own the claim: create in Shopify.
    return (await createForRow(claim.row, token, { ...opts, percentOff: pct }, startsAt, endsAt, deps, log, tag)) ?? fallback;
  } catch (e) {
    log.error(`${tag} unexpected error, using fallback ${fallback}:`, e instanceof Error ? e.message : e);
    return fallback;
  }
}

async function createForRow(
  row: CouponRow,
  token: string,
  opts: FlowCouponOpts,
  startsAt: string,
  endsAt: string,
  deps: CouponDeps,
  log: Logger,
  tag: string,
): Promise<string | null> {
  const prefix = sanitizePrefix(opts.prefix);
  const res = await deps.api.create(token, {
    code: row.code,
    title: `Email flow ${prefix} ${row.code}`,
    percentOff: opts.percentOff,
    startsAt,
    endsAt,
  });
  if (res.ok) {
    // The discount exists now; a failed bookkeeping write must not cost the
    // customer their code (a later takeover re-adopts it by code).
    await deps.store.markActive(row.id, res.id).catch((e) => log.error(`${tag} markActive failed:`, e instanceof Error ? e.message : e));
    return row.code;
  }
  if (res.duplicate) {
    // A previous (crashed / timed-out) attempt already created this exact code.
    const id = await deps.api.findByCode(token, row.code).catch(() => null);
    if (id) {
      await deps.store.markActive(row.id, id).catch((e) => log.error(`${tag} markActive failed:`, e instanceof Error ? e.message : e));
      return row.code;
    }
  }
  log.error(`${tag} Shopify discount create failed: ${res.error}`);
  await deps.store.markFailed(row.id, res.error.slice(0, 500)).catch(() => undefined);
  return null;
}

async function resolveExisting(
  row: CouponRow,
  opts: FlowCouponOpts,
  deps: CouponDeps,
  ctx: { log: Logger; now: () => number; sleep: (ms: number) => Promise<void>; tag: string },
): Promise<string | null> {
  if (row.status === "active") return row.code;
  if (row.status === "failed") return null; // consistent with what already went out

  // pending: either a concurrent tick is creating it right now, or it crashed.
  const age = ctx.now() - new Date(row.claimed_at).getTime();
  if (age > STALE_PENDING_MS) {
    const token = await deps.api.getToken();
    if (!token) return null;
    const won = await deps.store.takeoverStale(row.id, new Date(ctx.now() - STALE_PENDING_MS).toISOString());
    if (!won) return null;
    const startsAt = new Date(ctx.now()).toISOString();
    const endsAt = new Date(ctx.now() + Number(opts.expiresInDays) * 86_400_000).toISOString();
    return createForRow(won, token, { ...opts, percentOff: Number(opts.percentOff) }, startsAt, endsAt, deps, ctx.log, ctx.tag);
  }

  // Fresh pending: give the winner a moment to finish, never create a second one.
  for (const ms of LOSER_POLL_MS) {
    await ctx.sleep(ms);
    const again = await deps.store.find(opts.enrollmentId, Number(opts.percentOff));
    if (again?.status === "active") return again.code;
    if (!again || again.status === "failed") return null;
  }
  ctx.log.warn(`${ctx.tag} concurrent claim still pending, using fallback`);
  return null;
}

// ---------------------------------------------------------------------------
// Production deps
// ---------------------------------------------------------------------------

export function shopDomain(): string {
  const raw = (process.env.SHOPIFY_STORE_URL || DEFAULT_STORE).trim();
  return raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || DEFAULT_STORE;
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SHOPIFY_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

let ccCache: { token: string; exp: number } | null = null;

const CREATE_MUTATION = `mutation FlowCoupon($basicCodeDiscount: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
    codeDiscountNode { id }
    userErrors { field code message }
  }
}`;

const FIND_QUERY = `query FlowCouponByCode($code: String!) {
  codeDiscountNodeByCode(code: $code) { id }
}`;

export function createShopifyDiscountApi(opts: {
  fetchImpl?: typeof fetch;
  getSecret?: (name: string) => Promise<string | null>;
  domain?: string;
} = {}): DiscountApi {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const domain = opts.domain ?? shopDomain();
  const secret = opts.getSecret ?? (async (name: string) => (await import("@/lib/secrets")).getSecret(name));
  const gqlUrl = `https://${domain}/admin/api/${SHOPIFY_DISCOUNT_API_VERSION}/graphql.json`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Shopify GraphQL JSON, every access is optional-chained
  async function gql(token: string, query: string, variables: unknown): Promise<{ ok: boolean; status: number; json: any }> {
    const r = await fetchWithTimeout(fetchImpl, gqlUrl, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json };
  }

  return {
    async getToken() {
      try {
        const t = await secret("SHOPIFY_ACCESS_TOKEN");
        if (t && t !== "placeholder_needs_real_token") return t;
        const id = process.env.SHOPIFY_CLIENT_ID;
        const sec = process.env.SHOPIFY_CLIENT_SECRET;
        if (!id || !sec) return null;
        if (ccCache && ccCache.exp > Date.now() + 60_000) return ccCache.token;
        const r = await fetchWithTimeout(fetchImpl, `https://${domain}/admin/oauth/access_token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: sec }).toString(),
        });
        if (!r.ok) return null;
        const j = (await r.json()) as { access_token?: string; expires_in?: number };
        if (!j.access_token) return null;
        ccCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 86_399) * 1000 };
        return ccCache.token;
      } catch {
        return null;
      }
    },

    async create(token, input) {
      try {
        const { ok, status, json } = await gql(token, CREATE_MUTATION, buildDiscountVariables(input));
        if (!ok) {
          const hint = status === 401 || status === 403 ? " (token lacks write_discounts scope or is invalid)" : "";
          return { ok: false, duplicate: false, error: `HTTP ${status}${hint}: ${JSON.stringify(json?.errors ?? json).slice(0, 300)}` };
        }
        if (Array.isArray(json?.errors) && json.errors.length) {
          const msg = JSON.stringify(json.errors).slice(0, 300);
          const scope = /access denied|write_discounts/i.test(msg) ? " (missing write_discounts scope)" : "";
          return { ok: false, duplicate: false, error: `GraphQL${scope}: ${msg}` };
        }
        const payload = json?.data?.discountCodeBasicCreate;
        const userErrors: { code?: string; message?: string }[] = payload?.userErrors ?? [];
        if (userErrors.length) {
          const duplicate = userErrors.some((u) => u.code === "TAKEN" || /taken|already|unique/i.test(u.message ?? ""));
          return { ok: false, duplicate, error: `userErrors: ${JSON.stringify(userErrors).slice(0, 300)}` };
        }
        const id = payload?.codeDiscountNode?.id ?? null;
        if (!id) return { ok: false, duplicate: false, error: "no codeDiscountNode in response" };
        return { ok: true, id };
      } catch (e) {
        const aborted = e instanceof Error && e.name === "AbortError";
        return { ok: false, duplicate: false, error: aborted ? `timeout after ${SHOPIFY_TIMEOUT_MS}ms` : String(e instanceof Error ? e.message : e) };
      }
    },

    async findByCode(token, code) {
      try {
        const { ok, json } = await gql(token, FIND_QUERY, { code });
        return ok ? (json?.data?.codeDiscountNodeByCode?.id ?? null) : null;
      } catch {
        return null;
      }
    },
  };
}

const COLS = "id,code,status,claimed_at,shopify_discount_id";

export function createSupabaseCouponStore(): CouponStore {
  const db = async () => (await import("@/lib/supabase-admin")).supabaseAdmin;
  return {
    async find(enrollmentId, percentOff) {
      const { data, error } = await (await db())
        .from("email_flow_coupons")
        .select(COLS)
        .eq("enrollment_id", enrollmentId)
        .eq("percent_off", percentOff)
        .maybeSingle();
      if (error) throw new Error(`email_flow_coupons find: ${error.message}`);
      return (data as CouponRow | null) ?? null;
    },
    async insertClaim(row) {
      const { data, error } = await (await db())
        .from("email_flow_coupons")
        .insert({ ...row, status: "pending", claimed_at: new Date().toISOString() })
        .select(COLS)
        .single();
      if (error) return { ok: false, reason: error.code === "23505" ? "conflict" : "error", message: error.message };
      return { ok: true, row: data as CouponRow };
    },
    async takeoverStale(id, olderThanIso) {
      const { data, error } = await (await db())
        .from("email_flow_coupons")
        .update({ claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "pending")
        .lt("claimed_at", olderThanIso)
        .select(COLS)
        .maybeSingle();
      if (error) return null;
      return (data as CouponRow | null) ?? null;
    },
    async markActive(id, shopifyDiscountId) {
      const { error } = await (await db())
        .from("email_flow_coupons")
        .update({ status: "active", shopify_discount_id: shopifyDiscountId, error: null, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(`email_flow_coupons markActive: ${error.message}`);
    },
    async markFailed(id, err) {
      await (await db())
        .from("email_flow_coupons")
        .update({ status: "failed", error: err, updated_at: new Date().toISOString() })
        .eq("id", id);
    },
  };
}

/**
 * Unique single-use discount code for one flow enrollment. Never throws:
 * returns opts.fallbackCode on any failure.
 */
export async function getOrCreateFlowCoupon(opts: FlowCouponOpts): Promise<string> {
  try {
    return await getOrCreateFlowCouponWith(opts, {
      store: createSupabaseCouponStore(),
      api: createShopifyDiscountApi(),
    });
  } catch (e) {
    console.error("[flow-coupon] fatal, using fallback:", e instanceof Error ? e.message : e);
    return opts.fallbackCode;
  }
}
