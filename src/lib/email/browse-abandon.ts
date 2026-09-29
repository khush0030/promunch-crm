// Browse abandonment: pure helpers shared by the storefront tracking endpoint
// (/api/public/track) and the hourly email-browse-tick cron.
//
//   1. Contact tokens (`pm_c`): a signed contact id appended to links in our
//      marketing emails. The Shopify Web Pixel reads it from the landing URL,
//      keeps it in storefront localStorage and forwards it with every event, so
//      a click-through visitor is identified even when not logged in.
//   2. Payload validation for the pixel's POST body.
//   3. Eligibility: which identified viewers should get the browse email.
//
// No DB access here, so everything is unit-testable. Server-only (node:crypto).

import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// 1. pm_c contact token
// ---------------------------------------------------------------------------

// Distinct purpose string: the same UNSUBSCRIBE_SECRET signs both token kinds,
// so the purpose prefix is what stops an unsubscribe token being replayed as a
// pm_c identity token (and vice versa). Bump the version to invalidate all.
const PURPOSE = "pm_c:v1:";
const DEFAULT_TTL_DAYS = 90;

function secret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET;
  if (!s) throw new Error("UNSUBSCRIBE_SECRET is not set (needed to sign pm_c contact tokens).");
  return s;
}

function mac(contactId: string, expSec: number): Buffer {
  // 16 bytes (128-bit) keeps email links short and is plenty for an HMAC tag.
  return createHmac("sha256", secret()).update(`${PURPOSE}${contactId}.${expSec}`).digest().subarray(0, 16);
}

/**
 * Signed identity token for email links: `?pm_c=<token>`.
 * Format: `base64url(contactId).base36(expiryEpochSec).base64url(hmac16)`.
 * Expires after `ttlDays` (default 90) so a forwarded or leaked link stops
 * attributing someone else's browsing to this contact.
 */
export function signContactToken(contactId: string, opts?: { ttlDays?: number; now?: number }): string {
  const now = opts?.now ?? Date.now();
  const exp = Math.floor(now / 1000) + Math.round((opts?.ttlDays ?? DEFAULT_TTL_DAYS) * 86_400);
  return `${Buffer.from(contactId).toString("base64url")}.${exp.toString(36)}.${mac(contactId, exp).toString("base64url")}`;
}

/** Returns the contact id if the token is authentic and unexpired, else null. Never throws on bad input. */
export function verifyContactToken(token: unknown, now: number = Date.now()): string | null {
  if (typeof token !== "string" || token.length > 300) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const contactId = Buffer.from(parts[0], "base64url").toString("utf8");
    if (!UUID_RE.test(contactId)) return null;
    const exp = parseInt(parts[1], 36);
    if (!Number.isFinite(exp) || exp * 1000 < now) return null;
    const given = Buffer.from(parts[2], "base64url");
    const expected = mac(contactId, exp);
    if (given.length !== expected.length) return null;
    return timingSafeEqual(given, expected) ? contactId : null;
  } catch {
    return null;
  }
}

