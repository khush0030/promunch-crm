// UTM tagging for WhatsApp template button URLs, applied once at submit time.
// Shopify's customer-journey attribution reads these params off the landing
// page and stamps them onto the order (first/last_utm_* on shopify_orders),
// which is what the Analytics "Revenue from WhatsApp" panel groups by.
// Mirror of the edge functions' _shared/links.ts appendUtm domain rules.

const OUR_DOMAINS = ["promunch.in", "trypromunch.in", "myshopify.com"];

export function tagUrlForWhatsApp(
  raw: string,
  opts: { medium?: string; campaign?: string } = {},
): string {
  try {
    // Dynamic template URLs ({{1}} suffix) get their tail appended by Meta at
    // send time — query params added here would land before the suffix and
    // corrupt the final URL, so leave them alone.
    if (!raw || raw.includes("{{")) return raw;
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (!OUR_DOMAINS.some((d) => host === d || host.endsWith("." + d))) return raw;
    // Hand-tagged URLs (like edamame_launch) keep their own attribution.
    if (url.searchParams.has("utm_source") || url.searchParams.has("utm_medium")) return raw;
    url.searchParams.set("utm_source", "whatsapp");
    url.searchParams.set("utm_medium", opts.medium || "template_button");
    if (opts.campaign) url.searchParams.set("utm_campaign", opts.campaign);
    return url.toString();
  } catch {
    return raw;
  }
}
