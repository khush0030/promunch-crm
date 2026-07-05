// Sales-channel classification for the assistant's order analytics.
//
// This mirrors channelOf() in src/app/dashboard/page.tsx (sales-channel
// semantics: source_name FIRST, so HYPD marketplace orders are never
// mislabeled as direct traffic). Note this is intentionally different from
// the traffic-source-first channelOf() in shopify-attribution/page.tsx —
// the assistant reports sales channels, not ad attribution.

export type ChannelOrder = {
  total_price: number | string | null;
  first_utm_source: string | null;
  first_source: string | null;
  source_name: string | null;
  is_creator: boolean | null;
};

export function salesChannelOf(o: ChannelOrder): string {
  const sn = o.source_name ?? "";
  if (o.is_creator) return "HYPD Creator";
  if (sn === "341128478721" || /hypd/i.test(sn)) return "HYPD Marketplace";
  if (sn === "web") return "PROMUNCH D2C Website";
  if (/^\d+$/.test(sn)) return "Other Marketplace";
  if (o.first_utm_source) return o.first_utm_source;
  if (o.first_source) return o.first_source;
  if (sn) return sn;
  return "Direct";
}
