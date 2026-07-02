// Periodic WhatsApp Cloud API health probe (cron).
//
// Pings the phone-number endpoint and logs an up/down heartbeat to
// connector_events. The dashboard status meter computes uptime % from these.
//
// Schedule every 10 minutes (Supabase SQL editor):
//   select cron.schedule('wa-health', '*/10 * * * *',
//     $$select net.http_post(
//        url:='https://hlykspakpewuilttnydm.supabase.co/functions/v1/wa-health')$$);

import { logConnector } from "../_shared/connector-log.ts";
import { requireInternal } from "../_shared/require-internal.ts";

const GRAPH = `https://graph.facebook.com/${Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v21.0"}`;

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  let ok = false;
  let detail: Record<string, unknown> = {};

  if (!token || !phoneId) {
    detail = { error: "WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set" };
  } else {
    try {
      const r = await fetch(
        `${GRAPH}/${phoneId}?fields=verified_name,quality_rating,name_status,code_verification_status,platform_type`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const j = await r.json().catch(() => ({}));
      ok = r.ok;
      detail = ok ? j : (j?.error ?? { http_status: r.status });
    } catch (e) {
      detail = { error: String(e) };
    }
  }

  await logConnector({
    connector: "whatsapp",
    level: ok ? "info" : "error",
    event: ok ? "health_ok" : "health_down",
    message: ok
      ? `WhatsApp Cloud API healthy${detail?.quality_rating ? ` — quality: ${detail.quality_rating}` : ""}.`
      : `WhatsApp Cloud API check failed: ${JSON.stringify(detail).slice(0, 200)}`,
    detail,
  });

  return new Response(JSON.stringify({ ok, detail }), {
    status: ok ? 200 : 503,
    headers: { "content-type": "application/json" },
  });
});
