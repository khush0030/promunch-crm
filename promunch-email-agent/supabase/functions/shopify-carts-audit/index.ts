// Measure the REAL abandoned-checkout population straight from Shopify.
//
// We do not store abandoned checkouts anywhere, so every recovery number so far
// has been measured against carts we managed to ENROL — which silently excluded
// the ones we never saw. That makes the funnel look far healthier than it is and
// hides the only question that decides strategy:
//
//   how many abandoned carts carry a PHONE (WhatsApp-reachable, but throttled by
//   Meta's per-recipient marketing cap #131049) versus only an EMAIL (not
//   throttled at all, and now covered by the checkout_abandoned email flow)?
//
// Read-only. Internal-only. Reports counts and the coverage gap against
// wa_journey_runs, never mutates anything.

import { requireInternal } from "../_shared/require-internal.ts";
import { db } from "../_shared/supabase.ts";

const API_VERSION = "2025-01";

let cached: { token: string; exp: number } | null = null;

async function getAdminToken(domain: string): Promise<string | null> {
  const id = Deno.env.get("SHOPIFY_CLIENT_ID");
  const secret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  if (!id || !secret) return null;
  const now = Date.now();
  if (cached && cached.exp > now + 60_000) return cached.token;
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!res.ok) return null;
  const j = await res.json() as { access_token: string; expires_in?: number };
  cached = { token: j.access_token, exp: now + (j.expires_in ?? 86399) * 1000 };
  return cached.token;
}

function hasPhone(c: any): boolean {
  return Boolean(
    c?.phone ?? c?.customer?.phone ?? c?.shipping_address?.phone ?? c?.billing_address?.phone,
  );
}
function hasEmail(c: any): boolean {
  return Boolean(c?.email ?? c?.customer?.email);
}
function noteHasRecoveryLink(c: any): boolean {
  const hay = `${c?.note ?? ""} ${JSON.stringify(c?.note_attributes ?? [])}`;
  return /(atomsSt=|bzCartRec=)/.test(hay);
}

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;

  const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  if (!domain) return j({ ok: false, error: "SHOPIFY_STORE_DOMAIN unset" }, 500);
  const token = await getAdminToken(domain);
  if (!token) return j({ ok: false, error: "admin-not-configured" }, 500);

  const days = Number(new URL(req.url).searchParams.get("days") ?? "30");
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const carts: any[] = [];
  let url: string | null =
    `https://${domain}/admin/api/${API_VERSION}/checkouts.json?limit=250&created_at_min=${encodeURIComponent(since)}`;
  try {
    while (url && carts.length < 2000) {
      const res: Response = await fetch(url, {
        headers: { "X-Shopify-Access-Token": token, "Accept": "application/json" },
      });
      if (!res.ok) {
        return j({
          ok: false,
          error: `checkouts.json ${res.status}: ${(await res.text()).slice(0, 200)}`,
          hint: "app likely missing read_orders / read_checkouts scope",
        }, 502);
      }
      const body = await res.json() as { checkouts?: any[] };
      carts.push(...(body.checkouts ?? []));
      const link = res.headers.get("link") ?? "";
      const next = /<([^>]+)>;\s*rel="next"/.exec(link);
      url = next ? next[1] : null;
    }
  } catch (e) {
    return j({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502);
  }

  let phone = 0, emailOnly = 0, both = 0, neither = 0, recoverable = 0, value = 0;
  const tokens: string[] = [];
  for (const c of carts) {
    const p = hasPhone(c), e = hasEmail(c);
    if (p && e) both++;
    else if (p) phone++;
    else if (e) emailOnly++;
    else neither++;
    if (noteHasRecoveryLink(c)) recoverable++;
    value += parseFloat(c?.total_price ?? "0") || 0;
    if (c?.token) tokens.push(String(c.token));
  }

  // How many of these did we actually enrol into WhatsApp recovery?
  let enrolled = 0;
  const sb = db();
  for (let i = 0; i < tokens.length; i += 200) {
    const slice = tokens.slice(i, i + 200);
    const { data } = await sb.from("wa_journey_runs")
      .select("order_ref")
      .eq("journey_key", "abandoned_checkout")
      .in("order_ref", slice);
    enrolled += new Set((data ?? []).map((r) => r.order_ref)).size;
  }

  const reachable = both + phone + emailOnly;
  return j({
    ok: true,
    window_days: days,
    abandoned_carts: carts.length,
    per_day: +(carts.length / days).toFixed(1),
    total_value: Math.round(value),
    contactable: {
      phone_and_email: both,
      phone_only: phone,
      email_only: emailOnly,
      no_contact_info: neither,
      reachable_total: reachable,
      reachable_pct: carts.length ? Math.round((reachable / carts.length) * 100) : 0,
    },
    has_smb_recovery_link: recoverable,
    whatsapp_enrolled: enrolled,
    coverage_gap: reachable - enrolled,
  });
});

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}
