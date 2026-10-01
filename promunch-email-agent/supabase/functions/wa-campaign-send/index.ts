// Bulk WhatsApp marketing broadcast — static or AI-personalised (engine v2).
//
// POST { campaign_id, _continue? }  (service-role bearer)
//   One batch of a campaign. Resumable + self-chaining: a productive batch
//   re-invokes itself with _continue:true; the pg_cron wa-campaign-worker
//   resurrects a dead chain and wakes deferred campaigns at resume_at.
//
// POST { test_to, campaign_id? | draft?: {template_id, template_vars,
//        header_media_url?, name?}, test_name? }
//   Test send to ONE number through the exact same component builder (header
//   media override, header text, buttons, UTM, AI). Writes NO wa_contacts row,
//   NO wa_messages row and NO claims, so it can never opt anyone in, never
//   count against the governor and never block the real campaign.
//
// NEVER MESSAGE A CUSTOMER TWICE (promunch-email-agent/CLAUDE.md §0). Layers:
//   1. wa_messages_campaign_recipient_uniq: at most one queued/sent/delivered/
//      read row per (campaign, contact). The per-recipient claim is an INSERT of
//      a 'queued' row BEFORE Meta is called; losing it = skip.
//   2. wa_marketing_daily_claims (PK contact+IST day): at most one CAMPAIGN
//      marketing message per contact per IST day across all campaigns.
//   3. Per-campaign send lock (send_lock_at, heartbeat-refreshed, owner-checked).
//   4. Only failures Meta EXPLICITLY refused (coded error) are ever retried.
//      A failure without a code, or a claim orphaned mid-send, is 'ambiguous'
//      and never re-sent.
//
// FOLLOW-UPS (campaign journeys, migration 20260930120000): a row with
// followup_of set is one journey step. It runs through this exact engine
// (same claims, governor, quiet hours, pause/cancel); its audience_filter is a
// retarget of its parent with min_hours_since, so people become eligible one
// by one as their time comes. Extra rules:
//   - does nothing until the parent has started; cancels itself if the parent
//     was cancelled; hard stop 30 days (plus its own delay) after the
//     parent started;
//   - never COMPLETES while the parent is still running (paused counts as
//     running) or while any parent recipient has yet to cross the delay: it
//     parks with resume_at = the next person's time (hourly re-check while
//     the parent runs) and keeps status 'scheduled' until it first sends.

import OpenAI from "npm:openai@4.78.0";
import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { SendResult, sendTemplate, TemplateComponent } from "../_shared/whatsapp.ts";
import { appendUtm, mintCode } from "../_shared/links.ts";
import { alertWaSendFailure, explainWaError, logConnector, postSlack, slackChannelFor } from "../_shared/connector-log.ts";
import { businessInitiatedUsage24h, fetchWaStanding } from "../_shared/wa-quota.ts";
import {
  MARKETING_PER_24H,
  MARKETING_PER_7D,
  marketingHoldSet,
  recordMarketingCap,
  recordMarketingOptOut,
} from "../_shared/marketing-governor.ts";
import {
  AMBIGUOUS_STOP_STREAK,
  budgetResumeAt,
  buildTemplateComponents,
  classifySyncFailure,
  contentChanged,
  contactVerdict,
  dynamicUrlButtons,
  FollowupParent,
  followupFilterError,
  followupFinish,
  followupGate,
  FollowupTiming,
  HOLD_RECHECK_MS,
  inQuietHours,
  isShortLinkBase,
  istDay,
  istDayStartMs,
  LedgerRow,
  MAX_CAMPAIGN_LIFETIME_MS,
  nextAllowedAt,
  nextWaveAt,
  shouldTripBreaker,
  SkipReason,
  TemplateSchema,
  templateVarKeys,
  validateCampaignSetup,
  WaErrorClass,
  waveMinute,
} from "../_shared/campaign-engine.ts";

const THROTTLE_MS = 120;
const MAX_STATIC = 50; //       per-invocation cap, static send
const MAX_PERSONALIZED = 20; // per-invocation cap, AI send (an OpenAI call each)
const STALE_MS = 10 * 60_000;
// The lock must outlive the longest gap between heartbeats (HEARTBEAT_EVERY
// AI sends ≈ 5 × ~4s) by a wide margin; it is refreshed, never just trusted.
const LOCK_TTL_MS = 180_000;
const HEARTBEAT_EVERY = 5;
const STALE_CLAIM_MS = 5 * 60_000;
const AI_RETRY_MS = 30 * 60_000;
const PERSONALIZE_MODEL = Deno.env.get("WA_PERSONALIZE_MODEL") ?? "gpt-4o-mini";

type Sb = ReturnType<typeof db>;
type Contact = { id: string; wa_id: string; name: string | null; email: string | null; tags: string[] | null };

