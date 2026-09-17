// Pure rules for which CRM contacts go to Brevo and what attributes they carry.
// No IO so the consent rules are unit-tested; src/lib/brevo-sync.ts does the IO.

export type SyncContact = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  status: string | null;
  accepts_marketing: boolean | null;
  email_consent: string | null;
  anonymized_at: string | null;
  // Totals the Shopify customer sync keeps on the contact. Used when no order
  // row carries this email (most shopify_orders have no customer_email).
  total_orders?: number | null;
  total_spent?: number | string | null;
  first_purchase_date?: string | null;
  last_purchase_date?: string | null;
};

export type SyncOrder = {
  customer_email: string | null;
  total_price: number | string | null;
  shopify_created_at: string | null;
  source_name: string | null;
  is_creator: boolean | null;
  cancelled_at: string | null;
  financial_status: string | null;
};

export type OrderAgg = { count: number; spent: number; first: string | null; last: string | null; channel: string | null };

// Attributes the sync writes. Created in Brevo on first sync if missing.
export const SYNC_ATTRIBUTES: { name: string; type: "text" | "float" | "date" }[] = [
  { name: "FIRSTNAME", type: "text" },
  { name: "LASTNAME", type: "text" },
  { name: "CITY", type: "text" },
  { name: "STATE", type: "text" },
  { name: "ORDER_COUNT", type: "float" },
  { name: "TOTAL_SPENT", type: "float" },
  { name: "FIRST_ORDER_DATE", type: "date" },
  { name: "LAST_ORDER_DATE", type: "date" },
  { name: "RFM_SEGMENT", type: "text" },
  { name: "CHANNEL", type: "text" },
  { name: "CRM_ID", type: "text" },
];

export type SkipReason = "no_email" | "anonymized" | "not_active" | "unsubscribed" | "no_consent" | "suppressed";

/**
 * Marketing email needs an opt-in. A contact qualifies only if it is active,
 * not anonymized, not on the suppression list, not unsubscribed, and has a
 * positive signal (Shopify accepts_marketing, or email_consent SUBSCRIBED).
 * "NEVER_SUBSCRIBED" / unknown is a no.
 */
export function marketingEligibility(c: SyncContact, suppressed: Set<string>): { ok: true } | { ok: false; reason: SkipReason } {
  const email = c.email?.trim().toLowerCase();
  if (!email) return { ok: false, reason: "no_email" };
  if (c.anonymized_at) return { ok: false, reason: "anonymized" };
  if (suppressed.has(email)) return { ok: false, reason: "suppressed" };
  const consent = (c.email_consent ?? "").toUpperCase();
  if (consent === "UNSUBSCRIBED" || (c.status ?? "active") === "unsubscribed") return { ok: false, reason: "unsubscribed" };
  if ((c.status ?? "active") !== "active") return { ok: false, reason: "not_active" };
  if (c.accepts_marketing === true || consent === "SUBSCRIBED") return { ok: true };
  return { ok: false, reason: "no_consent" };
}

const CHANNEL: Record<string, string> = { web: "D2C site", "368925802497": "D2C site", "341128478721": "HYPD" };

/** Per-email order stats from real orders: creator seeds, cancelled and fully refunded/voided orders excluded. */
export function aggregateOrders(orders: SyncOrder[]): Map<string, OrderAgg> {
  const out = new Map<string, OrderAgg>();
  for (const o of orders) {
    const email = o.customer_email?.trim().toLowerCase();
    if (!email || o.is_creator || o.cancelled_at) continue;
    if (["refunded", "voided"].includes((o.financial_status ?? "").toLowerCase())) continue;
    const price = Number(o.total_price ?? 0);
    if (!Number.isFinite(price) || price <= 0.01) continue;
    const a = out.get(email) ?? { count: 0, spent: 0, first: null, last: null, channel: null };
    a.count += 1;
    a.spent += price;
    const at = o.shopify_created_at;
    if (at) {
      if (!a.first || at < a.first) a.first = at;
      if (!a.last || at > a.last) {
        a.last = at;
        a.channel = CHANNEL[o.source_name ?? ""] ?? a.channel ?? "Other";
      }
    }
    out.set(email, a);
  }
  return out;
}

// Tags written by wa-rfm-tick (migration 20260622133000_wa_rfm_segmentation).
const RFM_LABEL: Record<string, string> = {
  vip: "VIP",
  loyal: "Loyal",
  new: "New",
  one_time: "One-time",
  at_risk: "At risk",
  dormant: "Dormant",
};

/** First rfm:* tag on the contact's WhatsApp record, as a readable label. */
export function rfmSegment(tags: string[] | null | undefined): string | null {
  const t = (tags ?? []).find((x) => x.startsWith("rfm:"));
  if (!t) return null;
  const key = t.slice(4);
  return RFM_LABEL[key] ?? key.replace(/_/g, " ");
}

/** Indian mobile numbers in contacts vary (+91, 91, 10-digit). Normalise to wa_id form. */
export function waIdOf(phone: string | null): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith("91")) return d;
  return null;
}

export type ImportRow = { email: string; attributes: Record<string, string | number> };

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export function buildImportRow(c: SyncContact, orderAgg: OrderAgg | undefined, rfm: string | null): ImportRow {
  const fallbackSpent = Number(c.total_spent ?? 0);
  const agg: OrderAgg | undefined =
    orderAgg ??
    ((c.total_orders ?? 0) > 0
      ? {
          count: c.total_orders ?? 0,
          spent: Number.isFinite(fallbackSpent) ? fallbackSpent : 0,
          first: c.first_purchase_date ?? null,
          last: c.last_purchase_date ?? null,
          channel: null,
        }
      : undefined);
  const attrs: Record<string, string | number | null> = {
    FIRSTNAME: c.first_name?.trim() || null,
    LASTNAME: c.last_name?.trim() || null,
    CITY: c.city?.trim() || null,
    STATE: c.state?.trim() || null,
    ORDER_COUNT: agg?.count ?? 0,
    TOTAL_SPENT: agg ? Math.round(agg.spent * 100) / 100 : 0,
    FIRST_ORDER_DATE: day(agg?.first ?? null),
    LAST_ORDER_DATE: day(agg?.last ?? null),
    RFM_SEGMENT: rfm,
    CHANNEL: agg?.channel ?? null,
    CRM_ID: c.id,
  };
  // Brevo import overwrites with blanks unless omitted: drop nulls.
  const attributes = Object.fromEntries(Object.entries(attrs).filter((e): e is [string, string | number] => e[1] != null));
  return { email: c.email!.trim().toLowerCase(), attributes };
}
