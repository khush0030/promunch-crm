// Set email marketing consent on existing Shopify customers (for re-marketing
// imported/known customers). Takes an explicit list of customer ids so it can
// never touch anyone you didn't name — in particular it will NOT override a
// customer who explicitly opted out unless you force it.
//
// POST { customer_ids: string[], state?: "SUBSCRIBED" | "UNSUBSCRIBED",
//        opt_in_level?: "SINGLE_OPT_IN" | "CONFIRMED_OPT_IN" }
//
// Auth: service-role bearer via requireInternal (verify_jwt alone is NOT
// authorization — the public anon key passes it).

import { adminGraphQL } from "../_shared/shopify-customer.ts";
import { requireInternal } from "../_shared/require-internal.ts";

const MUTATION = `
mutation setConsent($input: CustomerEmailMarketingConsentUpdateInput!) {
  customerEmailMarketingConsentUpdate(input: $input) {
    customer { id email emailMarketingConsent { marketingState marketingOptInLevel } }
    userErrors { field message }
  }
}`;

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const ids = Array.isArray(body.customer_ids) ? body.customer_ids.map(String) : [];
  if (!ids.length) return j({ error: "customer_ids required" }, 400);
  const state = String(body.state ?? "SUBSCRIBED");
  const optIn = String(body.opt_in_level ?? "SINGLE_OPT_IN");
  const consentUpdatedAt = new Date().toISOString();

  const results: Array<Record<string, unknown>> = [];
  for (const raw of ids) {
    const gid = raw.startsWith("gid://") ? raw : `gid://shopify/Customer/${raw}`;
    try {
      const r = await adminGraphQL(MUTATION, {
        input: { customerId: gid, emailMarketingConsent: { marketingState: state, marketingOptInLevel: optIn, consentUpdatedAt } },
      });
      const node = r?.data?.customerEmailMarketingConsentUpdate;
      const errs = node?.userErrors ?? r?.errors;
      if (errs && errs.length) {
        results.push({ id: raw, ok: false, error: JSON.stringify(errs) });
      } else {
        results.push({ id: raw, ok: true, email: node?.customer?.email, state: node?.customer?.emailMarketingConsent?.marketingState });
      }
    } catch (e) {
      results.push({ id: raw, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return j({ ok: results.every((x) => x.ok), updated: results.filter((x) => x.ok).length, results });
});