interface Body {
  campaign_id?: string;
  _continue?: boolean;
  test_to?: string;
  test_name?: string;
  draft?: { template_id?: string; template_vars?: Record<string, unknown>; header_media_url?: string | null; name?: string };
}

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return j({ error: "method" }, 405);

  const body = (await req.json().catch(() => ({}))) as Body;
  if (body.test_to) return await handleTestSend(body);

  if (!body.campaign_id) return j({ error: "campaign_id required" }, 400);
  const campaignId: string = body.campaign_id;

  const sb = db();
  const { data: campaign } = await sb.from("wa_campaigns").select("*").eq("id", campaignId).single();
  if (!campaign) return j({ error: "campaign not found" }, 404);

  // v2 schema gate: refuse to run half-migrated (nothing is sent or changed).
  if (!("total_audience" in campaign) || !("header_media_url" in campaign)) {
    return j({ error: "campaign engine v2 migration (20260929120000) not applied — nothing sent" }, 500);
  }
  if (campaign.status === "completed") return j({ error: "campaign already completed" }, 409);
  if (campaign.status === "cancelled") return j({ error: "campaign is cancelled" }, 409);
  if (campaign.status === "paused") return j({ error: "campaign is paused — resume it first", paused: true }, 409);
  // A recurring series definition never sends itself; each occurrence is a child.
  if (campaign.repeat_rule) return j({ error: "recurring series: each occurrence sends as its own campaign" }, 409);
  if (campaign.status === "sending" && !body._continue) {
    const age = Date.now() - new Date(campaign.started_at ?? 0).getTime();
    if (age < STALE_MS && !campaign.resume_at) return j({ error: "campaign send already in progress" }, 409);
  }
  // resume_at is the single source of truth for dormancy, for ANY caller.
  if (campaign.resume_at && new Date(campaign.resume_at).getTime() > Date.now()) {
    return j({ ok: true, status: campaign.status, deferred: true, note: `dormant until ${campaign.resume_at}` });
  }

  // ---- follow-up (journey step) gate: before any lock or state change ----
  const isFollowup = !!campaign.followup_of;
  let parent: FollowupParent | null = null;
  let followupExpired = false;
  if (isFollowup) {
    const filterErr = followupFilterError(campaign);
    if (filterErr) return await failCampaign(sb, campaignId, filterErr);
    const { data: p, error: pErr } = await sb.from("wa_campaigns")
      .select("id,name,status,started_at").eq("id", campaign.followup_of).maybeSingle();
    // Fail closed: without the parent's state we can't know it is safe to send.
    if (pErr) return j({ error: `parent campaign read failed: ${pErr.message} — nothing sent` }, 500);
    parent = p ? { status: p.status as string, started_at: (p.started_at as string | null) ?? null } : null;
    const gate = followupGate(parent, Date.now(), Number(campaign.followup_after_hours) || 0);
    if (gate === "cancel") return await cancelFollowup(sb, campaignId, "The campaign it follows was cancelled.");
    if (gate === "wait_parent_start") {
      // Stay armed. A follow-up that was forced to 'sending' re-checks hourly
      // instead of being re-kicked (and stall-alerted) every few minutes.
      if (campaign.status === "sending") {
        await sb.from("wa_campaigns").update({ resume_at: new Date(Date.now() + 60 * 60_000).toISOString() })
          .eq("id", campaignId).eq("status", "sending");
      }
      return j({ ok: true, status: campaign.status, waiting: "parent_not_started", note: "starts once the campaign it follows is sent" });
    }
    followupExpired = gate === "expired";
  }

  // ---- start-time validation (B5/B8/B10): fail the campaign ONCE with a clear
  // reason instead of spraying a failure per recipient or looping alerts ----
  if (!campaign.template_id) return await failCampaign(sb, campaignId, "Campaign has no template.");
  const { data: tpl } = await sb.from("wa_templates").select("*").eq("id", campaign.template_id).single();
  if (!tpl) return await failCampaign(sb, campaignId, "Template not found (deleted?). Pick another template.");
  if (tpl.status !== "approved") {
    return await failCampaign(
      sb,
      campaignId,
      `Template '${tpl.name}' is '${tpl.status}' at Meta — it must be approved before this campaign can send.`,
    );
  }
  const baseVars: Record<string, unknown> = campaign.template_vars ?? {};
  const setupErrors = validateCampaignSetup(tpl as TemplateSchema, baseVars, campaign.header_media_url);
  if (setupErrors.length) {
    return await failCampaign(sb, campaignId, `Can't start: ${setupErrors.join("; ")}.`);
  }
  const aiBrief = typeof baseVars._ai_brief === "string" ? baseVars._ai_brief.trim() : "";
  const personalized = aiBrief.length > 0;
  const cap = personalized ? MAX_PERSONALIZED : MAX_STATIC;
  const waveMin = waveMinute(campaign.scheduled_at, campaign.started_at);
  // An armed follow-up that has not sent anything yet keeps status 'scheduled'
  // while it waits (the dashboard shows "waiting for the first people").
  const armedFollowup = isFollowup && campaign.status === "scheduled";

  // ---- atomic, owner-checked send lock ----
  let lockStamp = new Date().toISOString();
  const lockCutoff = new Date(Date.now() - LOCK_TTL_MS).toISOString();
  // WHAT is sent and to WHOM, re-read atomically with the lock: the row above
  // was read before we held it, and a dashboard edit (e.g. a follow-up's
  // stage/delay PATCH) landing in between must not be sent with the old rule.
  const contentCols: readonly string[] = [...CONTENT_COLS, ...(isFollowup ? FOLLOWUP_COLS : [])];
  const { data: lockRow, error: lockErr } = await sb
    .from("wa_campaigns")
    .update({ send_lock_at: lockStamp })
    .eq("id", campaignId)
    .in("status", ["draft", "scheduled", "sending", "failed"])
    .or(`send_lock_at.is.null,send_lock_at.lt.${lockCutoff}`)
    .select(["id", ...contentCols].join(","))
    .maybeSingle();
  if (lockErr) return j({ error: "send lock unavailable", detail: lockErr.message }, 500);
  if (!lockRow) return j({ ok: true, skipped: "another sender holds the lock (or the campaign was paused/cancelled)" });

  let lockHeld = true;
  const releaseLock = async () => {
    if (!lockHeld) return;
    lockHeld = false;
    await sb.from("wa_campaigns").update({ send_lock_at: null }).eq("id", campaignId).eq("send_lock_at", lockStamp);
  };
  if (contentChanged(campaign, lockRow as unknown as Record<string, unknown>, contentCols)) {
    // Nothing sent. The worker (or the next chain call) re-reads the new version.
    await releaseLock().catch(() => {});
    return j({ ok: true, skipped: "campaign was edited while this batch was starting; the next run uses the new version" });
  }
  // Refresh the lock (only if we still own it) and read the live status, so a
  // pause/cancel stops the batch within HEARTBEAT_EVERY sends.
  const heartbeat = async (): Promise<string | null> => {
    const next = new Date().toISOString();
    const { data } = await sb.from("wa_campaigns").update({ send_lock_at: next })
      .eq("id", campaignId).eq("send_lock_at", lockStamp).select("status").maybeSingle();
    if (!data) {
      lockHeld = false;
      return null;
    }
    lockStamp = next;
    return data.status as string;
  };

  try {
    return await runBatch();
  } finally {
    await releaseLock().catch(() => {});
  }

  async function runBatch(): Promise<Response> {
    const now = Date.now();

    // Quiet hours (21:00-09:00 IST): no marketing sends. Park until morning.
    if (followupExpired) {
      return await complete({
        reached: 0,
        skipped: (campaign.skipped_breakdown ?? {}) as Record<string, number>,
        note: "follow-up window ended (30 days plus the follow-up delay after the campaign it follows started)",
      });
    }

    if (inQuietHours(now)) {
      const at = new Date(nextAllowedAt(now, waveMin)).toISOString();
      if (armedFollowup) {
        await park(at);
        return j({ ok: true, status: "scheduled", deferred: true, resume_at: at, note: "quiet hours (21:00-09:00 IST)" });
      }
      await sb.from("wa_campaigns").update({
        status: "sending",
        started_at: campaign.started_at ?? new Date().toISOString(),
        resume_at: at,
        last_error: null,
      }).eq("id", campaignId).in("status", ["draft", "scheduled", "sending", "failed"]);
      return j({ ok: true, status: "sending", deferred: true, resume_at: at, note: "quiet hours (21:00-09:00 IST)" });
    }

    // B9: a claim still 'queued' long after its sender died is AMBIGUOUS: Meta
    // may or may not have accepted it. Never re-send it; record it visibly.
    await sb.from("wa_messages").update({
      status: "failed",
      error: "ambiguous: claim left queued by a sender that stopped mid-send; delivery unknown, not re-sent",
      error_class: "ambiguous",
    })
      .eq("campaign_id", campaignId).eq("direction", "outbound").eq("status", "queued")
      .lt("created_at", new Date(now - STALE_CLAIM_MS).toISOString());

    // ---- audience: the shared SQL definition (same as the dashboard preview) ----
    const contacts: Contact[] = [];
    for (let from = 0;; from += 1000) {
      const { data: page, error } = await sb
        .rpc("wa_campaign_audience", { p_filter: campaign.audience_filter ?? {}, p_campaign_id: campaignId })
        .order("id")
        .range(from, from + 999);
      if (error) return j({ error: `audience query failed: ${error.message}` }, 500);
      if (!page || page.length === 0) break;
      contacts.push(...(page as Contact[]));
      if (page.length < 1000) break;
    }
    if (contacts.length === 0 && isFollowup) {
      // Nobody is due yet (or nobody matched). Never complete early.
      const hold = await followupHold(now);
      if (hold) return hold;
    }
    if (contacts.length === 0) {
      await sb.from("wa_campaigns").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        last_error: "no opted-in recipients matched",
        resume_at: null,
        total_audience: campaign.total_audience ?? 0,
      }).eq("id", campaignId);
      return j({ ok: true, sent: 0, failed: 0, remaining: 0, status: "completed", note: "no recipients" });
    }
    if (campaign.total_audience == null) {
      await sb.from("wa_campaigns").update({ total_audience: contacts.length }).eq("id", campaignId);
    }

    // ---- ledger → per-contact verdicts ----
    const byContact = new Map<string, LedgerRow[]>();
    for (let from = 0;; from += 1000) {
      const { data: page, error } = await sb.from("wa_messages")
        .select("contact_id,status,error,error_class,created_at,ai_meta")
        .eq("campaign_id", campaignId).eq("direction", "outbound")
        .order("id").range(from, from + 999);
      if (error) return j({ error: `ledger read failed: ${error.message}` }, 500);
      if (!page || page.length === 0) break;
      for (const r of page as (LedgerRow & { contact_id: string | null; ai_meta: { code?: unknown } | null })[]) {
        if (!r.contact_id) continue;
        const list = byContact.get(r.contact_id) ?? [];
        list.push({ ...r, code: (r.ai_meta?.code as number | string | null | undefined) ?? null });
        byContact.set(r.contact_id, list);
      }
      if (page.length < 1000) break;
    }
    const todayStart = istDayStartMs(now);
    const skipped: Partial<Record<SkipReason, number>> = {};
    const candidates: Contact[] = [];
    const waitingNextDay: Contact[] = [];
    let reached = 0, inFlight = 0;
    for (const c of contacts) {
      const v = contactVerdict(byContact.get(c.id) ?? [], todayStart);
      if (v.kind === "reached") reached++;
      else if (v.kind === "in_flight") inFlight++;
      else if (v.kind === "done") skipped[v.reason] = (skipped[v.reason] ?? 0) + 1;
      else if (v.kind === "retry" && v.waitNextDay) waitingNextDay.push(c);
      else candidates.push(c);
    }

    // ---- temporary holds (deferred, never dropped) ----
    const held = new Map<string, "ticket" | "cart" | "governor" | "daily_claim">();
    if (candidates.length) {
      const { data: ticketed } = await sb.from("wa_threads").select("contact_id")
        .in("ticket_status", ["open", "pending"]).not("contact_id", "is", null);
      const ticketSet = new Set((ticketed ?? []).map((t) => t.contact_id as string));

      // CART PRIORITY: an in-flight abandoned-cart run outranks a broadcast.
      const activeCartWaIds = new Set<string>();
      for (let from = 0;; from += 1000) {
        const { data: page } = await sb.from("wa_journey_runs").select("wa_id")
          .eq("journey_key", "abandoned_checkout").eq("status", "active").range(from, from + 999);
        if (!page || page.length === 0) break;
        for (const r of page) if (r.wa_id) activeCartWaIds.add(String(r.wa_id));
        if (page.length < 1000) break;
      }

      // Per-recipient marketing frequency governor (rolling 24h / 7d, suppressions).
      // Also the ONLY coupling to journeys: their marketing template attempts
      // count here, so a campaign never lands on the same day as a journey send.
      const governorHeld = await marketingHoldSet(sb, candidates);

      // B6: another campaign already took this contact's marketing slot today.
      const today = istDay(now);
      const claimedElsewhere = new Set<string>();
      for (let from = 0;; from += 1000) {
        const { data: page, error } = await sb.from("wa_marketing_daily_claims")
          .select("contact_id,source_id").eq("ist_day", today).range(from, from + 999);
        if (error) return j({ error: `daily claim read failed: ${error.message}` }, 500);
        if (!page || page.length === 0) break;
        for (const r of page) if (r.source_id !== campaignId) claimedElsewhere.add(r.contact_id as string);
        if (page.length < 1000) break;
      }

      for (const c of candidates) {
        if (ticketSet.has(c.id)) held.set(c.id, "ticket");
        else if (activeCartWaIds.has(c.wa_id)) held.set(c.id, "cart");
        else if (governorHeld.has(c.id)) held.set(c.id, "governor");
        else if (claimedElsewhere.has(c.id)) held.set(c.id, "daily_claim");
      }
    }
    const heldBreakdown: Record<string, number> = { ticket: 0, cart: 0, governor: 0, daily_claim: 0 };
    for (const r of held.values()) heldBreakdown[r]++;
    const eligibleNow = candidates.filter((c) => !held.has(c.id));

    const skippedCount = Object.values(skipped).reduce((a, b) => a + (b ?? 0), 0);
    await sb.from("wa_campaigns").update({
      skipped_breakdown: skipped,
      skipped_count: skippedCount,
      held_breakdown: heldBreakdown,
    }).eq("id", campaignId);

    const startedMs = Date.parse(campaign.started_at ?? new Date(now).toISOString());
    // A follow-up's people become eligible over up to 30 days, so its hard
    // stop is the journey lifetime (followupGate), not the 7-day campaign one.
    const lifetimeOver = !isFollowup && now - startedMs > MAX_CAMPAIGN_LIFETIME_MS;

    // ---- nothing sendable right now ----
    if (eligibleNow.length === 0) {
      const onlyHeldLeft = waitingNextDay.length === 0 && inFlight === 0;
      if (held.size === 0 && onlyHeldLeft) {
        if (isFollowup) {
          const hold = await followupHold(now, { reached, skipped });
          if (hold) return hold;
        }
        return await complete({ reached, skipped });
      }
      if (onlyHeldLeft && lifetimeOver) {
        // B4: held past the campaign lifetime → recorded as skipped, by reason.
        const final: Record<string, number> = { ...skipped };
        for (const [r, n] of Object.entries(heldBreakdown)) if (n) final[`held_${r}`] = n;
        return await complete({ reached, skipped: final, note: "campaign lifetime reached; held contacts skipped" });
      }
      const options: number[] = [];
      if (waitingNextDay.length) options.push(nextWaveAt(now, waveMin));
      if (held.size) options.push(nextAllowedAt(now + HOLD_RECHECK_MS, waveMin));
      if (inFlight) options.push(now + STALE_CLAIM_MS + 60_000);
      if (isFollowup) {
        // Someone new may become due before the held ones clear: wake for them.
        const timing = await readTiming().catch(() => null); // hold re-check below still bounds the wait
        const fin = followupFinish(parent, timing, now, waveMin, Number(campaign.followup_after_hours) || 0);
        if (fin.kind === "defer") options.push(fin.resumeAtMs);
      }
      const at = new Date(Math.min(...options)).toISOString();
      await defer(at);
      return j({
        ok: true, status: "sending", deferred: true, resume_at: at,
        waiting_next_day: waitingNextDay.length, held: heldBreakdown, in_flight: inFlight,
        note: waitingNextDay.length ? "today's wave done — resuming at the next wave" : "only held contacts remain — re-checking",
      });
    }

    // ---- proactive daily budget (rolling 24h unique recipients) ----
    let dailyRemaining: number | null = null;
    let oldestAt: number | null = null;
    const standing = await fetchWaStanding();
    if (standing?.limit != null) {
      const usage = await businessInitiatedUsage24h(sb);
      if (usage) {
        dailyRemaining = Math.max(0, standing.limit - usage.count);
        oldestAt = usage.oldestAt;
      }
    }
    if (dailyRemaining === 0) {
      const at = new Date(budgetResumeAt(now, oldestAt, waveMin)).toISOString();
      await defer(at);
      return j({
        ok: true, status: "sending", deferred: true, resume_at: at, remaining: eligibleNow.length,
        note: `daily limit reached (${standing?.tier ?? "?"} = ${standing?.limit}/24h unique recipients) — resuming when the rolling window frees`,
      });
    }
    const queue = eligibleNow.slice(0, Math.min(cap, dailyRemaining ?? cap));

    const { data: live } = await sb.from("wa_campaigns").update({
      status: "sending",
      started_at: campaign.started_at ?? new Date().toISOString(),
      last_error: null,
      resume_at: null,
    }).eq("id", campaignId).in("status", ["draft", "scheduled", "sending", "failed"]).select("id").maybeSingle();
    if (!live) return j({ ok: true, stopped: "campaign was paused or cancelled" });

    const openai = personalized ? new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! }) : null;
    const bodyKeys = templateVarKeys(tpl.body);
    const trackUrl = typeof baseVars._track_url === "string" && baseVars._track_url.trim()
      ? baseVars._track_url.trim()
      : null;
    const shortLinkButtons = dynamicUrlButtons(tpl as TemplateSchema).filter((b) => isShortLinkBase(b.base));
    const tagUrl = (u: string) => appendUtm(u, { medium: "campaign", campaign: campaign.name });
    const today = istDay(now);
    const sentBy = personalized ? "campaign-ai" : "campaign";

    let sent = 0, failed = 0, attempted = 0, claimSkipped = 0, aiSkipped = 0, dailyLost = 0, claimErrors = 0;
    const byClass: Record<WaErrorClass, number> = {
      cap: 0, optout: 0, terminal: 0, structural: 0, transient: 0, ambiguous: 0, unknown: 0,
    };
    let firstError: string | null = null;
    let stopReason: string | null = null;
    let ambiguousStreak = 0;
    const pathStats = { mm_lite_sent: 0, mm_lite_failed: 0, cloud_api_sent: 0, cloud_api_failed: 0, fallbacks: 0 };
    let firstMmLiteError: string | null = null;

    for (let i = 0; i < queue.length; i++) {
      const c = queue[i];
      if (i > 0 && i % HEARTBEAT_EVERY === 0) {
        const st = await heartbeat();
        if (st === null) { stopReason = "lock_lost"; break; }
        if (st !== "sending") { stopReason = st; break; }
        if (inQuietHours(Date.now())) { stopReason = "quiet_hours"; break; }
      }

      // 1. values for this recipient (AI first: a failed personalisation must
      //    never burn a claim or send a half-filled template)
      let contactVars: Record<string, unknown> = { ...baseVars };
      if (personalized && openai && bodyKeys.length) {
        const ai = await personalizeVars(openai, tpl.body ?? "", aiBrief, c, bodyKeys).catch(() => null);
        if (ai) contactVars = { ...contactVars, ...ai };
      }
      contactVars = Object.fromEntries(
        Object.entries(contactVars).map(([k, v]) => [k, typeof v === "string" && !k.startsWith("_") ? tagUrl(v) : v]),
      );
      const precheck = buildTemplateComponents(tpl as TemplateSchema, {
        vars: contactVars,
        contactName: c.name,
        headerMediaOverride: campaign.header_media_url,
        tagUrl,
        validationOnly: true,
      });
      if (precheck.errors.length) {
        // Nothing is sent. Record a failed (structural, no wamid) attempt so a
        // contact the model keeps failing on is retried at most
        // MAX_STRUCTURAL_ATTEMPTS times instead of blocking the queue forever.
        // Failed rows sit outside the per-campaign unique index and are ignored
        // by the governor, so this never blocks a later real send.
        aiSkipped++;
        const { data: th } = await sb.from("wa_threads")
          .upsert({ contact_id: c.id, wa_id: c.wa_id }, { onConflict: "contact_id" }).select("id").single();
        await sb.from("wa_messages").insert({
          thread_id: th?.id ?? null, contact_id: c.id, campaign_id: campaignId, direction: "outbound",
          type: "template", status: "failed", template_name: tpl.name, template_lang: tpl.language, sent_by: sentBy,
          error: `not sent: ${precheck.errors.join("; ")}`, error_class: "structural",
        });
        continue;
      }

      // 2. cross-campaign daily marketing claim (B6) — fail CLOSED on error
      const { data: gotDaily, error: dailyErr } = await sb.rpc("wa_take_marketing_daily_claim", {
        p_contact: c.id, p_day: today, p_source: "campaign", p_source_id: campaignId,
      });
      if (dailyErr) { claimErrors++; continue; }
      if (gotDaily !== true) { dailyLost++; continue; }

      // 3. per-campaign recipient claim (the hard per-campaign guarantee)
      const { data: thread } = await sb.from("wa_threads")
        .upsert({ contact_id: c.id, wa_id: c.wa_id }, { onConflict: "contact_id" })
        .select("id").single();
      const { data: claim, error: claimErr } = await sb.from("wa_messages").insert({
        thread_id: thread?.id ?? null,
        contact_id: c.id,
        campaign_id: campaignId,
        direction: "outbound",
        type: "template",
        status: "queued",
        template_name: tpl.name,
        template_lang: tpl.language,
        sent_by: sentBy,
      }).select("id").maybeSingle();
      if (claimErr || !claim) { claimSkipped++; continue; } // already handled → do NOT send

      // 4. tracked short links (only for /r/{{1}} buttons), then final build
      const trackedCodes: Record<number, string> = {};
      if (trackUrl) {
        for (const b of shortLinkButtons) {
          const code = await mintCode(sb, tagUrl(trackUrl), { contact_id: c.id, campaign_id: campaignId });
          if (code) trackedCodes[b.index] = code;
        }
      }
      const built = buildTemplateComponents(tpl as TemplateSchema, {
        vars: contactVars,
        contactName: c.name,
        headerMediaOverride: campaign.header_media_url,
        trackedCodes,
        tagUrl,
      });

      let res: SendResult;
      // Set when WE decided not to call Meta: the class is certain (nothing sent).
      let localClass: WaErrorClass | null = null;
      if (built.errors.length) {
        // Only reachable if tracked-link minting failed. Nothing was sent.
        res = { ok: false, message_id: null, raw: null, error: `not sent: ${built.errors.join("; ")}` };
        localClass = "transient";
      } else {
        try {
          res = await sendTemplate(c.wa_id, tpl.name, tpl.language, built.components as TemplateComponent[]);
        } catch (e) {
          res = { ok: false, message_id: null, raw: null, error: String(e) };
        }
      }
      attempted++;

      if (res.send_path === "mm_lite") res.ok ? pathStats.mm_lite_sent++ : pathStats.mm_lite_failed++;
      else if (res.send_path === "cloud_api") res.ok ? pathStats.cloud_api_sent++ : pathStats.cloud_api_failed++;
      if (res.mm_lite_fallback) {
        pathStats.fallbacks++;
        if (!firstMmLiteError) firstMmLiteError = res.mm_lite_error ?? "unknown";
      }

      const cls: WaErrorClass | null = res.ok
        ? null
        : localClass ?? classifySyncFailure(res.error_code, res.error, res.http_status ?? null);
      const explain = res.ok ? null : explainWaError(res.error_code, res.error ?? undefined);
      await sb.from("wa_messages").update({
        body: `[campaign:${campaign.name}]`,
        template_vars: contactVars,
        wa_message_id: res.message_id,
        status: res.ok ? "sent" : "failed",
        error: res.ok ? null : res.error,
        error_class: cls,
        ...(explain
          ? { ai_meta: { category: explain.category, cause: explain.cause, code: res.error_code ?? null, class: cls } }
          : {}),
      }).eq("id", claim.id);
      // NOTE: thread last_outbound_at / snippet deliberately untouched (a
      // broadcast must not flood the support inbox).

      ambiguousStreak = cls === "ambiguous" ? ambiguousStreak + 1 : 0;
      if (res.ok) {
        sent++;
      } else {
        failed++;
        byClass[cls!]++;
        // Meta refused synchronously with a code → nothing was delivered, so
        // give the contact's daily marketing slot back. Ambiguous keeps it.
        if (cls !== "ambiguous" && !res.message_id) {
          await sb.from("wa_marketing_daily_claims").delete()
            .eq("contact_id", c.id).eq("ist_day", today).eq("source_id", campaignId);
        }
        if (cls === "cap") await recordMarketingCap(sb, c.wa_id, res.error_code, res.error).catch(() => {});
        if (cls === "optout") await recordMarketingOptOut(sb, c.wa_id, res.error_code, res.error).catch(() => {});
        if (!firstError) firstError = res.error ?? "unknown";
        await alertWaSendFailure({
          to: c.wa_id,
          kind: "template",
          templateName: tpl.name,
          error: res.error,
          errorCode: res.error_code,
          errorDetail: res.error_detail,
          sentBy,
        }).catch(() => {});
      }
      if (ambiguousStreak >= AMBIGUOUS_STOP_STREAK) { stopReason = "ambiguous_streak"; break; }
      if (THROTTLE_MS) await sleep(THROTTLE_MS);
    }

    await emitPathStats(pathStats, firstMmLiteError, queue.length);
    await sb.rpc("wa_campaign_recount", { p_campaign: campaignId });
    await releaseLock();

    const summary = {
      sent, failed, attempted, processed: queue.length, claim_skipped: claimSkipped, ai_skipped: aiSkipped,
      daily_claim_lost: dailyLost, claim_errors: claimErrors, failures_by_class: byClass, personalized,
      held: heldBreakdown, skipped, governor_limits: `${MARKETING_PER_24H}/24h, ${MARKETING_PER_7D}/7d`,
    };

    if (stopReason === "paused" || stopReason === "cancelled" || stopReason === "lock_lost") {
      return j({ ok: true, status: stopReason, stopped: true, ...summary });
    }
    if (stopReason === "ambiguous_streak") {
      // Meta/network outage: stop so it can't strand the rest of the audience
      // as "delivery unknown". The stranded ones are never re-sent (§0).
      const at = new Date(nextAllowedAt(Date.now() + AI_RETRY_MS, waveMin)).toISOString();
      await sb.from("wa_campaigns").update({
        resume_at: at,
        last_error: `Paused sending: ${AMBIGUOUS_STOP_STREAK} sends in a row got no clear answer from Meta ` +
          `(${firstError ?? "network error"}). Those people are not re-sent. Retrying the rest at ${at}.`,
      }).eq("id", campaignId).eq("status", "sending");
      return j({ ok: true, status: "sending", deferred: true, resume_at: at, note: "ambiguous streak", ...summary });
    }
    if (stopReason === "quiet_hours") {
      const at = new Date(nextAllowedAt(Date.now(), waveMin)).toISOString();
      await defer(at);
      return j({ ok: true, status: "sending", deferred: true, resume_at: at, note: "quiet hours", ...summary });
    }

    // B1: wholesale-failure breaker — structural errors only, zero successes.
    if (shouldTripBreaker({ sent, structural: byClass.structural, attempted })) {
      await sb.from("wa_campaigns").update({
        status: "failed",
        last_error: `Halted: ${byClass.structural} send(s) failed with a template/account error and none went out. ` +
          `Meta said: ${firstError ?? "unknown"}. Fix it, then press Send — those recipients will be retried.`,
      }).eq("id", campaignId).eq("status", "sending");
      await postSlack(
        slackChannelFor("whatsapp"),
        `🚨 *Campaign halted — template/account error*\n*Campaign:* ${campaign.name}\n` +
          `*Result:* 0 delivered, ${byClass.structural} structural failures in this batch.\n` +
          `*Meta said:* ${firstError ?? "unknown"}\nFix the template/params/token, then re-send. ` +
          `The affected recipients are retried; nobody who got it will get it again.`,
      ).catch(() => {});
      fireReport(campaignId);
      return j({ ok: false, status: "failed", error: firstError, ...summary });
    }

    // Everything attempted hit the per-user marketing cap → today's wave is spent.
    if (attempted > 0 && sent === 0 && byClass.cap === attempted) {
      const at = new Date(nextWaveAt(Date.now(), waveMin)).toISOString();
      await defer(at);
      return j({ ok: true, status: "sending", deferred: true, resume_at: at, note: "marketing cap — next wave", ...summary });
    }

    // Nothing could even be attempted (AI personalisation failing, claim store
    // unreachable): back off instead of hot-looping the chain.
    if (attempted === 0 && (aiSkipped > 0 || claimErrors > 0)) {
      const at = new Date(nextAllowedAt(Date.now() + AI_RETRY_MS, waveMin)).toISOString();
      await sb.from("wa_campaigns").update({
        resume_at: at,
        last_error: aiSkipped
          ? `AI personalisation failed for ${aiSkipped} recipient(s); retrying at ${at}.`
          : `Daily claim store unavailable; nothing sent. Retrying at ${at}.`,
      }).eq("id", campaignId).eq("status", "sending");
      return j({ ok: true, status: "sending", deferred: true, resume_at: at, ...summary });
    }

    // Productive (or partially skipped) batch → chain; the next invocation
    // re-classifies and completes / defers / continues.
    const chain = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-campaign-send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ campaign_id: campaignId, _continue: true }),
    }).catch(() => {});
    try {
      (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(chain);
    } catch { /* not on edge runtime */ }

    return j({ ok: true, status: "sending", remaining: eligibleNow.length - queue.length, ...summary });
  }

  // Park without sending: an armed follow-up that has not sent yet stays
  // 'scheduled' (and unstarted); anything else is an active 'sending' campaign.
  async function park(at: string) {
    const patch: Record<string, unknown> = { resume_at: at };
    if (!armedFollowup) {
      patch.status = "sending";
      patch.started_at = campaign.started_at ?? new Date().toISOString();
    }
    await sb.from("wa_campaigns").update(patch).eq("id", campaignId)
      .in("status", armedFollowup ? ["scheduled"] : ["draft", "scheduled", "sending", "failed"]);
  }

  async function readTiming(): Promise<FollowupTiming | null> {
    const { data, error } = await sb.rpc("wa_campaign_followup_timing", {
      p_parent: campaign.followup_of,
      p_hours: campaign.followup_after_hours,
    });
    if (error) throw new Error(`follow-up timing read failed: ${error.message}`);
    return (data ?? null) as FollowupTiming | null;
  }

  // Nobody to send to right now. Decide: complete (parent finished and
  // nobody left to cross the delay), cancel, or park until the next person's
  // time. Returns null only when completing is right. Any read error parks
  // for an hour: never complete on a guess.
  async function followupHold(
    now: number,
    done?: { reached: number; skipped: Partial<Record<SkipReason, number>> },
  ): Promise<Response | null> {
    let timing: FollowupTiming | null;
    try {
      timing = await readTiming();
    } catch (e) {
      const at = new Date(nextAllowedAt(now + 60 * 60_000, waveMin)).toISOString();
      await park(at);
      return j({ ok: false, status: armedFollowup ? "scheduled" : "sending", deferred: true, resume_at: at, error: String(e) }, 500);
    }
    const fin = followupFinish(parent, timing, now, waveMin, Number(campaign.followup_after_hours) || 0);
    if (fin.kind === "cancel") return await cancelFollowup(sb, campaignId, "The campaign it follows was cancelled.");
    if (fin.kind === "expired") {
      return await complete({
        reached: done?.reached ?? 0,
        skipped: (done?.skipped ?? {}) as Record<string, number>,
        note: "follow-up window ended (30 days plus the follow-up delay after the campaign it follows started)",
      });
    }
    if (fin.kind === "complete") return null;
    const at = new Date(fin.resumeAtMs).toISOString();
    await park(at);
    return j({
      ok: true, status: armedFollowup ? "scheduled" : "sending", deferred: true, resume_at: at,
      note: fin.reason === "parent_running"
        ? "waiting: the campaign it follows is still running"
        : "waiting: more people become due for this follow-up later",
      reached: done?.reached ?? 0,
    });
  }

  async function defer(at: string) {
    await sb.from("wa_campaigns").update({
      status: "sending",
      started_at: campaign.started_at ?? new Date().toISOString(),
      resume_at: at,
    }).eq("id", campaignId).in("status", ["draft", "scheduled", "sending", "failed"]);
  }

  async function complete(o: { reached: number; skipped: Record<string, number>; note?: string }) {
    const total = Object.values(o.skipped).reduce((a, b) => a + (b ?? 0), 0);
    await sb.rpc("wa_campaign_recount", { p_campaign: campaignId });
    await sb.from("wa_campaigns").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      resume_at: null,
      skipped_breakdown: o.skipped,
      skipped_count: total,
      held_breakdown: null,
    }).eq("id", campaignId).in("status", ["draft", "scheduled", "sending", "failed"]);
    fireReport(campaignId);
    return j({ ok: true, status: "completed", reached: o.reached, skipped: o.skipped, note: o.note ?? "all eligible contacts handled" });
  }

  async function emitPathStats(stats: typeof pathStatsShape, firstMm: string | null, batchSize: number) {
    const touched = stats.mm_lite_sent + stats.mm_lite_failed + stats.cloud_api_sent + stats.cloud_api_failed > 0;
    if (touched) {
      console.log(JSON.stringify({
        evt: "wa_send_path", scope: "campaign_batch", campaign_id: campaignId, campaign: campaign.name,
        template: tpl.name, batch_size: batchSize, ...stats, sent_by: personalized ? "campaign-ai" : "campaign",
      }));
    }
    if (stats.fallbacks > 0) {
      await logConnector({
        connector: "whatsapp",
        level: "warn",
        event: "mm_lite_fallback",
        message: `MM Lite refused ${stats.fallbacks}/${batchSize} campaign send(s) of "${tpl.name}" ` +
          `and Cloud API delivered them instead: ${firstMm ?? "unknown"}`,
        detail: { scope: "campaign_batch", campaign_id: campaignId, campaign: campaign.name, template: tpl.name, mm_lite_error: firstMm, ...stats },
        throttleMinutes: 60,
      }).catch(() => {});
    }
  }
});

