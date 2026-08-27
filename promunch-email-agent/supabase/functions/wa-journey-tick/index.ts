// Cron: deliver due WhatsApp journey messages.
//
// Drains wa_journey_runs where status='active' and next_action_at <= now.
// Schedule every ~15 min:
//   supabase functions schedule create wa-journey-tick "*/15 * * * *"
//
// If a journey's template is not yet approved by Meta, the run is left active
// and retried on the next tick (so journeys self-heal once templates land).

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { TIMED_JOURNEYS } from "../_shared/journeys.ts";
import { getFlowSettings } from "../_shared/flow-settings.ts";
import { CUSTOM_KEY_PREFIX, loadCustomFlows } from "../_shared/custom-flows.ts";
import { isOrderCancelled } from "../_shared/orders.ts";
import { logConnector } from "../_shared/connector-log.ts";
import { WINDOW_DELIVER_JOURNEYS, claimAsk, releaseAsk, sessionOpen } from "../_shared/window-asks.ts";
import { isCapError, isMarketingTemplate, isUndeliverableError, marketingAllowed } from "../_shared/marketing-governor.ts";
import { inCallWindow, nextWindowOpen, voiceEligibility } from "../_shared/voice-eligibility.ts";

const BATCH = 200;
// Max times to retry the (per-recipient-capped) template fallback for a
// post-purchase ask before standing down and waiting for an open 24h window.
// (abandoned_checkout gets a longer leash here because a live cart is real
// revenue — but it is no longer unlimited: TPL_CAP_ATTEMPTS_MAX below retires
// the template path for carts too once Meta has capped that recipient.)
const TPL_FALLBACK_MAX = 3;
// Meta error #131049 is a per-recipient MARKETING FATIGUE verdict, not a
// transient error: the recipient has no marketing slot for us right now, and
// retrying into it is what deepens the fatigue. So a capped template attempt is
// TERMINAL for that recipient + template after one retry — including for carts,
// which used to probe every cart_backoff_hours until the 72h deadline (up to 12
// attempts on one person, and 80 across one customer's runs in August).
//
// Standing down does NOT drop the run: it stays 'active' with the template path
// retired (context.tpl_stood_down), so an open-window inbound piggyback can
// still deliver the same message as FREE TEXT — cap-immune, free, 99% delivered.
const TPL_CAP_ATTEMPTS_MAX = 2;   // first capped attempt + at most ONE retry
// How far to push a run whose marketing send the governor denied. Capped low for
// window-eligible journeys because next_action_at also gates the cap-immune
// free-text paths (the tick's in-window delivery and wa-ai-reply's inbound
// weave) — deferring those for a day would throw away the delivery route we
// actually want. Re-checking the governor a few times a day costs one query.
const GOVERNOR_DEFER_MAX_MS_WINDOW = 6 * 3600_000;
const GOVERNOR_DEFER_MAX_MS_OTHER = 24 * 3600_000;

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const sb = db();
  const now = new Date().toISOString();

  // Dashboard flow settings (Flows tab): per-journey kill-switch + cart backoff.
  const flows = await getFlowSettings();
  const flowEnabled: Record<string, boolean> = {
    abandoned_checkout: flows.abandoned_cart_enabled,
    review_request: flows.review_request_enabled,
    replenishment_reminder: flows.replenishment_enabled,
  };
  // User-created flows (journey_key 'custom:<id>') — for enabled/deleted checks.
  const customFlows = new Map((await loadCustomFlows()).map((f) => [f.id, f]));

  const { data: due, error } = await sb
    .from("wa_journey_runs")
    .select("*")
    .eq("status", "active")
    .lte("next_action_at", now)
    .order("next_action_at", { ascending: true })
    .limit(BATCH);
  if (error) return j({ ok: false, error: error.message }, 500);

  // Customers with a LIVE support ticket are paused, not marketed to. A review
  // ask / restock nudge / cart reminder landing mid-complaint reads as
  // tone-deaf. Pull every wa_id with an open/pending ticket once, up front, and
  // defer their due runs by 12h (nothing is lost — they resume after the ticket
  // resolves and the deadline guard above still retires genuinely-cold carts).
  const { data: ticketed } = await sb.from("wa_threads")
    .select("wa_id")
    .in("ticket_status", ["open", "pending"]);
  const blockedWa = new Set((ticketed ?? []).map((t) => t.wa_id));

  // UNSUBSCRIBED CUSTOMERS. wa_contacts.opted_in = false means either a bare
  // STOP (AGENTS.md §4.3) or a Meta #131050 verdict, which is the customer
  // switching our marketing off at the WhatsApp level. Until now only
  // wa-campaign-send honoured this flag, so an unsubscribed customer stopped
  // getting broadcasts but KEPT getting review asks, restock nudges and cart
  // recovery from this tick. That is the same promise broken by a different
  // door. Pull the opted-out numbers once, up front, and retire their MARKETING
  // runs below.
  //
  // Scope note: this gates MARKETING journeys only. Order confirmations,
  // shipping updates, COD verify and ops alerts do not run through journeys and
  // are untouched - an unsubscribe is from marketing, never from the
  // transactional messages a customer needs about an order they placed.
  const optedOutWa = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data: page } = await sb.from("wa_contacts")
      .select("wa_id")
      .eq("opted_in", false)
      .range(from, from + 999);
    if (!page || page.length === 0) break;
    for (const c of page) if (c.wa_id) optedOutWa.add(String(c.wa_id));
    if (page.length < 1000) break;
  }

  // A dial whose webhook never came back (Sarvam outage, crash between insert
  // and start) must not sit 'dialing' forever: it would block the per-cart and
  // 7-day guards. Mark unknown after 6h; never redial from here (§0). A row
  // swept to 'unknown' is NOT abandoned: verifyVoiceWebhook still accepts a
  // late webhook against it (dialing OR unknown), so the real Sarvam outcome
  // (including a do_not_call -> voice_dnd flag) can still land and finalise
  // the row once the webhook eventually arrives.
  await sb.from("voice_calls").update({ status: "unknown", updated_at: now })
    .eq("status", "dialing").lt("created_at", new Date(Date.now() - 6 * 3600_000).toISOString())
    .then(() => {}, () => {});

  let sent = 0, failed = 0, skipped = 0;

  for (const run of due ?? []) {
    // Custom flows carry their template/language in context (stamped at enrol);
    // built-ins come from TIMED_JOURNEYS.
    const isCustom = String(run.journey_key ?? "").startsWith(CUSTOM_KEY_PREFIX);
    const customFlow = isCustom
      ? customFlows.get(String(run.journey_key).slice(CUSTOM_KEY_PREFIX.length))
      : undefined;
    const cfg = isCustom
      ? (run.context?.template
          ? { template: String(run.context.template), language: String(run.context.language ?? "en"), delayHours: 0 }
          : undefined)
      : TIMED_JOURNEYS[run.journey_key];
    if (!cfg) {
      await mark(run.id, "failed", `unknown journey '${run.journey_key}'`);
      failed++;
      continue;
    }
    if (isCustom && !customFlow) {
      // Flow was deleted in the dashboard — retire its pending runs quietly.
      await mark(run.id, "cancelled", "custom flow deleted");
      skipped++;
      continue;
    }

    // DELIVERY-GUARANTEE deadline (abandoned_checkout): keep retrying a blocked
    // cart until ONE message is delivered or this passes. Past the deadline, stop
    // — the cart is cold and re-nudging it reads as spam. Record it (no Slack
    // noise) so the miss is measurable on the dashboard. delivered_at being set
    // means a message already landed; the run would not still be 'active' then.
    if (run.deadline_at && run.deadline_at < now) {
      await mark(run.id, "expired", `recovery deadline passed after ${run.attempts ?? 0} attempt(s)`);
      logConnector({
        connector: "shopify_wa", level: "warn", event: "cart_recovery_exhausted",
        message: `Cart ${run.order_ref ?? run.id}: no recovery message delivered in ${run.attempts ?? 0} attempt(s) before deadline.`,
        ref: run.order_ref ?? run.id,
      }).catch(() => {});
      skipped++;
      continue;
    }

    // Paused from the dashboard: hold the run (defer 6h), don't delete it —
    // re-enabling the flow resumes where it left off. Placed AFTER the
    // deadline guard so a paused cart still expires at its deadline instead
    // of nudging a days-cold cart when the flow comes back on.
    if (flowEnabled[run.journey_key] === false || (customFlow && !customFlow.enabled)) {
      await sb.from("wa_journey_runs").update({
        next_action_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
        last_error: "paused — flow disabled in dashboard settings",
      }).eq("id", run.id).then(() => {}, () => {});
      skipped++;
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

    // Pause marketing while this customer has an open/pending support ticket.
    // Defer (don't drop) the run so it resumes once the ticket is resolved.
    if (blockedWa.has(run.wa_id)) {
      const nextAt = new Date(Date.now() + 12 * 3600_000).toISOString();
      await sb.from("wa_journey_runs").update({
        next_action_at: nextAt,
        last_error: "paused — customer has an open support ticket",
      }).eq("id", run.id).then(() => {}, () => {});
      skipped++;
      continue;
    }

    // UNSUBSCRIBED: retire the run rather than deferring it. A STOP / #131050 is
    // not a "come back later" like an open ticket is, so there is nothing to
    // resume: cancel it and stop spending ticks on it. Checked BEFORE the
    // free-text window path on purpose - being inside an open 24h window makes a
    // message cap-immune, not consented, and weaving a review ask into a reply
    // to someone who unsubscribed is exactly the promise this guard exists to
    // keep. START re-opts them in, and any journey enrolled after that is new.
    if (optedOutWa.has(run.wa_id)) {
      const runTpl = run.context?.template ?? cfg.template;
      if (await isMarketingTemplate(runTpl)) {
        await mark(run.id, "cancelled", "customer unsubscribed from marketing (STOP or Meta #131050)");
        skipped++;
        continue;
      }
    }

    // ---- VOICE RESCUE CALL ----
    if (run.context?.channel === "voice") {
      const r = await handleVoiceRun(sb, run, flows, now);
      if (r === "sent") sent++; else if (r === "failed") failed++; else skipped++;
      continue;
    }

    const windowEligible = (WINDOW_DELIVER_JOURNEYS as readonly string[]).includes(run.journey_key);
    const isCart = run.journey_key === "abandoned_checkout";

    // In-window delivery: review_request / replenishment_reminder / abandoned_cart
    // recovery are MARKETING templates that Meta throttles per-recipient (131049).
    // If the customer's 24h service window is open, deliver a personalized
    // FREE-TEXT message instead — no cap, no fee. wa-ai-reply claims the run
    // atomically and composes it. Falls through to the (capped) template only if
    // the window is closed or the in-window send fails.
    // A cart's free-text recovery needs its checkout link (vars["2"]); runs
    // enrolled before that was stored fall straight through to the template
    // (which still carries the button) rather than send a linkless nudge.
    const freeTextReady = !isCart || !!run.context?.vars?.["2"];
    if (windowEligible && freeTextReady) {
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
    const capAttempts = Number(run.context?.tpl_cap_attempts ?? 0);
    const stoodDown = run.context?.tpl_stood_down === true;

    // TEMPLATE PATH RETIRED for this run: Meta has already told us (via #131049,
    // synchronously here or asynchronously in wa-webhook) that this recipient has
    // no marketing slot. Every further template attempt is a guaranteed failure
    // that makes the fatigue worse. Leave the run ACTIVE and skip: the in-window
    // free-text path above still runs on every tick, and an inbound message from
    // the customer can still deliver this ask for free.
    if (stoodDown || capAttempts >= TPL_CAP_ATTEMPTS_MAX) {
      // Push an hour out so a pile of retired runs cannot hot-loop the tick
      // every 15 min; hourly is still frequent enough to catch any 24h window.
      await sb.from("wa_journey_runs").update({
        next_action_at: new Date(Date.now() + 3600_000).toISOString(),
      }).eq("id", run.id).then(() => {}, () => {});
      skipped++;
      continue;
    }

    // ---- MARKETING FREQUENCY GOVERNOR ----
    // Marketing templates are capped PER RECIPIENT by Meta. Before spending an
    // attempt (and the recipient's fatigue budget) on one, ask the governor
    // whether this customer has room. Utility templates and the free-text path
    // above are never governed. The governor fails open on any lookup error, so
    // a governor bug can slow sends but can never stop them entirely.
    if (await isMarketingTemplate(tplName)) {
      const verdict = await marketingAllowed(sb, run.wa_id, tplName);
      if (!verdict.allowed) {
        const capMs = windowEligible ? GOVERNOR_DEFER_MAX_MS_WINDOW : GOVERNOR_DEFER_MAX_MS_OTHER;
        const waitMs = Math.min(verdict.retryAfterMs ?? capMs, capMs);
        await sb.from("wa_journey_runs").update({
          next_action_at: new Date(Date.now() + waitMs).toISOString(),
          last_error: `marketing governor: deferred — ${verdict.reason ?? "recent marketing activity"}`,
        }).eq("id", run.id).then(() => {}, () => {});
        skipped++;
        continue;
      }
    }

    if (windowEligible) {
      // Post-purchase asks stand down after a few capped attempts and wait for an
      // open window. Carts get more template attempts than post-purchase asks
      // (a cart is live revenue), but they are NOT unlimited any more: the
      // TPL_CAP_ATTEMPTS_MAX gate above retires the template path for both once
      // Meta has capped this recipient.
      if (!isCart && tplAttempts >= TPL_FALLBACK_MAX) { skipped++; continue; }
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
      // so the async delivery webhook can confirm (delivered) or reopen (failed)
      // THIS run — the linchpin of the at-least-once cart guarantee.
      journey_run_id: run.id,
    });

    if (res?.ok) {
      // window-eligible runs are already 'completed' via claimAsk above. NOTE:
      // ok here means Meta ACCEPTED the send, not that it was delivered — a
      // marketing template can still be async-failed (#131049) by the status
      // webhook, which reopens the run (see wa-webhook handleStatus).
      if (!windowEligible) await mark(run.id, "completed", null);
      sent++;
    } else if (isUndeliverableError(res?.error_code, res?.error)) {
      // #131026 — this number cannot receive WhatsApp at all. Not a cap, not
      // transient: retrying schedules another guaranteed failure, and the
      // free-text window path cannot reach them either (a window can only open
      // if they message us, which a dead number never will). Retire the run.
      // Checked BEFORE the cart branch on purpose: a cart is normally worth
      // retrying, but not to a number that does not exist.
      await mark(run.id, "failed", `recipient undeliverable (#${res?.error_code ?? 131026}) — number cannot receive WhatsApp, run retired`);
      logConnector({
        connector: "whatsapp", level: "warn", event: "recipient_undeliverable",
        message: `${run.wa_id}: #${res?.error_code ?? 131026} undeliverable — ${run.journey_key} run retired (number cannot receive WhatsApp).`,
        ref: String(run.wa_id),
      }).catch(() => {});
      failed++;
    } else if (isCart) {
      // Cart template send was rejected at call time. Don't drop it — hand the
      // claim back. WHERE it goes next depends on WHY it failed:
      //   • #131049 (per-recipient marketing cap): a terminal verdict for this
      //     recipient. Count the strike; after TPL_CAP_ATTEMPTS_MAX we retire
      //     the template path entirely (tpl_stood_down) and leave the run active
      //     and immediately due, so every tick keeps checking for an open 24h
      //     window and delivers the recovery as free text the moment there is
      //     one. This replaces the old "probe every 6h until the 72h deadline"
      //     loop, which spent up to 12 doomed attempts per cart.
      //   • anything else (transient/API): the original spaced backoff.
      // The 72h deadline (checked at the top) is still the hard stop either way.
      await releaseAsk(sb, run.id);
      const capped = isCapError(res?.error_code, res?.error);
      const nextCapAttempts = capped ? capAttempts + 1 : capAttempts;
      const standDown = capped && nextCapAttempts >= TPL_CAP_ATTEMPTS_MAX;
      // Stood down: re-check hourly (not every tick) — often enough to catch any
      // open 24h window well inside it, cheap enough that a pile of retired carts
      // can't crowd the BATCH limit out from under live runs.
      const nextAt = standDown
        ? new Date(Date.now() + 3600_000).toISOString()
        : new Date(Date.now() + flows.cart_backoff_hours * 3600_000).toISOString();
      await sb.from("wa_journey_runs").update({
        next_action_at: nextAt,
        attempts: (run.attempts ?? 0) + 1,
        last_error: standDown
          ? `cart template retired after ${nextCapAttempts} #131049 verdict(s) — waiting for an open 24h window to deliver free-form`
          : `cart template attempt ${(run.attempts ?? 0) + 1} failed: ${res?.error ?? "send failed"}`,
        context: {
          ...(run.context ?? {}),
          tpl_attempts: tplAttempts + 1,
          tpl_cap_attempts: nextCapAttempts,
          ...(standDown ? { tpl_stood_down: true } : {}),
        },
      }).eq("id", run.id).then(() => {}, () => {});
      failed++;
    } else if (windowEligible) {
      // Hand the claim back (status -> active) AND record the attempt, so the
      // template fallback is bounded but the run stays alive for the window path.
      // A #131049 rejection also books a cap strike, which retires the template
      // path after TPL_CAP_ATTEMPTS_MAX — the ask then waits for an open window
      // instead of burning the recipient's marketing budget on doomed retries.
      await releaseAsk(sb, run.id);
      const capped = isCapError(undefined, res?.error);
      const nextCapAttempts = capped ? capAttempts + 1 : capAttempts;
      const standDown = capped && nextCapAttempts >= TPL_CAP_ATTEMPTS_MAX;
      await sb.from("wa_journey_runs").update({
        last_error: standDown
          ? `template retired after ${nextCapAttempts} #131049 verdict(s) — waiting for an open 24h window`
          : `template fallback attempt ${tplAttempts + 1} failed: ${res?.error ?? "send failed"}`,
        context: {
          ...(run.context ?? {}),
          tpl_attempts: tplAttempts + 1,
          tpl_cap_attempts: nextCapAttempts,
          ...(standDown ? { tpl_stood_down: true } : {}),
        },
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

// Decide, claim, dial. Returns "sent" (call placed), "failed", or "skipped".
async function handleVoiceRun(
  sb: ReturnType<typeof db>,
  run: { id: string; wa_id: string; order_ref: string | null; created_at: string; context?: Record<string, unknown> },
  flows: Awaited<ReturnType<typeof getFlowSettings>>,
  now: string,
): Promise<"sent" | "failed" | "skipped"> {
  const nowMs = Date.parse(now);
  const defer = async (ms: number, why: string) => {
    await sb.from("wa_journey_runs").update({ next_action_at: new Date(nowMs + ms).toISOString(), last_error: why }).eq("id", run.id).then(() => {}, () => {});
    return "skipped" as const;
  };

  // Gather inputs (all reads; nothing is written until the claim below).
  // `calls` is NOT time-bounded: the per-cart attempt cap and cartConnected
  // check are lifetime, not 7-day (see voice-eligibility.ts's module comment).
  const [{ data: contact }, { data: waRows }, { data: th }, { data: calls }] = await Promise.all([
    sb.from("wa_contacts").select("opted_in, voice_dnd").eq("wa_id", run.wa_id).maybeSingle(),
    sb.from("wa_journey_runs").select("status, delivered_at, context, created_at")
      .eq("wa_id", run.wa_id).eq("journey_key", "abandoned_checkout").neq("id", run.id)
      .gte("created_at", new Date(Date.parse(run.created_at) - 60_000).toISOString()),
    sb.from("wa_threads").select("last_inbound_at").eq("wa_id", run.wa_id).maybeSingle(),
    sb.from("voice_calls").select("order_ref, created_at, status, attempt_id").eq("wa_id", run.wa_id),
  ]);
  const rows = (waRows ?? []).filter((r) => (r.context as Record<string, unknown> | null)?.channel !== "voice");
  const stood = (r: { context: unknown }) => {
    const c = (r.context ?? {}) as Record<string, unknown>;
    return c.tpl_stood_down === true || Number(c.tpl_cap_attempts ?? 0) >= TPL_CAP_ATTEMPTS_MAX;
  };
  // A REAL dial attempt is one Sarvam actually placed: connected/no_answer/
  // busy/failed, or an 'unknown' row that has an attempt_id (Sarvam accepted
  // it but the webhook never confirmed the outcome). 'start_failed' and a
  // 'dialing'/'unknown' row with no attempt_id never rang the customer's
  // phone at all (our own fetch to voice-call-start failed before Sarvam was
  // ever reached) so they don't consume the 2-attempt cart budget — that
  // failure mode is bounded separately by the voice_start_failures strikes
  // counter below.
  const isRealAttempt = (c: { status: string; attempt_id: string | null }) =>
    c.status === "connected" || c.status === "no_answer" || c.status === "busy" || c.status === "failed" ||
    (c.status === "unknown" && !!c.attempt_id);
  const cartCalls = (calls ?? []).filter((c) => c.order_ref === run.order_ref);
  const verdict = voiceEligibility({
    enabled: flows.voice_call_enabled,
    cartTotal: Number(run.context?.total ?? 0),
    minCartValue: flows.voice_min_cart_value,
    voiceDnd: contact?.voice_dnd === true,
    optedIn: contact?.opted_in !== false,
    inboundSinceEnrol: !!th?.last_inbound_at && Date.parse(th.last_inbound_at) > Date.parse(run.created_at),
    waDelivered: rows.some((r) => !!r.delivered_at),
    waStoodDown: rows.some(stood),
    waPending: rows.some((r) => r.status === "active"),
    cartConnected: cartCalls.some((c) => c.status === "connected"),
    cartAttempts: cartCalls.filter(isRealAttempt).length,
    cartInFlight: cartCalls.some((c) => c.status === "dialing"),
    connectedWithin7d: (calls ?? []).some((c) =>
      c.status === "connected" && Date.parse(c.created_at) >= nowMs - 7 * 86400_000),
  });
  if (verdict.action === "cancel") {
    await mark(run.id, "cancelled", `voice: ${verdict.reason}`);
    return "skipped";
  }
  if (verdict.action === "defer") return defer(verdict.hours * 3600_000, `voice: ${verdict.reason}`);
  if (!inCallWindow(nowMs, flows.voice_call_start_hour, flows.voice_call_end_hour)) {
    const open = nextWindowOpen(nowMs, flows.voice_call_start_hour).getTime();
    return defer(open - nowMs, "voice: outside call window");
  }

  // Sarvam not configured: hold rather than burn the run.
  if (!Deno.env.get("SARVAM_APP_ID")) return defer(6 * 3600_000, "voice: SARVAM_* secrets not set");
  // Rollout allowlist (spec §9): while VOICE_TEST_WA_IDS is set, only those
  // numbers are dialled; everyone else waits. Unset it after the live test.
  const allow = (Deno.env.get("VOICE_TEST_WA_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(run.wa_id)) return defer(6 * 3600_000, "voice: not in VOICE_TEST_WA_IDS allowlist");

  // ATOMIC CLAIM: active -> completed, exactly one tick wins. Crash after this
  // point loses the call, never duplicates it.
  const { data: claimed } = await sb.from("wa_journey_runs")
    .update({ status: "completed", last_error: null }).eq("id", run.id).eq("status", "active").select("id");
  if (!claimed?.length) return "skipped";

  const token = crypto.randomUUID().replace(/-/g, "");
  const { data: call, error: insErr } = await sb.from("voice_calls")
    .insert({ run_id: run.id, wa_id: run.wa_id, order_ref: run.order_ref, webhook_token: token, status: "dialing" })
    .select("id").single();
  if (insErr || !call) {
    await sb.from("wa_journey_runs").update({ status: "active", next_action_at: new Date(nowMs + 3600_000).toISOString(), last_error: `voice: ledger insert failed ${insErr?.message ?? ""}` }).eq("id", run.id);
    return "failed";
  }

  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-call-start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ call_id: call.id }),
  }).catch(() => null);
  const res = r ? await r.json().catch(() => ({ ok: false })) as { ok?: boolean; error?: string } : { ok: false, error: "fetch failed" };
  if (res.ok) return "sent";

  // Start failed: hand the run back with a bounded retry (3 strikes).
  const strikes = Number(run.context?.voice_start_failures ?? 0) + 1;
  if (strikes >= 3) {
    await mark(run.id, "failed", `voice: start failed ${strikes}x — ${res.error ?? "unknown"}`);
  } else {
    await sb.from("wa_journey_runs").update({
      status: "active", next_action_at: new Date(nowMs + 3600_000).toISOString(),
      last_error: `voice: start failed (${strikes}/3) — ${res.error ?? "unknown"}`,
      context: { ...(run.context ?? {}), voice_start_failures: strikes },
    }).eq("id", run.id);
  }
  return "failed";
}

// error_code is Meta's numeric verdict, forwarded by wa-send. Classify on it
// rather than on the prose wherever it is present: the text is English-only and
// Meta rewords it, while the code is stable (#131049 cap vs #131026 dead number
// vs #131050 opt-out are three different decisions).
async function callWaSend(
  body: unknown,
): Promise<{ ok?: boolean; error?: string; error_code?: number | null } | null> {
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
