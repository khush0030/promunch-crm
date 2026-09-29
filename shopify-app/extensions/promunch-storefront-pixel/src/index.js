// PROMUNCH storefront pixel (Shopify Web Pixel, strict sandbox).
//
// Sends product_viewed / product_added_to_cart / checkout_started to the CRM so
// the browse-abandonment email flow can trigger. Payload shape is validated by
// parseTrackPayload() in src/lib/email/browse-abandon.ts; keep them in sync.
//
// Identity:
//   - logged-in customer: init.data.customer.email
//   - email click-through: a signed `pm_c` query param on the landing URL. We
//     persist it in storefront localStorage so later page views (and the
//     cart/checkout that follow) stay attributed after the param is gone.
//
// Transport: fetch keepalive with text/plain (a CORS "simple request", so no
// preflight). Fire-and-forget; errors are swallowed so the pixel can never
// affect the storefront.

import { register } from "@shopify/web-pixels-extension";

const DEFAULT_TRACK_URL = "https://admin.promunch.in/api/public/track";
const PM_C_KEY = "pm_c";

register(({ analytics, browser, init, settings }) => {
  const trackUrl = (settings && settings.trackUrl) || DEFAULT_TRACK_URL;
  const customerEmail = (init && init.data && init.data.customer && init.data.customer.email) || null;
  const origin =
    (init && init.context && init.context.document && init.context.document.location && init.context.document.location.origin) ||
    "https://promunch.in";

  async function contactToken(href) {
    try {
      const fromUrl = href ? new URL(href).searchParams.get("pm_c") : null;
      if (fromUrl) {
        await browser.localStorage.setItem(PM_C_KEY, fromUrl);
        return fromUrl;
      }
      return (await browser.localStorage.getItem(PM_C_KEY)) || null;
    } catch {
      return null;
    }
  }

  function abs(u) {
    if (!u) return null;
    try {
      return new URL(u.startsWith("//") ? "https:" + u : u, origin).toString();
    } catch {
      return null;
    }
  }

  function handleFromUrl(u) {
    const m = u && u.match(/\/products\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  // ProductVariant (web pixels API) -> our product shape.
  function fromVariant(v) {
    if (!v) return null;
    const p = v.product || {};
    const url = abs(p.url);
    return {
      id: p.id || null,
      variant_id: v.id || null,
      handle: handleFromUrl(url),
      title: p.title || v.title || null,
      url,
      image: abs(v.image && v.image.src),
      price: v.price && v.price.amount != null ? Number(v.price.amount) : null,
      currency: (v.price && v.price.currencyCode) || null,
    };
  }

  async function send(name, event, product) {
    try {
      const href =
        (event.context && event.context.document && event.context.document.location && event.context.document.location.href) || null;
      const body = {
        event: name,
        clientId: event.clientId,
        email: customerEmail,
        pm_c: await contactToken(href),
        product,
        url: href,
        ts: event.timestamp || new Date().toISOString(),
      };
      await fetch(trackUrl, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(body),
      });
    } catch {
      // never break the storefront
    }
  }

  analytics.subscribe("product_viewed", (event) => {
    send("product_viewed", event, fromVariant(event.data && event.data.productVariant));
  });

  analytics.subscribe("product_added_to_cart", (event) => {
    const line = event.data && event.data.cartLine;
    send("product_added_to_cart", event, fromVariant(line && line.merchandise));
  });

  analytics.subscribe("checkout_started", (event) => {
    const items = (event.data && event.data.checkout && event.data.checkout.lineItems) || [];
    const first = items[0];
    send("checkout_started", event, fromVariant(first && first.variant));
  });
});