// Columns that decide what a batch sends and to whom (see the send lock).
const CONTENT_COLS = ["template_id", "template_vars", "audience_filter", "header_media_url"] as const;
const FOLLOWUP_COLS = ["followup_of", "followup_after_hours", "followup_stage"] as const;

const pathStatsShape = { mm_lite_sent: 0, mm_lite_failed: 0, cloud_api_sent: 0, cloud_api_failed: 0, fallbacks: 0 };

// Mark a campaign failed with a human reason (idempotent; never touches a
// completed/cancelled campaign). Used for start-time problems so the worker
// and the Vercel tick stop re-kicking it and Slack is not spammed (B8).
async function failCampaign(sb: Sb, campaignId: string, reason: string): Promise<Response> {
  await sb.from("wa_campaigns").update({ status: "failed", last_error: reason, resume_at: null })
    .eq("id", campaignId).in("status", ["draft", "scheduled", "sending", "failed"]);
  return j({ ok: false, status: "failed", error: reason }, 400);
}

// A follow-up whose parent was cancelled stops too (belt and braces with the
// dashboard's cancel cascade). Never touches a finished step.
async function cancelFollowup(sb: Sb, campaignId: string, reason: string): Promise<Response> {
  await sb.from("wa_campaigns").update({
    status: "cancelled", cancelled_at: new Date().toISOString(), resume_at: null, last_error: reason,
  }).eq("id", campaignId).in("status", ["draft", "scheduled", "sending", "paused", "failed"]);
  return j({ ok: true, status: "cancelled", note: reason });
}

