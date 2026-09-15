// Single source of truth for "which sales channel is this order" and
// "does this order count as revenue" — mirrors the ad hoc channelOf() that
// used to live in src/app/dashboard/page.tsx (lines ~96-110), collapsed to
// the coarser ChannelKey buckets the dashboard/API layer actually groups by.

export type ChannelKey = "web" | "hypd" | "amazon" | "other" | "creator";

export type ChannelOrderInput = {
  is_creator?: boolean | null;
  source_name?: string | null;
  first_utm_source?: string | null;
  first_source?: string | null;
};

export function channelOf(o: ChannelOrderInput): ChannelKey {
  // Creator seed orders (₹0.01 HYPD) are their own bucket regardless of
  // source_name — they must never be counted as HYPD marketplace revenue.
  if (o.is_creator) return "creator";

  const sn = (o.source_name ?? "").trim();

  if (sn === "341128478721" || /hypd/i.test(sn)) return "hypd";
  if (/amazon/i.test(sn)) return "amazon";
  // The PROMUNCH Shopify storefront (online store sales channel).
  if (sn === "web") return "web";
  // Any other numeric Shopify channel id is a connected marketplace/app we
  // don't have a named bucket for.
  if (/^\d+$/.test(sn)) return "other";

  // No recognised source_name and no marketplace id. If there is also no
  // first-touch attribution at all (or it agrees with "web"), treat it as
  // direct web traffic — that is the fallback the old ad hoc channelOf()
  // effectively landed on for bare/empty orders. Any other attribution
  // signal (a UTM source, a referrer) means it came from somewhere we don't
  // have a named channel for, so it is "other" rather than mislabeled "web".
  const utm = o.first_utm_source ?? "";
  const src = o.first_source ?? "";
  if (!utm && !src && (sn === "" || sn === "web")) return "web";
  return "other";
}

export type RevenueOrderInput = {
  financial_status?: string | null;
  is_creator?: boolean | null;
};

// Whether an order should count toward revenue metrics: excludes voided and
// refunded orders (any casing Shopify sends) and HYPD ₹0.01 creator seeds.
export function isRevenueOrder(o: RevenueOrderInput): boolean {
  if (o.is_creator) return false;
  const status = (o.financial_status ?? "").toLowerCase();
  if (status === "voided" || status === "refunded") return false;
  return true;
}
