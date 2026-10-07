// deno-lint-ignore-file no-explicit-any -- raw Shopify Admin GraphQL JSON is untyped
// Cron (every 15 min): the influencer delivery reminder engine.
//
//   0. RECOVER  stale 'sending' claims (>15 min). The wa_messages ledger
//               marker `influencer:<reminder_id>` decides: present → the send
//               landed, finalize; absent → nothing went out, requeue.
//   1. ARM      every open deal → deriveReminders() (pure, _shared/influencers.ts)
//               → insert missing rows (unique (deal_id, kind, step), on
//               conflict do nothing); cancel scheduled rows the deal no longer
//               implies; move due dates that changed; close team tasks whose
//               gate is now satisfied (sent → done).
//   2. DRAIN    due 'scheduled' rows: claim_influencer_reminder (CAS) →
//               creator rows → _shared/influencer-send.ts (→ wa-send);
//               owner escalation rows → one ops_ticket_alert ping to the owner;
//               team rows → surfaced as a task (status 'sent').
//   3. AUTO-STAGE draft_approved + no post for ghosted_after_days past
//               go_live_at → ghosted (+ event, pending reminders cancelled).
//   4. SHOPIFY  dispatched deals with a shopify_order_id: poll fulfilment,
//               log an event once + store the order status URL. Delivery stays
//               creator-confirmed on the portal.
//   5. DIGEST   once per IST day at/after digest_hour_ist (digest_enabled):
//               one WhatsApp to the owner. Exactly-once via
//               influencer_digest_log(day primary key).
//
// engine_enabled=false: creator rows are never drained (ARM, team tasks,
// escalations, auto-stage, Shopify and the digest still run; none of them
// message a creator).
//
// Auth: requireInternal (pg_cron sends the Vault service_role_key bearer).
// Schedule: 20261007120100_influencer_tick_cron.sql.

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { errStr, logConnector } from "../_shared/connector-log.ts";
import { adminGraphQL } from "../_shared/shopify-customer.ts";
import {
  CLOSED_STAGES,
  type DealRow,
  deriveReminders,
  DERIVED_KINDS,
  DERIVED_TEAM_KINDS,
  digestCounts,
  digestIsEmpty,
  digestLine,
  fmtDateIst,
  type InfluencerSettings,
  inSendWindow,
  istDateKey,
  istHour,
  loadInfluencerSettings,
  ownerWaId,
  reminderKey,
  type ReminderRow,
  siteAppUrl,
} from "../_shared/influencers.ts";
import {
  callWaSend,
  claimReminder,
  DEAL_COLUMNS,
  failOrBackoff,
  ledgerHit,
  MAX_SEND_ATTEMPTS,
  processClaimedCreatorRow,
  processClaimedEscalation,
  writeEvent,
} from "../_shared/influencer-send.ts";

