// Pure link helpers for marketing email HTML.
//
// tokenizeStorefrontLinks: append the signed pm_c contact token (see
// browse-abandon.ts withContactToken) to every href pointing at the PROMUNCH
// storefront (promunch.in / www.promunch.in only), so the storefront pixel can
// identify a click-through shopper. Existing query params (UTMs, cart tokens)
// are preserved by the tokenizer. Links to any other host, including the
// CRM-hosted unsubscribe endpoint, are never touched.

const STOREFRONT_HOST = /^(www\.)?promunch\.in$/i;

export function isStorefrontUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && STOREFRONT_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

function unescapeAttr(s: string): string {
  return s.replace(/&amp;/g, "&");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Rewrite href="..." / href='...' storefront links through `tokenize`. */
export function tokenizeStorefrontLinks(html: string, tokenize: (url: string) => string): string {
  return html.replace(/href=(["'])([^"']*)\1/gi, (m, q: string, raw: string) => {
    const url = unescapeAttr(raw.trim());
    if (!isStorefrontUrl(url) || /\/unsubscribe/i.test(url)) return m;
    let out: string;
    try {
      out = tokenize(url);
    } catch {
      return m;
    }
    return `href=${q}${escapeAttr(out)}${q}`;
  });
}
