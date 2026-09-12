# Cart recovery delivery changes, September 12, 2026

## Customer-visible behavior

- The optional **Send my cart to WhatsApp** action prepares a product-only cart snapshot on the storefront cart page. The shopper must press Send in WhatsApp before the bot replies. No marketing subscription is created.
- The response contains a validated storefront cart permalink with `storefront=true`, preserving Breeze checkout. Existing abandoned-checkout journeys continue to use their stored partner recovery link; this feature does not replace it.
- Snapshot references expire after 24 hours. Prices, availability and offers are recalculated by the storefront. Carts with subscriptions, bundle components or custom line properties are declined instead of being reconstructed incorrectly. Normal checkout remains available.
- Active carts take priority over scheduled and conversational review/replenishment asks. Broadcasts already hold active-cart recipients.
- Only one template attempt is allowed per shopper/cart across reminder and recovery steps, including historical attempts. Confirmed `131049` immediately retires the cart template path. The existing customer-conversation path remains available.

## Implementation and invariants

`/api/public/wa-cart-request` accepts only allowlisted storefront origins and a bounded cart payload. It stores no phone, email, address, notes, prices or checkout credentials. It writes a product permalink to the existing `wa_short_links` table. HMAC-derived opaque codes reuse identical basket/hour requests. A per-IP-hash 20/hour database check limits ordinary abuse; this is not a distributed atomic rate limiter or bot-authentication mechanism. Origin headers alone are not authentication.

`wa-ai-reply/cart-request.ts` recognizes only the exact inbound reference format. It reads the latest persisted inbound, validates the service window and snapshot, then sends a deterministic service reply. It does not ask the model to interpret a URL or create an opt-in. The existing atomic reply RPC is mandatory: no read-only fallback. The claim is sealed before the external call; ambiguous network outcomes never trigger a duplicate send. A crash after sealing can miss that reply, so the shopper must request again.

`cart-recovery-policy.ts` uses the existing confirmation-claim table with the namespaced key `cart_template_once:<wa_id>:<order_ref>`. A unique INSERT reserves the template attempt before calling Meta; its `sent` status means this attempt budget is consumed, **not** that delivery occurred. It is never released or reclaimed. Historical ledger checks and unknown database state also prevent sending. This deliberately favors avoiding repeated attempts over automatic retry after transient errors.

No database migration is required. Cart priority is a selection rule, not a new cross-channel transaction lock. Existing reply and journey claims remain in place.

## Rollout order

1. Supabase management access to project `hlykspakpewuilttnydm` was restored on September 12. CLI function/secret metadata listing and live-source backups succeeded. The existing local service credential can read database records but the diagnostic function returned 401; do not assume these are equivalent access paths. CLI secret metadata confirms `WA_MM_LITE_ENABLED` is absent. No new credentials were retrieved.
2. Deploy `wa-ai-reply`, `wa-journey-tick`, `wa-webhook`, and `wa-meta-info` from `promunch-email-agent/`. Shared `window-asks` consumers bundled in those functions must be deployed together.
3. Deploy the Next application. The storefront feature remains off unless `WA_CART_REQUEST_ENABLED` resolves to the exact string `true` through Next's app_secrets/env settings.
4. Verify the receiving worker with an owner-initiated cart request and confirm the delivery receipt. Then enable `WA_CART_REQUEST_ENABLED` and verify the existing growth embed is installed on the live storefront. The action only renders on the cart page, not product-page cart drawers or hosted checkout. The embed cache can take five minutes to refresh.
5. Verify Meta Marketing Messages API onboarding and the deployed `WA_MM_LITE_ENABLED` setting separately. The enhanced `wa-meta-info` response reports local routing flag/version; it cannot certify Meta onboarding. Do not turn the flag on based on the existence of code alone.
6. Run an opt-in pilot with disjoint customer groups. Measure unique carts reached, delivered/read receipts, conversions and cost. API acceptance is not delivery. Never send both experiment variants to the same person.

## Fallback channels and limits

The existing Shopify checkout handler already enrolls eligible email addresses in an active `checkout_abandoned` email flow, with `(flow_id, dedup_key)` uniqueness and purchase cancellation. It is an independent flow, not a new failure-triggered fallback introduced here. Its live activation, consent and timing require verification before claiming full fallback coverage. No SMS integration or additional automatic calls were enabled. Where no permitted fallback exists, wait for a customer conversation or stop; do not disguise marketing as utility.

MM Lite activation, end-to-end delivery and improvements in conversion remain unverified until the production rollout and pilot. This change does not promise to bypass recipient-level restrictions.

## Verification

- Application unit tests cover cart validation, request parsing, expiry, supported cart shape and generated JavaScript syntax.
- Edge tests cover simultaneous template claims, historical attempts, database failures, duplicate inbound jobs, uncertain network outcomes and closed-window/draft behavior.
- Browser fixture checks cover mobile layout, intact checkout, product/quantity handoff and navigation to the prefilled WhatsApp request. Provider calls are intercepted; these tests send no messages.
- Run `npm run build`, `npm test`, `npm run lint`, targeted `deno check`, the new edge tests, and `bash scripts/check-migrations.sh` before rollout. Migration script checks filenames, not production schema history.

## References

- [Meta marketing examples](https://whatsappbusiness.com/products/conversation-categories/marketing/)
- [Meta service-window policy](https://whatsappbusiness.com/policy/)
- [Meta marketing optimization guide](https://whatsappbusiness.com/wp-content/uploads/2026/04/Best-Practices-for-Marketing-Messages-on-WhatsApp-.pdf), pages 46–50
- [Shopify cart permalinks](https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks)
