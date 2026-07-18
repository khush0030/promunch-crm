// Read-only diagnostic: report the WhatsApp number's messaging tier, quality
// rating and throughput from the Meta Graph API, so we know how many
// business-initiated messages can go out per 24h before the cap kicks in.
//
// GET (no body). Auth: service-role bearer via requireInternal.

import { requireInternal } from "../_shared/require-internal.ts";

const GRAPH = `https://graph.facebook.com/${Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v21.0"}`;

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const waba = Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID");
  if (!token || !phoneId) {
    return j({ error: "missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID" }, 500);
  }

  const phoneRes = await fetch(
    `${GRAPH}/${phoneId}?fields=verified_name,display_phone_number,quality_rating,messaging_limit_tier,throughput,name_status,code_verification_status,platform_type`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const phone = await phoneRes.json();

  let account: unknown = null;
  let phoneNumbers: unknown = null;
  if (waba) {
    const accRes = await fetch(
      `${GRAPH}/${waba}?fields=account_review_status,business_verification_status,country,timezone_id`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    account = await accRes.json();
    // The WABA phone_numbers edge reliably returns messaging_limit_tier.
    const pnRes = await fetch(
      `${GRAPH}/${waba}/phone_numbers?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    phoneNumbers = await pnRes.json();
  }

  return j({ ok: phoneRes.ok, phone, account, phoneNumbers });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