const ARM_BATCH = 500;
const DRAIN_BATCH = 40;
const STALE_CLAIM_MIN = 15;
const SHOPIFY_BATCH = 15;
const DIGEST_MAX_ATTEMPTS = 3;
const ID_CHUNK = 100;

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const result = await tick().catch((e) => ({ error: errStr(e) }));
  return j({ ok: true, ...result });
});

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[influencer-tick] ${name} failed`, errStr(e));
    await logConnector({
      connector: "whatsapp",
      level: "error",
      event: `influencer_tick_${name}_failed`,
      message: `influencer-tick ${name}: ${errStr(e)}`.slice(0, 300),
      throttleMinutes: 60,
    }).catch(() => {});
    return { error: errStr(e) };
  }
}

async function tick() {
  const settings = await loadInfluencerSettings();
  const now = Date.now();
  const recovered = await step("recover", () => recoverStaleClaims());
  const armed = await step("arm", () => arm(settings, now));
  const drained = await step("drain", () => drain(settings));
  const staged = await step("autostage", () => autoGhost(settings, now));
  const shopify = await step("shopify", () => pollShopify());
  const digest = await step("digest", () => maybeDigest(settings, now));
  return { engine_enabled: settings.engine_enabled, recovered, armed, drained, staged, shopify, digest };
}

const chunks = <T>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

// ---- 0. recover stale claims ----------------------------------------------
async function recoverStaleClaims() {
  const sb = db();
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MIN * 60_000).toISOString();
  const { data: stale, error } = await sb.from("influencer_reminders").select("*")
    .eq("status", "sending").lt("claimed_at", staleBefore).limit(100);
  if (error) throw error;

  let finalized = 0, requeued = 0, failed = 0;
  for (const r of (stale ?? []) as ReminderRow[]) {
    if (r.channel === "task") {
      await sb.from("influencer_reminders").update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", r.id).eq("status", "sending");
      finalized++;
      continue;
    }
    const ledger = await ledgerHit(r);
    if (ledger.hit === "error") continue; // can't tell → leave it, try next tick
    if (ledger.hit === "ok") {
      await sb.from("influencer_reminders").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        wa_message_id: ledger.wa_message_id,
        last_error: null,
      }).eq("id", r.id).eq("status", "sending");
      finalized++;
      continue;
    }
    // nothing went out (no ledger row, or Meta refused it) → retry or give up
    const st = await failOrBackoff(r, ledger.hit === "failed" ? "send refused by Meta (stale claim)" : "stale claim, nothing sent");
    if (st === "failed") failed++;
    else requeued++;
  }
  return { finalized, requeued, failed };
}

// ---- 1. arm ---------------------------------------------------------------
async function arm(settings: InfluencerSettings, now: number) {
  const sb = db();
  const { data: dealsRaw, error } = await sb.from("influencer_deals").select(DEAL_COLUMNS)
    .not("stage", "in", "(completed,cancelled,ghosted)")
    .order("created_at", { ascending: true })
    .limit(ARM_BATCH);
  if (error) throw error;
  const deals = (dealsRaw ?? []) as DealRow[];
  if (!deals.length) return { deals: 0, inserted: 0, cancelled: 0, rescheduled: 0, done: 0 };

  const briefVersion = new Map<string, number>();
  const latestDraft = new Map<string, { version: number; submitted_at: string }>();
  const existing = new Map<string, Array<Pick<ReminderRow, "id" | "kind" | "step" | "status" | "due_at" | "meta">>>();
  const draftDeals = deals.filter((d) => d.stage === "draft_submitted").map((d) => d.id);

  for (const ids of chunks(deals.map((d) => d.id), ID_CHUNK)) {
    const { data: briefs, error: bErr } = await sb.from("influencer_briefs").select("deal_id, version, status")
      .in("deal_id", ids).eq("status", "sent");
    if (bErr) throw bErr;
    for (const b of briefs ?? []) {
      briefVersion.set(b.deal_id, Math.max(briefVersion.get(b.deal_id) ?? 0, b.version));
    }
    const { data: rems, error: rErr } = await sb.from("influencer_reminders")
      .select("id, deal_id, kind, step, status, due_at, meta")
      .in("deal_id", ids).in("status", ["scheduled", "sent"]).in("kind", [...DERIVED_KINDS]);
    if (rErr) throw rErr;
    for (const r of rems ?? []) {
      const list = existing.get(r.deal_id) ?? [];
      list.push(r);
      existing.set(r.deal_id, list);
    }
  }
  for (const ids of chunks(draftDeals, ID_CHUNK)) {
    const { data: drafts, error: dErr } = await sb.from("influencer_drafts").select("deal_id, version, submitted_at")
      .in("deal_id", ids);
    if (dErr) throw dErr;
    for (const d of drafts ?? []) {
      const cur = latestDraft.get(d.deal_id);
      if (!cur || d.version > cur.version) latestDraft.set(d.deal_id, { version: d.version, submitted_at: d.submitted_at });
    }
  }

  const toInsert: Record<string, unknown>[] = [];
  const toCancel: Array<{ id: string; meta: Record<string, unknown> }> = [];
  const toReschedule: Array<{ id: string; due_at: string }> = [];
  const toDone: string[] = [];

  for (const deal of deals) {
    const ld = latestDraft.get(deal.id);
    const desired = deriveReminders(deal, settings, now, {
      briefVersion: briefVersion.get(deal.id) ?? null,
      latestDraftVersion: ld?.version ?? null,
      latestDraftSubmittedAt: ld?.submitted_at ?? null,
    });
    const want = new Map(desired.map((d) => [reminderKey(d), d]));
    const have = existing.get(deal.id) ?? [];
    const haveKeys = new Set(have.map((r) => reminderKey(r)));

    for (const d of desired) {
      if (haveKeys.has(reminderKey(d))) continue;
      toInsert.push({
        deal_id: deal.id,
        kind: d.kind,
        step: d.step,
        audience: d.audience,
        channel: d.channel,
        status: "scheduled",
        due_at: d.due_at,
        template_name: d.template_name,
        meta: d.meta,
      });
    }
    for (const r of have) {
      const d = want.get(reminderKey(r));
      if (r.status === "scheduled") {
        if (!d) toCancel.push({ id: r.id, meta: { ...(r.meta ?? {}), cancelled_reason: "not_needed" } });
        else if (Math.abs(Date.parse(r.due_at) - Date.parse(d.due_at)) > 60_000) {
          toReschedule.push({ id: r.id, due_at: d.due_at });
        }
      } else if (r.status === "sent" && DERIVED_TEAM_KINDS.has(r.kind) && !d) {
        toDone.push(r.id); // our-side gate satisfied → task closes itself
      }
    }
  }

  let inserted = 0;
  for (const batch of chunks(toInsert, 200)) {
    // on conflict (deal_id, kind, step) do nothing: a nudge exists once, even
    // if it was already sent, cancelled or failed
    const { data, error: iErr } = await sb.from("influencer_reminders")
      .upsert(batch, { onConflict: "deal_id,kind,step", ignoreDuplicates: true }).select("id");
    if (iErr) console.error("[influencer-tick] arm insert failed", errStr(iErr));
    else inserted += data?.length ?? 0;
  }
  for (const c of toCancel) {
    await sb.from("influencer_reminders").update({ status: "cancelled", meta: c.meta })
      .eq("id", c.id).eq("status", "scheduled");
  }
  for (const r of toReschedule) {
    await sb.from("influencer_reminders").update({ due_at: r.due_at }).eq("id", r.id).eq("status", "scheduled");
  }
  for (const ids of chunks(toDone, ID_CHUNK)) {
    await sb.from("influencer_reminders").update({ status: "done" }).in("id", ids).eq("status", "sent");
  }
  return {
    deals: deals.length,
    inserted,
    cancelled: toCancel.length,
    rescheduled: toReschedule.length,
    done: toDone.length,
  };
}

// ---- 2. drain -------------------------------------------------------------
async function drain(settings: InfluencerSettings) {
  const sb = db();
  const now = Date.now();
  let q = sb.from("influencer_reminders").select("*")
    .eq("status", "scheduled").lte("due_at", new Date(now).toISOString())
    .order("due_at", { ascending: true }).limit(DRAIN_BATCH);
  // engine off → creator rows are never even claimed
  if (!settings.engine_enabled) q = q.neq("audience", "creator");
  const { data: due, error } = await q;
  if (error) throw error;

  const window = inSendWindow(now);
  const creatorDealsThisTick = new Set<string>();
  const out = { due: due?.length ?? 0, sent: 0, tasks: 0, escalations: 0, skipped: 0, not_sent: 0 };

  for (const r of (due ?? []) as ReminderRow[]) {
    if (r.channel === "whatsapp" && !window) { out.skipped++; continue; } // 09:00-21:00 IST only
    if (r.audience === "creator" && creatorDealsThisTick.has(r.deal_id)) { out.skipped++; continue; }

    const row = await claimReminder(r.id);
    if (!row) continue; // another run won it

    if (row.audience === "creator") {
      const res = await processClaimedCreatorRow(row, settings, { pace: true });
      if (res.ok && !res.already_sent) {
        out.sent++;
        creatorDealsThisTick.add(row.deal_id);
      } else if (!res.ok) out.not_sent++;
    } else if (row.kind === "escalation") {
      const res = await processClaimedEscalation(row, settings);
      if (res.ok) out.escalations++;
      else out.not_sent++;
    } else {
      // team task: surface it (status 'sent'); the dashboard marks it done,
      // or the ARM pass closes it when the gate is satisfied
      const { data: deal } = await sb.from("influencer_deals").select("stage").eq("id", row.deal_id).maybeSingle();
      if (!deal || CLOSED_STAGES.has(deal.stage)) {
        await sb.from("influencer_reminders").update({
          status: "cancelled",
          meta: { ...(row.meta ?? {}), cancelled_reason: "deal_closed" },
        }).eq("id", row.id).eq("status", "sending");
        continue;
      }
      await sb.from("influencer_reminders").update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id).eq("status", "sending");
      out.tasks++;
    }
  }
  return out;
}

// ---- 3. auto-stage: ghosted -----------------------------------------------
async function autoGhost(settings: InfluencerSettings, now: number) {
  const sb = db();
  const days = settings.nudges.post_due.ghosted_after_days;
  const cutoff = new Date(now - days * 86_400_000).toISOString();
  const { data: cands, error } = await sb.from("influencer_deals").select("id, influencer_id, go_live_at")
    .eq("stage", "draft_approved").is("posted_at", null).not("go_live_at", "is", null).lt("go_live_at", cutoff)
    .limit(50);
  if (error) throw error;

  let ghosted = 0;
  for (const d of cands ?? []) {
    // CAS on stage so a creator submitting the post link in the same instant wins
    const { data: moved } = await sb.from("influencer_deals")
      .update({ stage: "ghosted", updated_at: new Date().toISOString() })
      .eq("id", d.id).eq("stage", "draft_approved").is("posted_at", null).select("id");
    if (!moved?.length) continue;
    ghosted++;
    await sb.from("influencer_reminders").update({ status: "cancelled" })
      .eq("deal_id", d.id).eq("status", "scheduled");
    await writeEvent({
      influencer_id: d.influencer_id,
      deal_id: d.id,
      type: "stage_change",
      channel: "dashboard",
      actor: "system",
      summary: `Auto-moved to ghosted: no post ${days} days after the go-live date (${fmtDateIst(d.go_live_at)})`,
      meta: { from: "draft_approved", to: "ghosted", auto: true },
    });
  }
  return { ghosted };
}

// ---- 4. Shopify fulfilment poll -------------------------------------------
async function pollShopify() {
  const sb = db();
  const { data: deals, error } = await sb.from("influencer_deals")
    .select("id, influencer_id, shopify_order_id, shopify_order_name, order_status_url")
    .eq("stage", "dispatched").not("shopify_order_id", "is", null)
    .order("dispatched_at", { ascending: true }).limit(100);
  if (error) throw error;
  if (!deals?.length) return { checked: 0, fulfilled: 0 };

  const { data: seen } = await sb.from("influencer_events").select("deal_id")
    .in("deal_id", deals.map((d) => d.id)).eq("type", "order_fulfilled");
  const done = new Set((seen ?? []).map((e) => e.deal_id));
  const todo = deals.filter((d) => !done.has(d.id)).slice(0, SHOPIFY_BATCH);

  let checked = 0, fulfilled = 0;
  for (const d of todo) {
    const id = String(d.shopify_order_id);
    const gid = id.startsWith("gid://") ? id : `gid://shopify/Order/${id.replace(/\D/g, "")}`;
    let res: any;
    try {
      res = await adminGraphQL(
        `query($id: ID!){ order(id:$id){ name displayFulfillmentStatus statusPageUrl
           fulfillments(first: 5){ status trackingInfo(first: 3){ company number url } } } }`,
        { id: gid },
      );
    } catch (e) {
      if (errStr(e).includes("admin-not-configured")) return { checked, fulfilled, skipped: "shopify_not_configured" };
      console.error("[influencer-tick] shopify poll", d.id, errStr(e));
      continue;
    }
    checked++;
    const order = res?.data?.order;
    if (!order) continue;

    if (!d.order_status_url && order.statusPageUrl) {
      await sb.from("influencer_deals").update({ order_status_url: order.statusPageUrl })
        .eq("id", d.id).is("order_status_url", null);
    }
    const fulfillments: any[] = order.fulfillments ?? [];
    const isFulfilled = ["FULFILLED", "PARTIALLY_FULFILLED"].includes(String(order.displayFulfillmentStatus)) ||
      fulfillments.length > 0;
    if (!isFulfilled) continue;

    const tracking = fulfillments.flatMap((f) => f?.trackingInfo ?? [])
      .map((t: any) => ({ company: t?.company ?? null, number: t?.number ?? null, url: t?.url ?? null }));
    const t0 = tracking[0];
    await writeEvent({
      influencer_id: d.influencer_id,
      deal_id: d.id,
      type: "order_fulfilled",
      channel: "shopify",
      actor: "system",
      summary: `Shopify order ${order.name ?? d.shopify_order_name ?? ""} fulfilled` +
        (t0?.number ? ` (${[t0.company, t0.number].filter(Boolean).join(" ")})` : ""),
      meta: {
        shopify_order_id: d.shopify_order_id,
        fulfillment_status: order.displayFulfillmentStatus ?? null,
        tracking,
        order_status_url: order.statusPageUrl ?? d.order_status_url ?? null,
      },
    });
    fulfilled++;
  }
  return { checked, fulfilled };
}

