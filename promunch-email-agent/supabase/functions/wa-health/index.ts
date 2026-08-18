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
    // Meta's graph endpoint throws the odd 5xx / network blip. One of those is
    // not an outage, but logging it as health_down fires a CRITICAL "verify
    // WHATSAPP_ACCESS_TOKEN" alert at whatever hour it happens. Retry transient
    // failures (5xx, 429, network) with backoff and only report down when the
    // probe fails every time. Auth/permission errors (4xx other than 429) are
    // real and reported on the first attempt with no retry.
    const url =
      `${GRAPH}/${phoneId}?fields=verified_name,quality_rating,name_status,code_verification_status,platform_type`;
    const ATTEMPTS = 3;
    const BACKOFF_MS = [2000, 5000];
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      let transient = true;
      try {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json().catch(() => ({}));
        ok = r.ok;
        detail = ok ? j : (j?.error ?? { http_status: r.status });
        if (ok) break;
        transient = r.status >= 500 || r.status === 429;
        if (!transient) break; // real auth/permission failure — alert now
      } catch (e) {
        detail = { error: String(e) };
      }
      if (attempt < ATTEMPTS - 1) {
        detail = { ...detail, attempts: attempt + 1 };
        await new Promise((res) => setTimeout(res, BACKOFF_MS[attempt]));
      } else {
        detail = { ...detail, attempts: ATTEMPTS, retried: true };
      }
      if (!transient) break;
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
