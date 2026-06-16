// Upsert a Shopify Customer from an order's shipping/billing details.
//
// WHY: Hyped (marketplace) pushes GUEST orders — no customer object, no email —
// so the buyer never lands in Shopify's Customers list. We rebuild the customer
// from shipping_address and upsert via the Admin API so they're searchable,
// taggable and marketing-eligible.
//
// customerSet is an UPSERT keyed by a unique identifier (phone or email): exists
// -> updated, absent -> created. So firing it from multiple paths (create,
// updated, a sweep) never makes duplicate customer records — same no-spam
// discipline as the order-confirmation claims, applied to customer records.
//
// NOTE: this does NOT attach the customer to the already-created Hyped order.
// Shopify fixes an order's customer at CREATION and exposes no reassign API.
// Linking the order itself needs the upstream fix (Hyped sending email/customer
// at order creation). This handler only populates the Customers list.

const API_VERSION = "2025-01"; // customerSet requires >= 2024-10

// Client-credentials token (Dev Dashboard app): exchanged from client_id/secret,
// valid ~24h. Cached in-isolate so warm invocations skip the round-trip.
let cached: { token: string; exp: number } | null = null;

async function getAdminToken(domain: string): Promise<string | null> {
  const id = Deno.env.get("SHOPIFY_CLIENT_ID");
  const secret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  if (!id || !secret) return null;
  const now = Date.now();
  if (cached && cached.exp > now + 60_000) return cached.token; // 1-min safety margin
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!res.ok) return null;
  const j = await res.json() as { access_token: string; expires_in?: number };
  cached = { token: j.access_token, exp: now + (j.expires_in ?? 86399) * 1000 };
  return cached.token;
}

// Is this order from the HYPD marketplace? HYPD stamps every order with the tag
// "Order From HYPD Store" and rides a fixed sales-channel id. Organic web orders
// have neither — so we gate the customer upsert on this to avoid touching /
// mistagging real Shopify customers.
const HYPD_SOURCE_IDS = new Set(["341128478721"]);
export function isHypdOrder(order: any): boolean {
  const tags = Array.isArray(order?.tags)
    ? order.tags.join(",")
    : String(order?.tags ?? "");
  return /hypd/i.test(tags) || HYPD_SOURCE_IDS.has(String(order?.source_name ?? ""));
}

// Creator/influencer seeding orders: HYPD gifts free product to its creators as
// a referral channel, and those orders come through at a token ₹0.01 total
// (exactly 1 paisa). Flag on that exact signal so we can tag them "HYPD Creator"
// in Shopify + the CRM. round(*100) dodges float noise on the numeric total.
export function isCreatorOrder(order: any): boolean {
  const total = Number(order?.total_price ?? order?.current_total_price ?? 0);
  return Math.round(total * 100) === 1;
}

// Clean up the mangled names HYPD sends. Algorithm:
//   1. join first+last, split camelCase glue ("ManishaBhati" -> "Manisha Bhati"),
//   2. drop repeated words (case-insensitive, keep first occurrence),
//   3. word[0] = first name, the rest = last name.
//
//   "Harmeet" / "Harmeet"          -> "Harmeet"
//   "Kanika" / "Kanika"            -> "Kanika"
//   "ManishaBhati" / "ManishaBhati"-> "Manisha" / "Bhati"
//   "ShaikShaheen" / "shaheen"     -> "Shaik" / "Shaheen"
//   "JaiDedha" / "JaiDedha"        -> "Jai" / "Dedha"
//   "Khush Mutha" / "Khush Mutha"  -> "Khush" / "Mutha"
//   "Mitti" / "Kalra"              -> "Mitti" / "Kalra"  (unchanged)
//   "sheetalkaurmehra" x2          -> "sheetalkaurmehra" (de-duped; can't split
//                                      an all-lowercase glob — no case signal)
const splitCamel = (tok: string): string[] =>
  tok.replace(/([a-z])([A-Z])/g, "$1 $2").split(/\s+/).filter(Boolean);

export function normalizeName(
  rawFirst?: string | null,
  rawLast?: string | null,
): { firstName: string | null; lastName: string | null } {
  const raw = `${(rawFirst ?? "").trim()} ${(rawLast ?? "").trim()}`.trim();
  if (!raw) return { firstName: null, lastName: null };

  const words = raw.split(/\s+/).flatMap(splitCamel);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const k = w.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(w); }
  }
  return {
    firstName: out[0] || null,
    lastName: out.slice(1).join(" ") || null,
  };
}