/** Append `pm_c` to a storefront URL (for the email renderer). Leaves non-http(s) links untouched. */
export function withContactToken(url: string, contactId: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return url;
    u.searchParams.set("pm_c", signContactToken(contactId));
    return u.toString();
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// 2. Pixel payload validation
// ---------------------------------------------------------------------------

export const TRACK_EVENTS = ["product_viewed", "product_added_to_cart", "checkout_started"] as const;
export type TrackEvent = (typeof TRACK_EVENTS)[number];

export const MAX_TRACK_BODY_BYTES = 4096;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export type TrackProduct = {
  product_id: string | null;
  variant_id: string | null;
  handle: string | null;
  title: string | null;
  url: string | null;
  image: string | null;
  price: number | null;
  currency: string | null;
};

export type TrackPayload = {
  event: TrackEvent;
  clientId: string;
  email: string | null;
  contactToken: string | null;
  product: TrackProduct | null;
  url: string | null;
};

function str(v: unknown, max: number): string | null {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function httpUrl(v: unknown): string | null {
  const s = str(v, 1000);
  if (!s) return null;
  try {
    const u = new URL(s.startsWith("//") ? `https:${s}` : s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Shopify GIDs ("gid://shopify/Product/123") and bare ids both reduce to the numeric id. */
function shopifyId(v: unknown): string | null {
  const s = str(v, 200);
  if (!s) return null;
  const m = s.match(/(\d{3,20})$/);
  return m ? m[1] : null;
}

/**
 * Validates and normalises the pixel body. Returns null when the shape is wrong
 * (the endpoint then answers 204 and stores nothing). Unknown keys are dropped;
 * every string is length-capped.
 */
export function parseTrackPayload(raw: unknown): TrackPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;

  const event = b.event;
  if (typeof event !== "string" || !(TRACK_EVENTS as readonly string[]).includes(event)) return null;

  const clientId = typeof b.clientId === "string" ? b.clientId.trim() : "";
  if (!CLIENT_ID_RE.test(clientId)) return null;

  const emailRaw = str(b.email, 254)?.toLowerCase() ?? null;
  const email = emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw : null;

  const contactToken = str(b.pm_c, 300);

  let product: TrackProduct | null = null;
  if (b.product && typeof b.product === "object" && !Array.isArray(b.product)) {
    const p = b.product as Record<string, unknown>;
    const priceNum = typeof p.price === "number" ? p.price : typeof p.price === "string" ? Number(p.price) : NaN;
    product = {
      product_id: shopifyId(p.id ?? p.product_id),
      variant_id: shopifyId(p.variant_id),
      handle: str(p.handle, 200),
      title: str(p.title, 200),
      url: httpUrl(p.url),
      image: httpUrl(p.image),
      price: Number.isFinite(priceNum) && priceNum >= 0 && priceNum < 1e7 ? Math.round(priceNum * 100) / 100 : null,
      currency: str(p.currency, 8),
    };
  }
  // A product view with no product to show is useless for the email.
  if (event === "product_viewed" && (!product || (!product.title && !product.product_id))) return null;

  return { event: event as TrackEvent, clientId, email, contactToken, product, url: httpUrl(b.url) };
}

// ---------------------------------------------------------------------------
// 3. Eligibility
// ---------------------------------------------------------------------------

export type StorefrontEventRow = {
  client_id: string;
  contact_id: string | null;
  email: string | null;
  event: string;
  product: Partial<TrackProduct> | null;
  created_at: string;
};

export type BrowseCandidate = {
  email: string;
  contactId: string | null;
  viewedAt: string; // latest product view
  product: { title: string; url: string | null; image: string | null; price: number | null };
};

export const MIN_IDLE_HOURS = 1;
export const MAX_VIEW_AGE_HOURS = 24;
export const REPEAT_COOLDOWN_DAYS = 7;
export const ORDER_LOOKBACK_DAYS = 7;

const H = 3_600_000;

/**
 * Pure first pass over the last ~24h of storefront events.
 * Per identified visitor (by email): keep them when
 *   - their latest product view is between 1h and 24h old (still browsing if <1h),
 *   - no add-to-cart / checkout-start happened at or after their first view in
 *     the window, matched by email OR by any client id they browsed on (so an
 *     anonymous cart event from the same device still counts).
 * The product shown is the most recently viewed one.
 */
export function pickBrowseCandidates(events: StorefrontEventRow[], now: number = Date.now()): BrowseCandidate[] {
  const oldest = now - MAX_VIEW_AGE_HOURS * H;
  const newestAllowed = now - MIN_IDLE_HOURS * H;

  type Acc = { contactId: string | null; firstView: number; lastView: number; lastProduct: Partial<TrackProduct> | null; clients: Set<string> };
  const byEmail = new Map<string, Acc>();
  const clientToEmail = new Map<string, Set<string>>();

  for (const e of events) {
    if (e.event !== "product_viewed" || !e.email) continue;
    const t = Date.parse(e.created_at);
    if (!Number.isFinite(t) || t < oldest || t > now) continue;
    const email = e.email.toLowerCase();
    let a = byEmail.get(email);
    if (!a) {
      a = { contactId: e.contact_id, firstView: t, lastView: -Infinity, lastProduct: null, clients: new Set() };
      byEmail.set(email, a);
    }
    a.firstView = Math.min(a.firstView, t);
    if (t >= a.lastView && e.product?.title) {
      a.lastView = t;
      a.lastProduct = e.product;
    } else if (t > a.lastView) {
      a.lastView = t;
    }
    if (!a.contactId && e.contact_id) a.contactId = e.contact_id;
    a.clients.add(e.client_id);
    if (!clientToEmail.has(e.client_id)) clientToEmail.set(e.client_id, new Set());
    clientToEmail.get(e.client_id)!.add(email);
  }

  // Intent events (cart / checkout) disqualify the visitor from the time they browsed.
  const intentAfter = new Map<string, number>(); // email -> latest intent timestamp
  for (const e of events) {
    if (e.event !== "product_added_to_cart" && e.event !== "checkout_started") continue;
    const t = Date.parse(e.created_at);
    if (!Number.isFinite(t)) continue;
    const emails = new Set<string>(clientToEmail.get(e.client_id) ?? []);
    if (e.email) emails.add(e.email.toLowerCase());
    for (const em of emails) intentAfter.set(em, Math.max(intentAfter.get(em) ?? -Infinity, t));
  }

  const out: BrowseCandidate[] = [];
  for (const [email, a] of byEmail) {
    if (a.lastView > newestAllowed) continue; // viewed within the last hour: still browsing
    if ((intentAfter.get(email) ?? -Infinity) >= a.firstView) continue;
    const p = a.lastProduct;
    if (!p?.title) continue;
    out.push({
      email,
      contactId: a.contactId,
      viewedAt: new Date(a.lastView).toISOString(),
      product: { title: p.title, url: p.url ?? null, image: p.image ?? null, price: typeof p.price === "number" ? p.price : null },
    });
  }
  return out;
}

export type ContactConsent = {
  id: string;
  email: string;
  first_name: string | null;
  status: string | null;
  accepts_marketing: boolean | null;
  email_consent: string | null;
};

/**
 * Pure second pass with DB facts looked up by the cron. Browse abandonment is
 * behavioural marketing, so it requires POSITIVE consent (accepts_marketing
 * true or email_consent 'subscribed'), not merely "not opted out".
 */
export function filterEligible(
  candidates: BrowseCandidate[],
  facts: {
    contactsByEmail: Map<string, ContactConsent>;
    suppressed: Set<string>;
    orderedEmails: Set<string>; // ordered in the last ORDER_LOOKBACK_DAYS
    recentlyEnrolledContactIds: Set<string>; // browse enrolment in the last REPEAT_COOLDOWN_DAYS
  },
): Array<BrowseCandidate & { contactId: string; firstName: string | null }> {
  const out: Array<BrowseCandidate & { contactId: string; firstName: string | null }> = [];
  for (const c of candidates) {
    const contact = facts.contactsByEmail.get(c.email);
    if (!contact) continue;
    if (contact.status !== "active") continue;
    const consented = contact.accepts_marketing === true || contact.email_consent === "subscribed";
    if (!consented) continue;
    if (facts.suppressed.has(c.email)) continue;
    if (facts.orderedEmails.has(c.email)) continue;
    if (facts.recentlyEnrolledContactIds.has(contact.id)) continue;
    out.push({ ...c, contactId: contact.id, firstName: contact.first_name });
  }
  return out;
}

/** Deterministic enrolment key: one browse enrolment per contact per UTC day of the view. */
export function browseEntityRef(contactId: string, viewedAt: string): string {
  return `${contactId}:${viewedAt.slice(0, 10)}`;
}
