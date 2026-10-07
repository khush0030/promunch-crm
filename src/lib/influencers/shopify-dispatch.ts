// Influencer kit dispatch as a Shopify ₹0 order, plus the creator's personal
// discount code. Admin GraphQL, same API version + token path as the email
// coupon minter (src/lib/email/coupons.ts): SHOPIFY_ACCESS_TOKEN via
// getSecret(), else the Dev Dashboard client-credentials pair.
//
// Order flow: draftOrderCreate (kit lines, 100% applied discount, free
// "Influencer kit" shipping line, tags Influencer + influencer:<handle>, note
// with the deal code) -> draftOrderComplete (no paymentGatewayId; the
// deprecated paymentPending defaults to false, so the ₹0 order is marked paid
// and can never look like COD).
//
// NEVER SHIP TWICE: one draft can complete into at most one order, so the
// draft id is the idempotency key. The caller persists it (onDraftCreated) in
// the deal's dispatch lock and passes it back as resumeDraftId on a retry; we
// then re-read / re-complete that same draft instead of making a new one.
//
// SCOPES: draftOrderCreate / draftOrderComplete / draftOrderDelete need
// write_draft_orders (shopify-app/shopify.app.toml has only read_draft_orders
// today). discountCodeBasicCreate needs write_discounts (present).
//
// Pure helpers (payload builders, address validator, code formatter) are
// exported for tests; nothing here imports server-only modules at load time.

import type { Deal, Influencer, InfluencerAddress, Kit } from "./types";

export const SHOPIFY_DISPATCH_API_VERSION = "2026-07";
const DEFAULT_STORE = "a1e4f4-2.myshopify.com";
const SHOPIFY_TIMEOUT_MS = 15_000;

export const INFLUENCER_ORDER_TAG = "Influencer";
export const BARTER_DISCOUNT_TITLE = "PROMUNCH influencer barter";
export const KIT_SHIPPING_TITLE = "Influencer kit";

// ---------------------------------------------------------------------------
// Address validation
// ---------------------------------------------------------------------------

export type DispatchAddressField = "name" | "line1" | "city" | "state" | "pincode" | "phone";

export interface DispatchAddressCheck {
  ok: boolean;
  missing: DispatchAddressField[];
  /** Cleaned values, safe to send to Shopify when ok. */
  address: {
    name: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    pincode: string;
    phone: string; // digits with country code, e.g. 919876543210
  };
}

const trimOrEmpty = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function phoneDigits(raw: unknown): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : "";
}

/**
 * line1, city, state, a 6-digit Indian pincode (first digit 1-9) and a phone
 * are required. Name falls back to the creator's full name / handle; phone
 * falls back to the creator's phone.
 */
export function validateDispatchAddress(
  addr: Partial<InfluencerAddress> | null | undefined,
  fallback: { name?: string | null; phone?: string | null } = {},
): DispatchAddressCheck {
  const a = addr ?? {};
  const name = trimOrEmpty(a.name) || trimOrEmpty(fallback.name);
  const line1 = trimOrEmpty(a.line1);
  const line2 = trimOrEmpty(a.line2) || null;
  const city = trimOrEmpty(a.city);
  const state = trimOrEmpty(a.state);
  const pincode = String(a.pincode ?? "").replace(/\s+/g, "");
  const phone = phoneDigits(a.phone) || phoneDigits(fallback.phone);

  const missing: DispatchAddressField[] = [];
  if (!name) missing.push("name");
  if (!line1) missing.push("line1");
  if (!city) missing.push("city");
  if (!state) missing.push("state");
  if (!/^[1-9]\d{5}$/.test(pincode)) missing.push("pincode");
  if (!phone) missing.push("phone");

  return { ok: missing.length === 0, missing, address: { name, line1, line2, city, state, pincode, phone } };
}

