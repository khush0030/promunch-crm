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
import { WINDOW_ASK_JOURNEYS, claimAsk, releaseAsk, sessionOpen } from "../_shared/window-asks.ts";

const BATCH = 200;
// Max times to retry the (per-recipient-capped) template fallback for a
// window-eligible ask before standing down and waiting for an open 24h window.
const TPL_FALLBACK_MAX = 3;

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

    const windowEligible = (WINDOW_ASK_JOURNEYS as readonly string[]).includes(run.journey_key);

    // In-window delivery: review_request / replenishment_reminder are MARKETING
    // templates that Meta throttles per-recipient (131049). If the customer's 24h
    // service window is open, deliver a personalized FREE-TEXT ask instead — no
    // cap, no fee. wa-ai-reply claims the run atomically and composes the message
    // from the customer's real order. Falls through to the (capped) template only
    // if the window is closed or the in-window send fails.
    if (windowEligible) {
      const { data: th } = await sb
        .from("wa_threads")
        .select("id, last_inbound_at")
        .eq("wa_id", run.wa_id)
        .maybeSingle();
      if (th?.id && sessionOpen(th.last_inbound_at, Date.now())) {
        const res = await callProactiveAsk(th.id, run);
        if (res?.skipped) { skipped++; continue; }   // already delivered by another path
        if (res?.sent) { sent++; continue; }          // delivered in-window, free
        // else: window closed at Meta / generation failed → fall through to template
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

    // For the in-window-eligible asks, the template is only a FALLBACK (the
    // window path is preferred). Meta throttles these per-recipient (131049), so
    // cap how many times we hammer the template — after TPL_FALLBACK_MAX failed
    // attempts, leave the run 'active' (so an inbound piggyback can still deliver
    // it in an open window) but stop re-sending the capped template every tick.
    const tplAttempts = Number(run.context?.tpl_attempts ?? 0);
    if (windowEligible) {
      if (tplAttempts >= TPL_FALLBACK_MAX) { skipped++; continue; }
      // claim atomically before the send so an inbound piggyback can't also send.
      if (!(await claimAsk(sb, run.id))) { skipped++; continue; }
    } else {
      // Atomically claim non-window runs (e.g. abandoned_checkout) before sending
      // so two overlapping ticks can't both grab the same active run and
      // double-send. Mirrors claimAsk: active -> completed in one UPDATE; if no
      // row changed, another tick already has it. Biases to "lost on crash, never
      // duplicate" (a crash after claim leaves it completed-but-unsent), per the
      // no-spam rule. A send failure below flips it to 'failed'.
      const { data: claimed } = await sb.from("wa_journey_runs")
        .update({ status: "completed", last_error: null })
        .eq("id", run.id).eq("status", "active")
        .select("id");
      if (!(claimed && claimed.length)) { skipped++; continue; }
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

    if (res?.ok) {
      // window-eligible runs are already 'completed' via claimAsk above.
      if (!windowEligible) await mark(run.id, "completed", null);
      sent++;
    } else if (windowEligible) {
      // Hand the claim back (status -> active) AND record the attempt, so the
      // template fallback is bounded but the run stays alive for the window path.
      await releaseAsk(sb, run.id);
      await sb.from("wa_journey_runs").update({
        last_error: `template fallback attempt ${tplAttempts + 1} failed: ${res?.error ?? "send failed"}`,
        context: { ...(run.context ?? {}), tpl_attempts: tplAttempts + 1 },
      }).eq("id", run.id).then(() => {}, () => {});
      failed++;
    } else {
      await mark(run.id, "failed", res?.error ?? "send failed");
      failed++;
    }
  }

  return j({ ok: true, processed: due?.length ?? 0, sent, failed, skipped });
});

async function mark(id: string, status: string, lastError: string | null) {
  await db().from("wa_journey_runs").update({ status, last_error: lastError }).eq("id", id);
}

// Delegate an in-window ask to wa-ai-reply, which claims the run atomically and
// sends ONE personalized free-text message built from the customer's real order.
// Returns { ok, sent } on delivery, { skipped } if another path already claimed
// it, or { ok:false } if the in-window send failed (claim released inside).
async function callProactiveAsk(
  threadId: string,
  run: { id: string; journey_key: string; context?: { vars?: Record<string, string> } },
): Promise<{ ok?: boolean; sent?: boolean; skipped?: string; error?: string }> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-ai-reply`;
  const vars = run.context?.vars ?? {};
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        thread_id: threadId,
        proactive_ask: {
          run_id: run.id,
          journey_key: run.journey_key,
          url: vars["2"],
          name: vars["1"],
        },
      }),
    });
    return await r.json().catch(() => ({ ok: false }));
  } catch (e) {
    return { ok: false, error: String(e) };
  }
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
