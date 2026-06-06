// Order traffic attribution — UTM, referrer, landing page.
//
// WHY a separate fetch: the orders/* webhook payload (REST) does NOT include the
// customer journey. UTM/referrer/landing-page live only on the Order's
// `customerJourneySummary` in the Admin GraphQL API. So we take the order id from
// the webhook, then ask GraphQL for the journey and store it.
//
// We keep BOTH ends of the journey:
//   - first visit  → discovery  ("how did they find us")
//   - last visit   → conversion ("what touch closed it")
//
// Plan note: `firstVisit`/`lastVisit` UTM are available on every Shopify plan.
// The full `moments` path (every touch in between) is Shopify Plus only — we
// don't request it, so this works on the current plan.
//
// Timing gotcha: `customerJourneySummary.ready` can be false for a few seconds
// right after checkout while Shopify computes the journey. When not ready we
// return synced:false WITHOUT stamping attribution_synced_at, so the backfill /
// sweep picks the order up again later and fills it in.

import { adminGraphQL } from "./shopify-customer.ts";

// GraphQL fragment of Order fields this module knows how to map. Exported so the
// bulk backfill can request the same shape inside its orders(...) page query and
// feed each node straight into mapJourneyToColumns — one source of truth.
export const JOURNEY_FIELDS = `
  sourceName
  customerJourneySummary {
    ready
    momentsCount { count }
    customerOrderIndex
    daysToConversion
    firstVisit {
      occurredAt
      landingPage
      referrerUrl
      referralCode
      source
      sourceType
      utmParameters { source medium campaign content term }
    }
    lastVisit {
      occurredAt
      landingPage
      referrerUrl
      source
      sourceType
      utmParameters { source medium campaign content term }
    }
  }`;

const ORDER_JOURNEY_QUERY = `
query OrderJourney($id: ID!) {
  order(id: $id) { id ${JOURNEY_FIELDS} }
}`;

// The DB column shape this module produces — a partial shopify_orders update.
export interface AttributionColumns {
  source_name: string | null;
  first_utm_source: string | null;
  first_utm_medium: string | null;
  first_utm_campaign: string | null;
  first_utm_content: string | null;
  first_utm_term: string | null;
  first_source: string | null;
  first_source_type: string | null;
  first_landing_page: string | null;
  first_referrer_url: string | null;
  first_referral_code: string | null;
  first_visit_at: string | null;
  last_utm_source: string | null;
  last_utm_medium: string | null;
  last_utm_campaign: string | null;
  last_utm_content: string | null;
  last_utm_term: string | null;
  last_source: string | null;
  last_source_type: string | null;
  last_landing_page: string | null;
  last_referrer_url: string | null;
  last_visit_at: string | null;
  moments_count: number | null;
  days_to_conversion: number | null;
  customer_order_index: number | null;
  attribution_synced_at: string;
}

// Map a Shopify customerJourneySummary node -> our flat column object.
// Exported so the backfill (which already has the node from its bulk query) can
// reuse it without a second API round-trip.
export function mapJourneyToColumns(
  node: any,
  syncedAt: string,
): AttributionColumns {
  const j = node?.customerJourneySummary ?? {};
  const fv = j.firstVisit ?? {};
  const lv = j.lastVisit ?? {};
  const fu = fv.utmParameters ?? {};
  const lu = lv.utmParameters ?? {};
  return {
    source_name: node?.sourceName ?? null,
    first_utm_source: fu.source ?? null,
    first_utm_medium: fu.medium ?? null,
    first_utm_campaign: fu.campaign ?? null,
    first_utm_content: fu.content ?? null,
    first_utm_term: fu.term ?? null,
    first_source: fv.source ?? null,
    first_source_type: fv.sourceType ?? null,
    first_landing_page: fv.landingPage ?? null,
    first_referrer_url: fv.referrerUrl ?? null,
    first_referral_code: fv.referralCode ?? null,
    first_visit_at: fv.occurredAt ?? null,
    last_utm_source: lu.source ?? null,
    last_utm_medium: lu.medium ?? null,
    last_utm_campaign: lu.campaign ?? null,
    last_utm_content: lu.content ?? null,
    last_utm_term: lu.term ?? null,
    last_source: lv.source ?? null,
    last_source_type: lv.sourceType ?? null,
    last_landing_page: lv.landingPage ?? null,
    last_referrer_url: lv.referrerUrl ?? null,
    last_visit_at: lv.occurredAt ?? null,
    moments_count: j.momentsCount?.count ?? null,
    days_to_conversion: j.daysToConversion ?? null,
    customer_order_index: j.customerOrderIndex ?? null,
    attribution_synced_at: syncedAt,
  };
}

// Fetch one order's journey by Shopify order id (numeric or gid). Returns:
//   { ok: true,  synced: true,  columns }  — journey ready, write it
//   { ok: true,  synced: false }           — not ready yet, try again later
//   { ok: false, reason }                  — config/API error
export async function fetchOrderAttribution(
  orderId: number | string,
): Promise<
  | { ok: true; synced: true; columns: AttributionColumns }
  | { ok: true; synced: false }
  | { ok: false; reason: string }
> {
  const gid = String(orderId).startsWith("gid://")
    ? String(orderId)
    : `gid://shopify/Order/${orderId}`;

  let json: any;
  try {
    json = await adminGraphQL(ORDER_JOURNEY_QUERY, { id: gid });
  } catch (e) {
    return { ok: false, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
  if (json?.errors) return { ok: false, reason: JSON.stringify(json.errors).slice(0, 300) };

  const node = json?.data?.order;
  if (!node) return { ok: false, reason: "order-not-found" };

  // Journey still computing — don't stamp synced_at, let a later pass retry.
  if (node.customerJourneySummary && node.customerJourneySummary.ready === false) {
    return { ok: true, synced: false };
  }

  return { ok: true, synced: true, columns: mapJourneyToColumns(node, new Date().toISOString()) };
}