// Shopify's province codes for India (MailingAddressInput.provinceCode). A
// name we can't map goes as free-text `province`, which Shopify also accepts.
const IN_PROVINCES: Record<string, string> = {
  "andaman and nicobar islands": "AN",
  "andhra pradesh": "AP",
  "arunachal pradesh": "AR",
  assam: "AS",
  bihar: "BR",
  chandigarh: "CH",
  chhattisgarh: "CG",
  "dadra and nagar haveli": "DN",
  "dadra and nagar haveli and daman and diu": "DN",
  "daman and diu": "DD",
  delhi: "DL",
  "new delhi": "DL",
  goa: "GA",
  gujarat: "GJ",
  haryana: "HR",
  "himachal pradesh": "HP",
  "jammu and kashmir": "JK",
  jharkhand: "JH",
  karnataka: "KA",
  kerala: "KL",
  ladakh: "LA",
  lakshadweep: "LD",
  "madhya pradesh": "MP",
  maharashtra: "MH",
  manipur: "MN",
  meghalaya: "ML",
  mizoram: "MZ",
  nagaland: "NL",
  odisha: "OR",
  orissa: "OR",
  puducherry: "PY",
  pondicherry: "PY",
  punjab: "PB",
  rajasthan: "RJ",
  sikkim: "SK",
  "tamil nadu": "TN",
  telangana: "TS",
  tripura: "TR",
  "uttar pradesh": "UP",
  uttarakhand: "UK",
  uttaranchal: "UK",
  "west bengal": "WB",
};
const IN_CODES = new Set(Object.values(IN_PROVINCES));

export function indianProvinceCode(state: string): string | null {
  const s = state.trim();
  if (/^[A-Za-z]{2}$/.test(s) && IN_CODES.has(s.toUpperCase())) return s.toUpperCase();
  const key = s.toLowerCase().replace(/&/g, "and").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return IN_PROVINCES[key] ?? null;
}

// ---------------------------------------------------------------------------
// Draft order payload
// ---------------------------------------------------------------------------