// ---------------------------------------------------------------------------
// Test send — same builder, no ledger, no claims, no contact creation.
// ---------------------------------------------------------------------------
async function handleTestSend(body: Body): Promise<Response> {
  const to = String(body.test_to ?? "").replace(/\D/g, "");
  if (to.length < 10) return j({ ok: false, error: "test_to must be a full phone number with country code" }, 400);
  const sb = db();

  let src: { template_id?: string | null; template_vars?: Record<string, unknown> | null; header_media_url?: string | null; name?: string | null } | null = null;
  if (body.campaign_id) {
    const { data } = await sb.from("wa_campaigns").select("template_id,template_vars,header_media_url,name")
      .eq("id", body.campaign_id).maybeSingle();
    if (!data) return j({ ok: false, error: "campaign not found" }, 404);
    src = data;
  } else if (body.draft) {
    src = body.draft;
  }
  if (!src?.template_id) return j({ ok: false, error: "template_id required (campaign_id or draft)" }, 400);

  const { data: tpl } = await sb.from("wa_templates").select("*").eq("id", src.template_id).maybeSingle();
  if (!tpl) return j({ ok: false, error: "template not found" }, 404);
  if (tpl.status !== "approved") {
    return j({ ok: false, error: `template '${tpl.name}' is '${tpl.status}' — Meta only delivers approved templates` }, 400);
  }
  let vars: Record<string, unknown> = { ...(src.template_vars ?? {}) };
  const errors = validateCampaignSetup(tpl as TemplateSchema, vars, src.header_media_url ?? null);
  if (errors.length) return j({ ok: false, error: errors.join("; "), errors }, 400);

  const brief = typeof vars._ai_brief === "string" ? vars._ai_brief.trim() : "";
  const keys = templateVarKeys(tpl.body);
  let aiUsed = false;
  if (brief && keys.length) {
    const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });
    const ai = await personalizeVars(openai, tpl.body ?? "", brief, { name: body.test_name ?? null }, keys).catch(() => null);
    if (!ai) return j({ ok: false, error: "AI personalisation failed for the test — try again or check the brief" }, 502);
    vars = { ...vars, ...ai };
    aiUsed = true;
  }
  const campaignName = src.name ?? "test";
  const tagUrl = (u: string) => appendUtm(u, { medium: "campaign", campaign: campaignName });
  vars = Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k, typeof v === "string" && !k.startsWith("_") ? tagUrl(v) : v]),
  );
  const trackedCodes: Record<number, string> = {};
  const trackUrl = typeof vars._track_url === "string" && vars._track_url.trim() ? vars._track_url.trim() : null;
  if (trackUrl) {
    for (const b of dynamicUrlButtons(tpl as TemplateSchema).filter((x) => isShortLinkBase(x.base))) {
      const code = await mintCode(sb, tagUrl(trackUrl), { sent_by: "campaign_test" });
      if (code) trackedCodes[b.index] = code;
    }
  }
  const built = buildTemplateComponents(tpl as TemplateSchema, {
    vars,
    contactName: body.test_name ?? null,
    headerMediaOverride: src.header_media_url ?? null,
    trackedCodes,
    tagUrl,
  });
  if (built.errors.length) return j({ ok: false, error: built.errors.join("; "), errors: built.errors }, 400);

  let res: SendResult;
  try {
    res = await sendTemplate(to, tpl.name, tpl.language, built.components as TemplateComponent[]);
  } catch (e) {
    res = { ok: false, message_id: null, raw: null, error: String(e) };
  }
  const explain = res.ok ? null : explainWaError(res.error_code, res.error ?? undefined);
  return j({
    ok: res.ok,
    to,
    template: tpl.name,
    message_id: res.message_id,
    error: res.ok ? null : res.error ?? "unknown",
    error_code: res.error_code ?? null,
    error_class: res.ok ? null : classifySyncFailure(res.error_code, res.error, res.http_status ?? null),
    explanation: explain ? { category: explain.category, cause: explain.cause } : null,
    ai_personalized: aiUsed,
    components: built.components,
  }, res.ok ? 200 : 502);
}

