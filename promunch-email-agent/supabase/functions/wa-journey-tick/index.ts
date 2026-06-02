// Cron: deliver due WhatsApp journey messages.
//
// Drains wa_journey_runs where status='active' and next_action_at <= now.
// Schedule every ~15 min:
//   supabase functions schedule create wa-journey-tick "*/15 * * * *"
//
// If a journey's template is not yet approved by Meta, the run is left active
// and retried on the next tick (so journeys self-heal once templates land).

import { db } from "../_shared/supabase.ts";
import { TIMED_JOURNEYS } from "../_shared/journeys.ts";
import { isOrderCancelled } from "../_shared/orders.ts";

const BATCH = 200;

Deno.serve(async () => {
  const sb = db();
  const now = new Date().toISOString();

  const { data: due, error } = await sb
    .from("wa_journey_runs")
    .select("*")
    .eq("status", "active")
    .lte("next_action_at", now)
    .order("next_action_at", { ascending: true })
    .limit(BATCH);
  if (error) return j({ ok: false, error: error.message }, 500);

  let sent = 0, failed = 0, skipped = 0;

  for (const run of due ?? []) {
    const cfg = TIMED_JOURNEYS[run.journey_key];
    if (!cfg) {
      await mark(run.id, "failed", `unknown journey '${run.journey_key}'`);
      failed++;
      continue;
    }

    // Shopify status guard — post-purchase journeys (review_request,
    // replenishment_reminder) are tied to an order. If that order was
    // cancelled/refunded after enrolment, drop the run instead of messaging
    // the customer about an order that no longer exists. (abandoned_checkout
    // is keyed by a checkout token, not an order — skip the check.)
    if (run.journey_key !== "abandoned_checkout" && run.order_ref) {
      if (await isOrderCancelled(run.order_ref)) {
        await mark(run.id, "cancelled", "order cancelled");
        skipped++;
        continue;
      }
    }

    // A run may override the journey's default template per step (e.g.
    // abandoned_checkout sends a no-coupon reminder first, then the coupon
    // template). Fall back to the journey default for older runs.
    const tplName = run.context?.template ?? cfg.template;
    const tplLang = run.context?.language ?? cfg.language;

    // template must be approved by Meta before we can send it
    const { data: tpl } = await sb
      .from("wa_templates")
      .select("status")
      .eq("name", tplName)
      .eq("language", tplLang)
      .maybeSingle();
    if (!tpl || tpl.status !== "approved") {
      skipped++; // leave active — retried next tick
      continue;
    }

    const res = await callWaSend({
      to: run.wa_id,
      kind: "template",
      template: {
        name: tplName,
        language: tplLang,
        // newer runs carry pre-built components (body + URL button); older
        // runs carry flat vars — wa-send falls back to vars when no components.
        components: run.context?.components,
        vars: run.context?.vars ?? {},
      },
      sent_by: `journey:${run.journey_key}`,
    });

    if (res?.ok) { await mark(run.id, "completed", null); sent++; }
    else { await mark(run.id, "failed", res?.error ?? "send failed"); failed++; }
  }

  return j({ ok: true, processed: due?.length ?? 0, sent, failed, skipped });
});

async function mark(id: string, status: string, lastError: string | null) {
  await db().from("wa_journey_runs").update({ status, last_error: lastError }).eq("id", id);
}

async function callWaSend(body: unknown): Promise<{ ok?: boolean; error?: string } | null> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