/** "123", 123, or a gid -> gid://shopify/ProductVariant/123. null when unusable. */
export function toVariantGid(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/ProductVariant/${s}`;
  return null;
}

export interface DraftOrderBuildInput {
  deal: Pick<Deal, "id" | "code">;
  influencer: Pick<Influencer, "handle" | "full_name" | "email" | "phone">;
  address: DispatchAddressCheck["address"];
  kit: Pick<Kit, "name" | "items">;
}

function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0] ?? full, lastName: parts.slice(1).join(" ") || null };
}

/** Variables for draftOrderCreate(input: DraftOrderInput!). Throws on an unusable kit. */
export function buildDraftOrderInput(i: DraftOrderBuildInput) {
  const lineItems: { variantId: string; quantity: number }[] = [];
  const bad: string[] = [];
  for (const it of i.kit.items ?? []) {
    const variantId = toVariantGid(it?.variant_id);
    const quantity = Math.floor(Number(it?.qty ?? 0));
    if (!variantId || !(quantity >= 1)) {
      bad.push(String(it?.title ?? it?.variant_id ?? "item"));
      continue;
    }
    const prev = lineItems.find((l) => l.variantId === variantId);
    if (prev) prev.quantity += quantity;
    else lineItems.push({ variantId, quantity });
  }
  if (bad.length) throw new Error(`kit has items without a valid Shopify variant id or qty: ${bad.join(", ")}`);
  if (!lineItems.length) throw new Error("kit has no items");

  const handle = i.influencer.handle.toLowerCase();
  const { firstName, lastName } = splitName(i.address.name);
  const provinceCode = indianProvinceCode(i.address.state);
  const phoneE164 = `+${i.address.phone}`;
  const email = trimOrEmpty(i.influencer.email);

  const shippingAddress: Record<string, string | null> = {
    firstName,
    lastName,
    address1: i.address.line1,
    address2: i.address.line2,
    city: i.address.city,
    zip: i.address.pincode,
    countryCode: "IN",
    phone: phoneE164,
  };
  if (provinceCode) shippingAddress.provinceCode = provinceCode;
  else shippingAddress.province = i.address.state;

  const input: Record<string, unknown> = {
    lineItems,
    appliedDiscount: {
      title: BARTER_DISCOUNT_TITLE,
      description: `Barter collab @${handle}`,
      value: 100,
      valueType: "PERCENTAGE",
    },
    shippingAddress,
    phone: phoneE164,
    tags: [INFLUENCER_ORDER_TAG, `influencer:${handle}`],
    note: `PROMUNCH influencer kit (barter). Deal ${i.deal.code}. Creator @${handle}. Kit: ${i.kit.name}. Not a sale: do not count as revenue.`,
    shippingLine: {
      title: KIT_SHIPPING_TITLE,
      priceWithCurrency: { amount: "0.00", currencyCode: "INR" },
    },
  };
  if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) input.email = email;
  return { input };
}

// ---------------------------------------------------------------------------
// Discount code
// ---------------------------------------------------------------------------

/** "@foo.bar_99" -> "MUNCH-FOOBAR10". suffix (collision retry) goes before the "10". */
export function formatInfluencerDiscountCode(handle: string, suffix = ""): string {
  const h6 = handle.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "PAL";
  const sfx = suffix.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `MUNCH-${h6}${sfx}10`;
}

export function influencerDiscountTitle(handle: string): string {
  return `PROMUNCH influencer @${handle.toLowerCase()}`;
}

/** discountCodeBasicCreate variables: 10% off everything, once per customer, no end date. */
export function buildInfluencerDiscountVariables(code: string, handle: string, startsAt: string) {
  return {
    basicCodeDiscount: {
      title: influencerDiscountTitle(handle),
      code,
      startsAt,
      endsAt: null,
      appliesOncePerCustomer: true,
      context: { all: "ALL" },
      customerGets: { value: { percentage: 0.1 }, items: { all: true } },
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
    },
  };
}

// ---------------------------------------------------------------------------
// Ops ping text
// ---------------------------------------------------------------------------

export function buildOpsDispatchMessage(o: { handle: string; kitName: string; orderName: string; city: string; pincode: string }): string {
  return `Influencer kit to ship: @${o.handle}, ${o.kitName}, order ${o.orderName}, ${o.city} ${o.pincode}`;
}

// ---------------------------------------------------------------------------
// Admin GraphQL client (injectable for tests)
// ---------------------------------------------------------------------------

export interface ShopifyGqlDeps {
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string | null>;
  domain?: string;
}

export class ShopifyDispatchError extends Error {
  /** true when Shopify may have acted (timeout / network / 5xx after send) */
  ambiguous: boolean;
  constructor(message: string, ambiguous = false) {
    super(message);
    this.name = "ShopifyDispatchError";
    this.ambiguous = ambiguous;
  }
}

function shopDomain(): string {
  const raw = (process.env.SHOPIFY_STORE_URL || DEFAULT_STORE).trim();
  return raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || DEFAULT_STORE;
}

async function defaultGetToken(): Promise<string | null> {
  // Reuse the coupon minter's token logic (secret, else client credentials).
  const { createShopifyDiscountApi } = await import("@/lib/email/coupons");
  return createShopifyDiscountApi().getToken();
}

type UserError = { field?: string[] | null; message?: string; code?: string | null };

function userErrorText(errs: UserError[]): string {
  return errs
    .map((e) => `${(e.field ?? []).join(".") || "input"}: ${e.message ?? e.code ?? "error"}`)
    .join("; ")
    .slice(0, 500);
}

function makeGql(deps: ShopifyGqlDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const domain = deps.domain ?? shopDomain();
  const url = `https://${domain}/admin/api/${SHOPIFY_DISPATCH_API_VERSION}/graphql.json`;
  const getToken = deps.getToken ?? defaultGetToken;
  let token: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Shopify GraphQL JSON; every access is optional-chained
  return async function gql(query: string, variables: unknown, scopeHint: string): Promise<any> {
    token = token ?? (await getToken());
    if (!token) throw new ShopifyDispatchError("Shopify Admin token not configured (SHOPIFY_ACCESS_TOKEN or SHOPIFY_CLIENT_ID/SECRET)");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SHOPIFY_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: ctrl.signal,
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      throw new ShopifyDispatchError(aborted ? `Shopify timed out after ${SHOPIFY_TIMEOUT_MS}ms` : `Shopify request failed: ${e instanceof Error ? e.message : String(e)}`, true);
    } finally {
      clearTimeout(timer);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? ` (token invalid or missing ${scopeHint} scope)` : "";
      throw new ShopifyDispatchError(`Shopify HTTP ${res.status}${hint}: ${JSON.stringify(json?.errors ?? json).slice(0, 300)}`, res.status >= 500);
    }
    if (Array.isArray(json?.errors) && json.errors.length) {
      const msg = JSON.stringify(json.errors).slice(0, 300);
      const scope = /access denied|scope/i.test(msg) ? ` (missing ${scopeHint} scope)` : "";
      throw new ShopifyDispatchError(`Shopify GraphQL error${scope}: ${msg}`);
    }
    return json?.data ?? {};
  };
}