// Ask the model for this contact's template variable values.
async function personalizeVars(
  client: OpenAI,
  templateBody: string,
  brief: string,
  contact: { name?: string | null; email?: string | null; tags?: string[] | null },
  varKeys: string[],
): Promise<Record<string, string> | null> {
  const system =
    "You write WhatsApp marketing template variable values for PROMUNCH (snack brand — protein munchies, edamame). " +
    "Given a template and one customer, output ONLY a JSON object mapping each numbered variable to a short, natural " +
    "value tailored to that customer. Values are template variables, not paragraphs — keep them short. " +
    "India-English, warm. Never include {{ }} braces in the values. Never use em dashes. Always write the brand as PROMUNCH.";
  const user = [
    `TEMPLATE BODY:\n${templateBody}`,
    `\nCAMPAIGN BRIEF:\n${brief}`,
    `\nCUSTOMER:\nname: ${contact.name ?? "(unknown)"}\ntags: ${(contact.tags ?? []).join(", ") || "(none)"}\nemail: ${
      contact.email ?? "(none)"
    }`,
    `\nReturn JSON only — keys ${varKeys.map((k) => `"${k}"`).join(", ")}. Example: {"1":"...","2":"..."}`,
  ].join("\n");
  const resp = await client.chat.completions.create({
    model: PERSONALIZE_MODEL,
    max_tokens: 300,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const txt = resp.choices[0]?.message?.content ?? "";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    const out: Record<string, string> = {};
    for (const k of varKeys) if (obj[k] != null && String(obj[k]).trim()) out[k] = String(obj[k]).replace(/—/g, ",");
    return Object.keys(out).length === varKeys.length ? out : null;
  } catch {
    return null;
  }
}

// Fire-and-forget: post the analytics report to Slack the moment the campaign
// finishes. wa-jobs-tick fires the settled follow-up ~15 min later.
function fireReport(campaignId: string, settled = false) {
  fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-campaign-report`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ campaign_id: campaignId, settled }),
  }).catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
