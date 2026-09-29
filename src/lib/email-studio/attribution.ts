// Which email (if any) gets credit for a Shopify order.
//   1. UTM: the order's utm_source is email and its utm_campaign matches a
//      campaign's utm_campaign -> that campaign ("utm").
//   2. Otherwise the latest email click by the same customer (email address,
//      else last-10-digit phone) in the 5 days before the order ("click_5d").
// HYPD creator seeds (₹0.01 / is_creator) and cancelled orders never count.
//
// Keep imports relative: vitest has no "@/" alias.

export const CLICK_WINDOW_MS = 5 * 86_400_000;

export type OrderForAttribution = {
  shopify_id: string;
  order_number: string | null;
  total_price: number;
  created_at: string;
  email: string | null;
  phone: string | null;
  utm_sources: (string | null)[];
  utm_campaigns: (string | null)[];
  is_creator: boolean;
  cancelled: boolean;
};

export type Click = {
  kind: "campaign" | "flow";
  id: string; // campaign_id or flow_id
  contact_id: string;
  clicked_at: string;
};

export type Credit = {
  campaign_id: string | null;
  flow_id: string | null;
  contact_id: string | null;
  model: "utm" | "click_5d";
};

export function phoneKey(p: string | null | undefined): string | null {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

export function attributeOrder(
  o: OrderForAttribution,
  lookups: {
    campaignByUtm: Map<string, string>;
    contactByEmail: Map<string, string>;
    contactByPhone: Map<string, string>;
    clicksByContact: Map<string, Click[]>;
  },
): Credit | null {
  if (o.cancelled || o.is_creator || !(o.total_price > 0.01)) return null;

  const contactId =
    (o.email && lookups.contactByEmail.get(o.email.toLowerCase())) ||
    lookups.contactByPhone.get(phoneKey(o.phone) ?? "") ||
    null;

  const fromEmail = o.utm_sources.some((s) => /e-?mail/i.test(String(s ?? "")));
  if (fromEmail) {
    for (const c of o.utm_campaigns) {
      const hit = c ? lookups.campaignByUtm.get(c.toLowerCase()) : undefined;
      if (hit) return { campaign_id: hit, flow_id: null, contact_id: contactId, model: "utm" };
    }
  }

  if (!contactId) return null;
  const at = Date.parse(o.created_at);
  const best = (lookups.clicksByContact.get(contactId) ?? [])
    .filter((k) => {
      const t = Date.parse(k.clicked_at);
      return t <= at && at - t <= CLICK_WINDOW_MS;
    })
    .sort((a, b) => Date.parse(b.clicked_at) - Date.parse(a.clicked_at))[0];
  if (!best) return null;
  return {
    campaign_id: best.kind === "campaign" ? best.id : null,
    flow_id: best.kind === "flow" ? best.id : null,
    contact_id: contactId,
    model: "click_5d",
  };
}