// ---- 5. daily owner digest (exactly once per IST date) ---------------------
async function maybeDigest(settings: InfluencerSettings, now: number) {
  if (!settings.digest_enabled) return { skipped: "disabled" };
  if (istHour(now) < settings.digest_hour_ist) return { skipped: "not_yet" };
  const to = ownerWaId(settings);
  if (!to) return { skipped: "no_owner_wa_id" };

  const sb = db();
  const day = istDateKey(now);

  // CLAIM: first writer of the day's row owns the digest. A row left 'failed'
  // (Meta refused, nothing delivered) may be re-claimed by CAS on attempts.
  const { error: insErr } = await sb.from("influencer_digest_log").insert({ day, status: "claimed", attempts: 1 });
  let attempts = 1;
  if (insErr) {
    if (insErr.code !== "23505") throw insErr;
    const { data: cur } = await sb.from("influencer_digest_log").select("status, attempts").eq("day", day).maybeSingle();
    if (!cur || cur.status !== "failed" || cur.attempts >= DIGEST_MAX_ATTEMPTS) return { skipped: "already_handled" };
    const { data: won } = await sb.from("influencer_digest_log")
      .update({ status: "claimed", attempts: cur.attempts + 1, updated_at: new Date().toISOString() })
      .eq("day", day).eq("status", "failed").eq("attempts", cur.attempts).select("day");
    if (!won?.length) return { skipped: "already_handled" };
    attempts = cur.attempts + 1;
  }

  const finish = (patch: Record<string, unknown>) =>
    sb.from("influencer_digest_log").update({ ...patch, updated_at: new Date().toISOString() }).eq("day", day);

  // ledger belt-and-braces: a digest already in wa_messages for today is final
  const marker = `influencer_digest:${day}`;
  const { data: prior } = await sb.from("wa_messages").select("wa_message_id, status")
    .eq("sent_by", marker).in("status", ["sent", "delivered", "read"]).limit(1);
  if (prior?.length) {
    await finish({ status: "sent", wa_message_id: prior[0].wa_message_id ?? null });
    return { skipped: "ledger_already_sent" };
  }

  const { data: deals, error } = await sb.from("influencer_deals").select(`${DEAL_COLUMNS}, influencers(handle)`)
    .not("stage", "in", "(completed,cancelled,ghosted)").limit(1000);
  if (error) {
    await finish({ status: "failed", last_error: errStr(error) });
    throw error;
  }
  const rows = (deals ?? []).map((d: any) => ({ ...d, handle: d.influencers?.handle ?? "creator" })) as Array<
    DealRow & { handle: string }
  >;
  const briefDraft = new Set<string>();
  for (const ids of chunks(rows.filter((d) => d.stage === "agreed" || d.stage === "brief_draft").map((d) => d.id), ID_CHUNK)) {
    const { data: b } = await sb.from("influencer_briefs").select("deal_id").in("deal_id", ids).eq("status", "draft");
    for (const x of b ?? []) briefDraft.add(x.deal_id);
  }
  const counts = digestCounts(rows, briefDraft, settings, now);
  if (digestIsEmpty(counts)) {
    await finish({ status: "skipped_empty", detail: counts });
    return { skipped: "nothing_to_report" };
  }

  const line = digestLine(counts);
  const res = await callWaSend({
    to,
    kind: "template",
    sent_by: marker,
    // Approved internal UTILITY template (same as support ticket pings), so it
    // lands even when the owner hasn't messaged the number in 24h.
    template: {
      name: Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert",
      language: "en",
      vars: {
        "1": "Influencers today",
        "2": fmtDateIst(new Date(now).toISOString()),
        "3": `${rows.length} open collabs`,
        "4": "-",
        "5": `${line}. ${siteAppUrl()}/dashboard/influencers`.slice(0, 300),
      },
    },
  });
  if (res.ok) {
    await finish({ status: "sent", wa_message_id: res.message_id ?? null, detail: counts, last_error: null });
    return { sent: true, line };
  }
  // Refused by Meta → nothing delivered → retryable ('failed'). Unknown
  // outcome (network) → 'unknown', never retried automatically (§0: when in
  // doubt, do not send).
  await finish({
    status: res.unknown ? "unknown" : "failed",
    last_error: (res.error ?? "wa-send failed").slice(0, 500),
    detail: counts,
  });
  if (!res.unknown && attempts >= DIGEST_MAX_ATTEMPTS) {
    await logConnector({
      connector: "whatsapp",
      level: "error",
      event: "influencer_digest_failed",
      message: `Influencer digest for ${day} failed ${attempts}x: ${res.error ?? "?"}`.slice(0, 300),
      throttleMinutes: 720,
    }).catch(() => {});
  }
  return { sent: false, error: res.error ?? null, attempts, max_attempts: MAX_SEND_ATTEMPTS };
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
