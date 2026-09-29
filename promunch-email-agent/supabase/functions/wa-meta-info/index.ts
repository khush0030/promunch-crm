// Read-only diagnostic: report the WhatsApp number's messaging tier, quality
// rating and throughput from the Meta Graph API, so we know how many
// business-initiated messages can go out per 24h before the cap kicks in.
//
// GET (no body). Auth: service-role bearer via requireInternal.

import { requireInternal } from "../_shared/require-internal.ts";
import { getAppSecret } from "../_shared/app-secrets.ts";
import { fetchWaTier } from "../_shared/wa-quota.ts";

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
    `${GRAPH}/${phoneId}?fields=verified_name,display_phone_number,quality_rating,throughput,name_status,code_verification_status,platform_type`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const phone = await phoneRes.json();
  // Messaging tier on its own request: Meta deprecated messaging_limit_tier in
  // favour of whatsapp_business_manager_messaging_limit, and an unknown field
  // fails the whole Graph request. Both keys are reported (same value) so older
  // dashboard readers keep working.
  const tier = await fetchWaTier(token, phoneId);
  if (phone && typeof phone === "object" && !phone.error) {
    phone.whatsapp_business_manager_messaging_limit = tier;
    phone.messaging_limit_tier = tier;
  }

  let account: unknown = null;
  let phoneNumbers: unknown = null;
  if (waba) {
    const accRes = await fetch(
      `${GRAPH}/${waba}?fields=account_review_status,business_verification_status,country,timezone_id`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    account = await accRes.json();
    const pnRes = await fetch(
      `${GRAPH}/${waba}/phone_numbers?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    phoneNumbers = await pnRes.json();
  }

  // Operator-set daily budget — app_secrets (dashboard-editable, no redeploy)
  // then Deno.env fallback. The dashboard quota view combines it with the Meta
  // tier the same way the campaign engine does (lower wins; _shared/wa-quota.ts).
  const rawOverride = (await getAppSecret("WA_DAILY_SEND_LIMIT")) ?? Deno.env.get("WA_DAILY_SEND_LIMIT") ?? "";
  const override = Number(rawOverride);
  const daily_limit_override = Number.isFinite(override) && override > 0 ? Math.floor(override) : null;

  return j({ ok: phoneRes.ok, phone, messaging_limit_tier: tier, account, phoneNumbers, daily_limit_override,
    marketing_routing: {
      mm_lite_enabled: ["true", "1"].includes((Deno.env.get("WA_MM_LITE_ENABLED") ?? "").trim().toLowerCase()),
      graph_version: Deno.env.get("WA_MM_LITE_GRAPH_VERSION") ?? Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v21.0",
      // The local flag is NOT proof that Meta onboarding is complete.
      meta_onboarding_verified: false,
    },
  });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