const DRAFT_CREATE = `mutation InfluencerDraft($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder { id }
    userErrors { field message }
  }
}`;

const DRAFT_COMPLETE = `mutation InfluencerDraftComplete($id: ID!) {
  draftOrderComplete(id: $id) {
    draftOrder { id status order { id name statusPageUrl } }
    userErrors { field message }
  }
}`;

const DRAFT_READ = `query InfluencerDraftRead($id: ID!) {
  draftOrder(id: $id) { id status order { id name statusPageUrl } }
}`;

const DRAFT_DELETE = `mutation InfluencerDraftDelete($input: DraftOrderDeleteInput!) {
  draftOrderDelete(input: $input) { deletedId userErrors { field message } }
}`;

export interface InfluencerOrderResult {
  order_id: string; // numeric Shopify order id (matches shopify_orders.shopify_id)
  order_gid: string;
  order_name: string;
  order_status_url: string | null;
  draft_order_id: string;
}

type OrderNode = { id?: string; name?: string; statusPageUrl?: string | null } | null | undefined;

function toResult(order: OrderNode, draftId: string): InfluencerOrderResult | null {
  if (!order?.id) return null;
  return {
    order_id: order.id.replace(/^gid:\/\/shopify\/Order\//, ""),
    order_gid: order.id,
    order_name: order.name ?? order.id,
    order_status_url: order.statusPageUrl ?? null,
    draft_order_id: draftId,
  };
}

export interface CreateInfluencerOrderArgs {
  deal: Pick<Deal, "id" | "code">;
  influencer: Pick<Influencer, "handle" | "full_name" | "email" | "phone">;
  address: Partial<InfluencerAddress> | null;
  kit: Pick<Kit, "name" | "items">;
  /** A draft created by an earlier interrupted attempt: complete / adopt it, never make a new one. */
  resumeDraftId?: string | null;
  /** Called right after the draft exists, before completion, so the caller can persist it. */
  onDraftCreated?: (draftId: string) => Promise<void>;
}

/**
 * Creates (or resumes) the ₹0 influencer order. Throws ShopifyDispatchError;
 * `.ambiguous` true means Shopify may have created the order, so the caller
 * must keep its lock and retry with resumeDraftId instead of starting over.
 * On a definite failure after the draft was made, the draft is deleted
 * (best effort) so no orphan draft lingers.
 */
export async function createInfluencerOrder(args: CreateInfluencerOrderArgs, deps: ShopifyGqlDeps = {}): Promise<InfluencerOrderResult> {
  const gql = makeGql(deps);
  const scope = "write_draft_orders";

  let draftId = args.resumeDraftId ?? null;
  if (draftId) {
    // Resume: if the earlier attempt already completed it, adopt that order.
    const data = await gql(DRAFT_READ, { id: draftId }, "read_draft_orders");
    const done = toResult(data?.draftOrder?.order, draftId);
    if (done) return done;
    if (!data?.draftOrder) draftId = null; // deleted in Shopify: safe to start over
  }

  if (!draftId) {
    const check = validateDispatchAddress(args.address, { name: args.influencer.full_name ?? args.influencer.handle, phone: args.influencer.phone });
    if (!check.ok) throw new ShopifyDispatchError(`address incomplete: ${check.missing.join(", ")}`);
    const variables = buildDraftOrderInput({ deal: args.deal, influencer: args.influencer, address: check.address, kit: args.kit });
    const data = await gql(DRAFT_CREATE, variables, scope);
    const errs: UserError[] = data?.draftOrderCreate?.userErrors ?? [];
    if (errs.length) throw new ShopifyDispatchError(`Shopify rejected the draft order: ${userErrorText(errs)}`);
    draftId = data?.draftOrderCreate?.draftOrder?.id ?? null;
    if (!draftId) throw new ShopifyDispatchError("Shopify returned no draft order id", true);
    if (args.onDraftCreated) {
      try {
        await args.onDraftCreated(draftId);
      } catch (e) {
        // Could not record the draft: drop it so nothing untracked can complete.
        await gql(DRAFT_DELETE, { input: { id: draftId } }, scope).catch(() => null);
        throw new ShopifyDispatchError(`could not record draft order: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  try {
    const data = await gql(DRAFT_COMPLETE, { id: draftId }, scope);
    const errs: UserError[] = data?.draftOrderComplete?.userErrors ?? [];
    const done = toResult(data?.draftOrderComplete?.draftOrder?.order, draftId);
    if (done) return done;
    if (errs.length) {
      // "already completed" from a racing resume: adopt whatever order exists.
      const again = await gql(DRAFT_READ, { id: draftId }, "read_draft_orders").catch(() => null);
      const adopted = toResult(again?.draftOrder?.order, draftId);
      if (adopted) return adopted;
      throw new ShopifyDispatchError(`Shopify could not complete the draft order: ${userErrorText(errs)}`);
    }
    throw new ShopifyDispatchError("Shopify completed the draft but returned no order", true);
  } catch (e) {
    const err = e instanceof ShopifyDispatchError ? e : new ShopifyDispatchError(String(e), true);
    if (err.ambiguous) {
      // One more read: did it complete after all?
      const again = await gql(DRAFT_READ, { id: draftId }, "read_draft_orders").catch(() => null);
      const adopted = toResult(again?.draftOrder?.order, draftId);
      if (adopted) return adopted;
      if (again?.draftOrder && again.draftOrder.status !== "COMPLETED") {
        // Definitely not completed: fall through to a definite failure.
        err.ambiguous = false;
      } else {
        throw err;
      }
    }
    await gql(DRAFT_DELETE, { input: { id: draftId } }, scope).catch(() => null);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Discount code creation
// ---------------------------------------------------------------------------

const DISCOUNT_CREATE = `mutation InfluencerCode($basicCodeDiscount: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
    codeDiscountNode { id }
    userErrors { field code message }
  }
}`;

const DISCOUNT_BY_CODE = `query InfluencerCodeLookup($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    id
    codeDiscount { ... on DiscountCodeBasic { title } }
  }
}`;

const COLLISION_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomSuffix(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(2));
  return COLLISION_ALPHABET[b[0] % COLLISION_ALPHABET.length] + COLLISION_ALPHABET[b[1] % COLLISION_ALPHABET.length];
}

/**
 * Creates MUNCH-<HANDLE6>10 (10% off, once per customer, no end date). When
 * the code already exists in Shopify and carries THIS creator's title (an
 * earlier attempt whose DB write was lost), it is adopted; when it belongs to
 * someone else, a 2-char suffix is tried. Idempotency against the DB
 * (influencers.discount_code) is the caller's job.
 */
export async function createInfluencerDiscountCode(
  handle: string,
  deps: ShopifyGqlDeps & { now?: () => number; suffix?: () => string } = {},
): Promise<{ code: string; discount_id: string | null; adopted: boolean }> {
  const gql = makeGql(deps);
  const title = influencerDiscountTitle(handle);
  const startsAt = new Date((deps.now ?? Date.now)()).toISOString();
  const nextSuffix = deps.suffix ?? randomSuffix;

  let lastErr = "could not create discount code";
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = formatInfluencerDiscountCode(handle, attempt === 0 ? "" : nextSuffix());
    const data = await gql(DISCOUNT_CREATE, buildInfluencerDiscountVariables(code, handle, startsAt), "write_discounts");
    const errs: UserError[] = data?.discountCodeBasicCreate?.userErrors ?? [];
    if (!errs.length) {
      return { code, discount_id: data?.discountCodeBasicCreate?.codeDiscountNode?.id ?? null, adopted: false };
    }
    const taken = errs.some((u) => u.code === "TAKEN" || /taken|already|unique/i.test(u.message ?? ""));
    if (!taken) throw new ShopifyDispatchError(`Shopify rejected the discount: ${userErrorText(errs)}`);
    const found = await gql(DISCOUNT_BY_CODE, { code }, "read_discounts").catch(() => null);
    const node = found?.codeDiscountNodeByCode;
    if (node?.codeDiscount?.title === title) return { code, discount_id: node.id ?? null, adopted: true };
    lastErr = `code ${code} is taken by another discount`;
  }
  throw new ShopifyDispatchError(lastErr);
}