// Raw Admin GraphQL call (used by the backfill to page orders). Returns the
// parsed JSON body; caller inspects data/errors.
export async function adminGraphQL(query: string, variables?: unknown): Promise<any> {
  const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  if (!domain) throw new Error("admin-not-configured");
  const token = await getAdminToken(domain);
  if (!token) throw new Error("admin-not-configured");
  const res = await fetch(
    `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  return await res.json();
}

// digits -> E.164. India default (matches toWaId): bare 10-digit -> +91…
function toE164(raw?: string | null): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) d = "91" + d;
  return "+" + d;
}

// Build the set of phone search strings to try. customerSet's identifier match
// is stricter than its uniqueness check: a buyer stored as "9812345678" still
// trips "already been taken" against our "+919812345678", yet an exact
// phone:"+91…" search won't find them. So we search every plausible format,
// ending with a last-10-digit wildcard that matches regardless of prefix.
function phoneQueryVariants(phone: string | null): string[] {
  if (!phone) return [];
  const digits = phone.replace(/\D/g, "");
  if (!digits) return [];
  const last10 = digits.slice(-10);
  const variants = new Set<string>([
    phone,            // +919812345678
    digits,           // 919812345678
    "+" + digits,
    last10,           // 9812345678
  ]);
  const qs = [...variants].map((v) => `phone:${JSON.stringify(v)}`);
  if (last10) qs.push(`phone:*${last10}`); // wildcard suffix match, last resort
  return qs;
}

// Find an existing customer id by phone, then email. Used when customerSet says
// the identifier is "already taken" — the buyer exists (often with a slightly
// different phone format), so we just need their id to link the order.
//
// RETRY REQUIRED (root cause of the recurring #2092/#2100 false alarms):
// Shopify's uniqueness check is strongly consistent but its lookup/search index
// is NOT. orders/create and orders/updated land seconds apart; delivery #1
// creates the customer, delivery #2 trips "already been taken" while the brand
// new record is still invisible to search. One immediate lookup therefore
// misses and we Slack-alerted a failure that heals itself moments later. We
// retry with backoff (≈7s worst case, conflict path only) so the index can
// catch up; only a miss after all attempts is a real failure worth alerting.
const LOOKUP_DELAYS_MS = [0, 2000, 5000];

async function findCustomerIdOnce(
  phone: string | null,
  email: string | null,
): Promise<string | null> {
  // customerByIdentifier hits the identity record directly — exact match on
  // the same identifier customerSet keys on. Try it before the search API.
  if (phone) {
    try {
      const j = await adminGraphQL(
        `query($id: CustomerIdentifierInput!){ customerByIdentifier(identifier:$id){ id } }`,
        { id: { phoneNumber: phone } },
      );
      const id = j?.data?.customerByIdentifier?.id;
      if (id) return id;
    } catch (_e) { /* fall through to search */ }
  }
  if (email) {
    try {
      const j = await adminGraphQL(
        `query($id: CustomerIdentifierInput!){ customerByIdentifier(identifier:$id){ id } }`,
        { id: { emailAddress: email } },
      );
      const id = j?.data?.customerByIdentifier?.id;
      if (id) return id;
    } catch (_e) { /* fall through to search */ }
  }
  const queries: string[] = [...phoneQueryVariants(phone)];
  if (email) queries.push(`email:${JSON.stringify(email)}`);
  for (const q of queries) {
    try {
      const j = await adminGraphQL(
        `query($q:String!){ customers(first:1, query:$q){ nodes { id } } }`,
        { q },
      );
      const id = j?.data?.customers?.nodes?.[0]?.id;
      if (id) return id;
    } catch (_e) { /* try next identifier */ }
  }
  return null;
}

async function findCustomerId(
  phone: string | null,
  email: string | null,
): Promise<string | null> {
  for (const delay of LOOKUP_DELAYS_MS) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const id = await findCustomerIdOnce(phone, email);
    if (id) return id;
  }
  return null;
}

const MUT = `
mutation Upsert($identifier: CustomerSetIdentifiers, $input: CustomerSetInput!) {
  customerSet(identifier: $identifier, input: $input) {
    customer { id }
    userErrors { field message }
  }
}`;

export async function upsertShopifyCustomerFromOrder(
  order: any,
): Promise<{ ok: true; id: string | null } | { ok: false; reason: string }> {
  const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  if (!domain) return { ok: false, reason: "admin-not-configured" };
  const token = await getAdminToken(domain);
  if (!token) return { ok: false, reason: "admin-not-configured" };

  const addr = order.shipping_address || order.billing_address || {};
  const email = (order.email || order.customer?.email || addr.email || "")
    .trim() || null;
  const phone = toE164(
    order.customer?.phone ?? order.phone ?? addr.phone ??
      order.billing_address?.phone,
  );

  // customerSet needs a unique identifier. Prefer phone (Hyped sends it in
  // shipping); else email. Neither -> can't create -> stand down silently.
  const identifier = phone ? { phone } : email ? { email } : null;
  if (!identifier) return { ok: false, reason: "no-identifier" };

  const { firstName, lastName } = normalizeName(
    addr.first_name || order.customer?.first_name,
    addr.last_name || order.customer?.last_name,
  );

  const input: Record<string, unknown> = {
    firstName,
    lastName,
    tags: ["hyped"], // segment marketplace buyers; drop if validation rejects
  };
  if (email) input.email = email;
  if (phone) input.phone = phone;
  if (addr.address1) {
    input.addresses = [{
      address1: addr.address1,
      address2: addr.address2 || null,
      city: addr.city || null,
      province: addr.province || null,
      zip: addr.zip || null,
      country: addr.country || "India",
      phone,
      firstName,
      lastName,
    }];
  }

  // One customerSet round-trip. Returns the customer id on success, or the
  // userErrors string on failure so the caller can decide whether to degrade.
  const send = async (
    body: Record<string, unknown>,
  ): Promise<{ ok: true; id: string | null } | { ok: false; msg: string }> => {
    const res = await fetch(
      `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query: MUT, variables: { identifier, input: body } }),
      },
    );
    const json = await res.json().catch(() => null) as any;
    const errs = json?.data?.customerSet?.userErrors ?? json?.errors;
    if (!res.ok || (Array.isArray(errs) && errs.length)) {
      return { ok: false, msg: JSON.stringify(errs ?? json) };
    }
    return { ok: true, id: json?.data?.customerSet?.customer?.id ?? null };
  };

  let attempt = await send(input);

  // The address is a nice-to-have (it just fills the order's Customer panel);
  // it must never block the upsert. Shopify rejects the whole customer when a
  // province/zip/address value isn't one it recognizes for the country — common
  // with HYPD/marketplace orders that send free-text provinces. Degrade the
  // address rather than fail: first drop the province, then drop the address.
  if (!attempt.ok && /province|zip|address|country/i.test(attempt.msg) && input.addresses) {
    const addrs = input.addresses as Array<Record<string, unknown>>;
    // 1) retry with province stripped (the usual culprit)
    attempt = await send({
      ...input,
      addresses: addrs.map(({ province, ...rest }) => rest),
    });
    // 2) still failing on the address -> drop it entirely, keep the customer
    if (!attempt.ok && /province|zip|address|country/i.test(attempt.msg)) {
      const { addresses: _omit, ...noAddr } = input;
      attempt = await send(noAddr);
    }
  }

  if (attempt.ok) return { ok: true, id: attempt.id };

  // "Phone/Email has already been taken" => the customer already exists (often
  // a phone-format mismatch). That's success for our purpose: look them up so
  // the order still gets linked, and don't surface a false-alarm failure.
  if (/already been taken/i.test(attempt.msg)) {
    const existing = await findCustomerId(phone, email);
    if (existing) return { ok: true, id: existing };
  }
  return { ok: false, reason: attempt.msg.slice(0, 300) };
}

