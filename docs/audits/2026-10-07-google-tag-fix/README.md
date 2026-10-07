# Google tag / Google Ads attribution fix (Oct 7, 2026)

## Problem
The storefront theme rendered `{% render 'spdn' %}` (Speedien speed script, pasted into the theme; no app installed). On every non-`/cart` URL in Chrome and Firefox, it switched every script matching `tagmanager`/`gtm`/`googlet`/`facebook.net`/`klaviyo` to `text/spdnscript`. It only turned them back on through a script fetched from `api.speedien.com`, which returned Cloudflare 521. As a result, home, collection and product pages sent no page_view, view_item or add_to_cart to Google Ads or GA4.

The theme also hardcoded Google Ads conversions (`Ldx6…` add to cart, `p495…` begin checkout, `XrOO…` homepage) and loaded a second `AW-11233764286` tag. These duplicated the events the Google & YouTube app already sends.

## Fix (live)
- Duplicated live theme `188760981805` ("Copy of Helium Work") to `188768944429` ("Tracking fix - Copy of Helium Work").
- In `layout/theme.liquid`, removed:
  - the `spdn` render
  - the duplicate AW gtag block
  - the click-conversion script (kept the footer accordion code that shared the same `<script>`)
- Published `188768944429` and re-verified on the live site: page_view, view_item, add_to_cart (once per label), begin_checkout and add_shipping_info all fire, and the gclid is stored.
- Rollback: republish `188760981805`.

`GT-NC8BM37` in the theme `<head>` is the only `gtag` definition on the page, and Breeze checkout calls `window.gtag`. Do not remove it.

## Google Ads (owner-applied)
- Purchase is the only account-default goal.
- Sole Primary action: "Google Shopping App Purchase". The GA4 import and the Breeze-mapped "Purchase" are Secondary.

## Files
- `theme.liquid.backup`: original live `layout/theme.liquid` before the fix.
- `theme.liquid.before-gt-removal`: the fixed, currently live version, for reference.