// Link an EXISTING order to a customer record. This is what makes the buyer
// show in the order's "Customer" panel — the part customerSet alone can't do.
// Requires write_orders scope. orderId accepts a numeric Shopify id or a gid.
const LINK_MUT = `
mutation Link($orderId: ID!, $customerId: ID!) {
  orderCustomerSet(orderId: $orderId, customerId: $customerId) {
    order { id customer { id } }
    userErrors { field message }
  }
}`;

export async function linkOrderToCustomer(
  orderId: number | string,
  customerId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  if (!domain) return { ok: false, reason: "admin-not-configured" };
  const token = await getAdminToken(domain);
  if (!token) return { ok: false, reason: "admin-not-configured" };
  const gid = String(orderId).startsWith("gid://")
    ? String(orderId)
    : `gid://shopify/Order/${orderId}`;
  const res = await fetch(
    `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: LINK_MUT,
        variables: { orderId: gid, customerId },
      }),
    },
  );
  const json = await res.json().catch(() => null) as any;
  const errs = json?.data?.orderCustomerSet?.userErrors ?? json?.errors;
  if (!res.ok || (Array.isArray(errs) && errs.length)) {
    return { ok: false, reason: JSON.stringify(errs ?? json).slice(0, 300) };
  }
  return { ok: true };
}

// Add tags to an EXISTING order (native Shopify order tags). tagsAdd is an
// idempotent set-union: re-adding a tag the order already carries is a no-op,
// so this is safe to fire on every orders/* delivery. Requires write_orders
// (same scope linkOrderToCustomer already relies on). orderId: numeric id or gid.
const TAGS_ADD_MUT = `
mutation AddTags($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    node { id }
    userErrors { field message }
  }
}`;

export async function addOrderTags(
  orderId: number | string,
  tags: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  if (!domain) return { ok: false, reason: "admin-not-configured" };
  const token = await getAdminToken(domain);
  if (!token) return { ok: false, reason: "admin-not-configured" };
  const gid = String(orderId).startsWith("gid://")
    ? String(orderId)
    : `gid://shopify/Order/${orderId}`;
  const res = await fetch(
    `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query: TAGS_ADD_MUT, variables: { id: gid, tags } }),
    },
  );
  const json = await res.json().catch(() => null) as any;
  const errs = json?.data?.tagsAdd?.userErrors ?? json?.errors;
  if (!res.ok || (Array.isArray(errs) && errs.length)) {
    return { ok: false, reason: JSON.stringify(errs ?? json).slice(0, 300) };
  }
  return { ok: true };
}
