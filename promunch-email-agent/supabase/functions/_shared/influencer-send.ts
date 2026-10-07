// Influencer reminder SEND core. Used in-process by influencer-send (HTTP,
// manual dashboard sends) and influencer-tick (cron drain), so both paths run
// the exact same guards. The only thing that talks to Meta is wa-send (the
// chokepoint); this module never calls the Graph API.
//
// §0 guards, in order, for every creator / owner message:
//   1. engine_enabled gate (creator rows) — off means nothing is sent.
//   2. the row must be won via claim_influencer_reminder (scheduled→sending
//      CAS) by the caller; an unclaimed row is never processed.
//   3. relevance re-check against the live deal (stage moved / gate satisfied
//      → cancel, never send).
//   4. ledger check: wa_messages.sent_by = `influencer:<reminder_id>` with a
//      sent/delivered/read status means it already went out → finalize, no send.
//   5. pacing (cron path): 09:00 to 21:00 IST only, and at most one automated
//      creator nudge per deal per 12h.
//   6. one wa-send call per claim, no inline retry. ok:false means Meta did
//      not accept, so the scheduled backoff retry cannot double-send; an
//      unknown outcome (network error) is caught by guard 4 on the retry.

import { db } from "./supabase.ts";
import { errStr, logConnector } from "./connector-log.ts";
import {
  buildTemplateComponents,
  CLOSED_STAGES,
  type DealRow,
  type InfluencerRow,
  type InfluencerSettings,
  inSendWindow,
  manualRowKey,
  nextSendWindowStart,
  ownerWaId,
  portalUrl,
  type ReminderRow,
  SEND_KINDS,
  type SendKind,
  sendKindFor,
  siteAppUrl,
  TEMPLATES,
  toWaId,
} from "./influencers.ts";

export const MAX_SEND_ATTEMPTS = 3;
export const CREATOR_GAP_HOURS = 12;
const HOUR = 3_600_000;

export const ledgerMarker = (reminderId: string) => `influencer:${reminderId}`;

const OK_LEDGER_STATUSES = ["sent", "delivered", "read"];

export const DEAL_COLUMNS =
  "id, influencer_id, code, stage, agreed_at, brief_sent_at, brief_acknowledged_at, dispatched_at, delivered_at, draft_due_at, draft_submitted_at, draft_approved_at, go_live_at, posted_at, shopify_order_id, order_status_url, revision_count";

export interface SendOutcome {
  ok: boolean;
  reminder_id?: string;
  status?: string;
  reason?: string;
  error?: string;
  wa_message_id?: string | null;
  already_sent?: boolean;
}

// ---------------------------------------------------------------------------
// wa-send (single attempt; see guard 6)
// ---------------------------------------------------------------------------

export async function callWaSend(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; message_id?: string | null; error?: string | null; unknown?: boolean }> {
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const out = await r.json().catch(() => null);
    if (!out) return { ok: false, error: `wa-send HTTP ${r.status}`, unknown: r.status >= 500 };
    return { ok: out.ok === true, message_id: out.message_id ?? null, error: out.error ?? null };
  } catch (e) {
    // Network error: wa-send may or may not have sent. The ledger check on
    // the next attempt (guard 4) decides; never assume it failed cleanly.
    return { ok: false, error: errStr(e), unknown: true };
  }
}

// Did a send for this reminder already land? (guard 4)
export async function ledgerHit(row: Pick<ReminderRow, "id" | "created_at">): Promise<
  { hit: "ok"; wa_message_id: string | null } | { hit: "failed" } | { hit: "none" } | { hit: "error" }
> {
  const { data, error } = await db()
    .from("wa_messages")
    .select("wa_message_id, status")
    .eq("sent_by", ledgerMarker(row.id))
    .eq("direction", "outbound")
    .gte("created_at", new Date(Date.parse(row.created_at) - 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) return { hit: "error" };
  const rows = data ?? [];
  const ok = rows.find((m) => OK_LEDGER_STATUSES.includes(String(m.status)));
  if (ok) return { hit: "ok", wa_message_id: ok.wa_message_id ?? null };
  if (rows.length) return { hit: "failed" };
  return { hit: "none" };
}

// ---------------------------------------------------------------------------
// Row transitions (all compare-and-set on status = 'sending' so a slow worker
// can never overwrite a row someone else already finalized)
// ---------------------------------------------------------------------------

async function finalizeSent(row: ReminderRow, waMessageId: string | null, templateName: string | null) {
  await db().from("influencer_reminders").update({
    status: "sent",
    sent_at: new Date().toISOString(),
    wa_message_id: waMessageId,
    template_name: templateName ?? row.template_name,
    last_error: null,
  }).eq("id", row.id).eq("status", "sending");
}

async function cancelRow(row: ReminderRow, reason: string) {
  await db().from("influencer_reminders").update({
    status: "cancelled",
    meta: { ...(row.meta ?? {}), cancelled_reason: reason },
  }).eq("id", row.id).eq("status", "sending");
}

// Put a claimed row back without counting it as an attempt (nothing was tried).
async function releaseRow(row: ReminderRow, dueAt: number, note?: string) {
  await db().from("influencer_reminders").update({
    status: "scheduled",
    claimed_at: null,
    attempts: Math.max(0, (row.attempts ?? 1) - 1),
    due_at: new Date(dueAt).toISOString(),
    ...(note ? { last_error: note.slice(0, 500) } : {}),
  }).eq("id", row.id).eq("status", "sending");
}

// A real attempt failed: retry later with backoff, or give up after N tries.
export async function failOrBackoff(row: ReminderRow, error: string): Promise<"failed" | "scheduled"> {
  const attempts = row.attempts ?? 1;
  if (attempts >= MAX_SEND_ATTEMPTS) {
    await db().from("influencer_reminders").update({
      status: "failed",
      claimed_at: null,
      last_error: error.slice(0, 500),
    }).eq("id", row.id).eq("status", "sending");
    await logConnector({
      connector: "whatsapp",
      level: "error",
      event: "influencer_send_failed",
      message: `Influencer reminder ${row.kind}#${row.step} gave up after ${attempts} tries: ${error}`.slice(0, 300),
      ref: row.deal_id,
      throttleMinutes: 30,
    }).catch(() => {});
    return "failed";
  }
  await db().from("influencer_reminders").update({
    status: "scheduled",
    claimed_at: null,
    last_error: error.slice(0, 500),
    due_at: new Date(Date.now() + attempts * 2 * HOUR).toISOString(),
  }).eq("id", row.id).eq("status", "sending");
  return "scheduled";
}

async function failHard(row: ReminderRow, error: string) {
  await db().from("influencer_reminders").update({
    status: "failed",
    claimed_at: null,
    last_error: error.slice(0, 500),
  }).eq("id", row.id).eq("status", "sending");
}

export async function writeEvent(e: {
  influencer_id: string;
  deal_id: string | null;
  type: string;
  channel?: string | null;
  actor?: string | null;
  summary: string;
  meta?: Record<string, unknown>;
}) {
  const { error } = await db().from("influencer_events").insert({
    influencer_id: e.influencer_id,
    deal_id: e.deal_id,
    type: e.type,
    channel: e.channel ?? null,
    actor: e.actor ?? "system",
    summary: e.summary.slice(0, 500),
    meta: e.meta ?? {},
  });
  if (error) console.error("[influencer-send] event insert failed", errStr(error));
}

// Team task row that exists once per (deal, kind, step). Inserted already
// 'sent' (= surfaced on the dashboard), the team marks it done.
export async function ensureTeamTask(dealId: string, kind: string, meta: Record<string, unknown>, step = 1) {
  const { error } = await db().from("influencer_reminders").upsert({
    deal_id: dealId,
    kind,
    step,
    audience: "team",
    channel: "task",
    status: "sent",
    due_at: new Date().toISOString(),
    sent_at: new Date().toISOString(),
    meta,
  }, { onConflict: "deal_id,kind,step", ignoreDuplicates: true });
  if (error) console.error("[influencer-send] team task insert failed", errStr(error));
}

// ---------------------------------------------------------------------------
// Relevance (guard 3)
// ---------------------------------------------------------------------------

export function creatorRowStillRelevant(kind: string, deal: DealRow): boolean {
  if (CLOSED_STAGES.has(deal.stage)) return false;
  switch (kind) {
    case "brief_ack": return deal.stage === "brief_sent" && !deal.brief_acknowledged_at;
    case "delivery_check": return deal.stage === "dispatched" && !deal.delivered_at;
    case "draft_due": return deal.stage === "delivered" && !deal.draft_submitted_at;
    case "post_due": return deal.stage === "draft_approved" && !deal.posted_at;
    case "brief_ready": return !deal.brief_acknowledged_at;
    default: return true; // draft_feedback, post_fix, manual_* : human asked for it
  }
}

export function escalationStillRelevant(gate: unknown, deal: DealRow): boolean {
  if (gate === "brief_ack" || gate === "delivery_check" || gate === "draft_due") {
    return creatorRowStillRelevant(gate, deal);
  }
  return !CLOSED_STAGES.has(deal.stage);
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

async function loadDeal(id: string): Promise<DealRow | null> {
  const { data } = await db().from("influencer_deals").select(DEAL_COLUMNS).eq("id", id).maybeSingle();
  return (data as DealRow | null) ?? null;
}

async function loadInfluencer(id: string): Promise<InfluencerRow | null> {
  const { data } = await db().from("influencers").select("id, handle, full_name, phone, status").eq("id", id)
    .maybeSingle();
  return (data as InfluencerRow | null) ?? null;
}

async function templateApproved(name: string, language: string): Promise<boolean | null> {
  const { data, error } = await db().from("wa_templates").select("status").eq("name", name).eq("language", language)
    .maybeSingle();
  if (error) return null;
  return String(data?.status ?? "").toLowerCase() === "approved";
}

// Creators reached only for collab logistics must not land in marketing
// audiences (wa_contacts.opted_in defaults to true and wa-send upserts the
// contact). Create their contact row first as NOT opted in; an existing row
// (e.g. they are also a customer) is left exactly as it is.
async function ensureCreatorContact(waId: string, inf: InfluencerRow) {
  await db().from("wa_contacts").upsert({
    wa_id: waId,
    phone: "+" + waId,
    name: inf.full_name ?? inf.handle,
    opted_in: false,
    tags: ["influencer"],
  }, { onConflict: "wa_id", ignoreDuplicates: true }).then(() => {}, () => {});
}

// ---------------------------------------------------------------------------
// Process a CLAIMED creator row (status = 'sending', won by the caller)
// ---------------------------------------------------------------------------

export async function processClaimedCreatorRow(
  row: ReminderRow,
  settings: InfluencerSettings,
  opts: { pace: boolean; actor?: string },
): Promise<SendOutcome> {
  const base = { reminder_id: row.id };
  const now = Date.now();

  // guard 1
  if (!settings.engine_enabled) {
    await releaseRow(row, Date.parse(row.due_at));
    return { ...base, ok: false, reason: "engine_off" };
  }

  const sk = sendKindFor(row.kind, row.step);
  if (!sk) {
    await failHard(row, `not a creator reminder kind: ${row.kind}`);
    return { ...base, ok: false, reason: "bad_kind" };
  }

  // guard 3
  const deal = await loadDeal(row.deal_id);
  if (!deal) {
    await cancelRow(row, "deal_missing");
    return { ...base, ok: false, reason: "deal_missing" };
  }
  if (!creatorRowStillRelevant(row.kind, deal)) {
    await cancelRow(row, CLOSED_STAGES.has(deal.stage) ? "deal_closed" : "gate_satisfied");
    return { ...base, ok: false, reason: "no_longer_needed" };
  }
  const inf = await loadInfluencer(deal.influencer_id);
  if (!inf) {
    await cancelRow(row, "influencer_missing");
    return { ...base, ok: false, reason: "influencer_missing" };
  }
  if (inf.status !== "active") {
    await cancelRow(row, `creator_${inf.status}`);
    return { ...base, ok: false, reason: `creator_${inf.status}` };
  }

  const waId = toWaId(inf.phone);
  if (!waId) {
    const msg = "Creator phone missing or invalid: add it on the creator profile, then resend.";
    await failHard(row, msg);
    await ensureTeamTask(deal.id, "team_fix_phone", { reason: msg, blocked_reminder_id: row.id });
    await writeEvent({
      influencer_id: inf.id, deal_id: deal.id, type: "note", channel: "whatsapp", actor: "system",
      summary: `WhatsApp ${TEMPLATES[sk].name} not sent: creator phone missing`,
      meta: { reminder_id: row.id },
    });
    return { ...base, ok: false, reason: "phone_missing", error: msg };
  }

  // guard 4
  const ledger = await ledgerHit(row);
  if (ledger.hit === "error") {
    // can't prove it wasn't sent → don't send now; retry later
    await releaseRow(row, now + HOUR, "ledger check failed, retrying later");
    return { ...base, ok: false, reason: "ledger_unavailable" };
  }
  if (ledger.hit === "ok") {
    await finalizeSent(row, ledger.wa_message_id, TEMPLATES[sk].name);
    return { ...base, ok: true, already_sent: true, wa_message_id: ledger.wa_message_id };
  }

  // guard 5 (cron path only; manual sends are a human pressing a button)
  if (opts.pace) {
    if (!inSendWindow(now)) {
      await releaseRow(row, nextSendWindowStart(now));
      return { ...base, ok: false, reason: "outside_send_window" };
    }
    const since = new Date(now - CREATOR_GAP_HOURS * HOUR).toISOString();
    const { data: recent, error: recentErr } = await db()
      .from("influencer_reminders")
      .select("id, sent_at")
      .eq("deal_id", deal.id)
      .eq("audience", "creator")
      .eq("status", "sent")
      .gte("sent_at", since)
      .neq("id", row.id)
      .order("sent_at", { ascending: false })
      .limit(1);
    if (recentErr) {
      await releaseRow(row, now + HOUR);
      return { ...base, ok: false, reason: "pacing_check_failed" };
    }
    if (recent?.length) {
      await releaseRow(row, Date.parse(recent[0].sent_at) + CREATOR_GAP_HOURS * HOUR);
      return { ...base, ok: false, reason: "paced" };
    }
  }

  const tpl = buildTemplateComponents(sk, { influencer: inf, deal, meta: row.meta ?? {} });
  const approved = await templateApproved(tpl.name, tpl.language);
  if (approved !== true) {
    const err = approved === null
      ? "could not read wa_templates"
      : `template ${tpl.name} is not approved at Meta yet (submit docs/whatsapp/influencer-templates.md)`;
    const st = await failOrBackoff(row, err);
    return { ...base, ok: false, status: st, reason: "template_not_ready", error: err };
  }

  await ensureCreatorContact(waId, inf);
  const res = await callWaSend({
    to: waId,
    kind: "template",
    sent_by: ledgerMarker(row.id),
    template: { name: tpl.name, language: tpl.language, components: tpl.components, vars: tpl.vars },
  });

  if (!res.ok) {
    const st = await failOrBackoff(row, res.error ?? "wa-send failed");
    return { ...base, ok: false, status: st, reason: "send_failed", error: res.error ?? undefined };
  }

  await finalizeSent(row, res.message_id ?? null, tpl.name);
  const sentAt = new Date().toISOString();
  await db().from("influencers").update({ last_contact_at: sentAt, last_contact_channel: "whatsapp" })
    .eq("id", inf.id).then(() => {}, () => {});
  await writeEvent({
    influencer_id: inf.id,
    deal_id: deal.id,
    type: "nudge_sent",
    channel: "whatsapp",
    actor: "system",
    summary: `WhatsApp sent: ${tpl.name}`,
    meta: {
      reminder_id: row.id,
      kind: row.kind,
      step: row.step,
      template: tpl.name,
      wa_message_id: res.message_id ?? null,
      portal_url: portalUrl(deal.code),
      ...(opts.actor ? { requested_by: opts.actor } : {}),
    },
  });
  return { ...base, ok: true, status: "sent", wa_message_id: res.message_id ?? null };
}

// ---------------------------------------------------------------------------
// Process a CLAIMED owner escalation row
// ---------------------------------------------------------------------------

export async function processClaimedEscalation(row: ReminderRow, settings: InfluencerSettings): Promise<SendOutcome> {
  const base = { reminder_id: row.id };
  const deal = await loadDeal(row.deal_id);
  if (!deal) {
    await cancelRow(row, "deal_missing");
    return { ...base, ok: false, reason: "deal_missing" };
  }
  if (!escalationStillRelevant(row.meta?.gate, deal)) {
    await cancelRow(row, "gate_satisfied");
    return { ...base, ok: false, reason: "no_longer_needed" };
  }
  const inf = await loadInfluencer(deal.influencer_id);
  const to = ownerWaId(settings);
  if (!to) {
    await failHard(row, "no owner WhatsApp configured (influencer_settings.owner_wa_id / OWNER_WA_ID)");
    return { ...base, ok: false, reason: "no_owner" };
  }

  const ledger = await ledgerHit(row);
  if (ledger.hit === "error") {
    await releaseRow(row, Date.now() + HOUR, "ledger check failed, retrying later");
    return { ...base, ok: false, reason: "ledger_unavailable" };
  }
  if (ledger.hit === "ok") {
    await finalizeSent(row, ledger.wa_message_id, null);
    return { ...base, ok: true, already_sent: true };
  }

  const handle = `@${(inf?.handle ?? "creator").replace(/^@/, "")}`;
  const reason = String(row.meta?.reason ?? "Needs attention");
  const link = `${siteAppUrl()}/dashboard/influencers?deal=${deal.id}`;
  // Same internal alert template the support-ticket pings use (approved
  // UTILITY, lands outside the 24h window). {{1}} label {{2}} ref {{3}} name
  // {{4}} phone {{5}} details.
  const res = await callWaSend({
    to,
    kind: "template",
    sent_by: ledgerMarker(row.id),
    template: {
      name: Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert",
      language: "en",
      vars: {
        "1": "Influencer escalation",
        "2": handle.slice(0, 60),
        "3": (inf?.full_name || handle).slice(0, 120),
        "4": inf?.phone ? `+${toWaId(inf.phone) ?? inf.phone}` : "-",
        "5": `${reason}. Stage: ${deal.stage}. ${link}`.replace(/[\r\n\t]+/g, " ").slice(0, 300),
      },
    },
  });
  if (!res.ok) {
    const st = await failOrBackoff(row, res.error ?? "wa-send failed");
    return { ...base, ok: false, status: st, reason: "send_failed", error: res.error ?? undefined };
  }
  await finalizeSent(row, res.message_id ?? null, Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert");
  if (inf) {
    await writeEvent({
      influencer_id: inf.id,
      deal_id: deal.id,
      type: "escalation",
      channel: "whatsapp",
      actor: "system",
      summary: `Owner pinged: ${reason}`,
      meta: { reminder_id: row.id, gate: row.meta?.gate ?? null },
    });
  }
  return { ...base, ok: true, status: "sent", wa_message_id: res.message_id ?? null };
}

// ---------------------------------------------------------------------------
// Claim helper
// ---------------------------------------------------------------------------

export async function claimReminder(id: string): Promise<ReminderRow | null> {
  const { data, error } = await db().rpc("claim_influencer_reminder", { p_id: id });
  if (error) {
    console.error("[influencer-send] claim failed", id, error.message);
    return null; // can't prove we own it → don't send
  }
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as ReminderRow[];
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Entry points used by the influencer-send HTTP function
// ---------------------------------------------------------------------------

// {reminder_id}: claim + process one existing creator row.
export async function sendByReminderId(
  reminderId: string,
  settings: InfluencerSettings,
  actor?: string,
): Promise<SendOutcome> {
  if (!settings.engine_enabled) return { ok: false, reason: "engine_off", reminder_id: reminderId };
  const { data: existing } = await db().from("influencer_reminders").select("id, audience, status")
    .eq("id", reminderId).maybeSingle();
  if (!existing) return { ok: false, reason: "not_found", reminder_id: reminderId };
  if (existing.audience !== "creator") return { ok: false, reason: "not_a_creator_reminder", reminder_id: reminderId };
  if (existing.status === "sent") return { ok: true, already_sent: true, reminder_id: reminderId, status: "sent" };
  const row = await claimReminder(reminderId);
  if (!row) return { ok: false, reason: "not_claimable", status: existing.status, reminder_id: reminderId };
  return await processClaimedCreatorRow(row, settings, { pace: false, actor });
}

// {deal_id, kind}: create-or-get the deterministic row, claim, process.
export async function sendManual(
  input: { deal_id: string; kind: string; step?: number | null; note?: string | null; retry?: boolean; actor?: string },
  settings: InfluencerSettings,
): Promise<SendOutcome> {
  if (!settings.engine_enabled) return { ok: false, reason: "engine_off" };
  if (!(SEND_KINDS as readonly string[]).includes(input.kind)) return { ok: false, reason: "bad_kind" };
  const kind = input.kind as SendKind;
  const sb = db();

  const deal = await loadDeal(input.deal_id);
  if (!deal) return { ok: false, reason: "deal_not_found" };
  if (CLOSED_STAGES.has(deal.stage)) return { ok: false, reason: "deal_closed" };

  let briefVersion: number | null = null;
  let draftVersion: number | null = null;
  const meta: Record<string, unknown> = { manual: true };
  if (input.actor) meta.requested_by = input.actor;

  if (kind === "brief_ready") {
    const { data: b } = await sb.from("influencer_briefs").select("version, status")
      .eq("deal_id", deal.id).in("status", ["sent", "approved"])
      .order("version", { ascending: false }).limit(1).maybeSingle();
    briefVersion = b?.version ?? null;
    meta.brief_version = briefVersion;
  }
  if (kind === "draft_feedback") {
    const { data: d } = await sb.from("influencer_drafts").select("version, review_status")
      .eq("deal_id", deal.id).neq("review_status", "pending")
      .order("version", { ascending: false }).limit(1).maybeSingle();
    draftVersion = d?.version ?? null;
    meta.draft_version = draftVersion;
    meta.decision = d?.review_status ?? null;
  }
  if (kind === "post_fix") meta.note = (input.note ?? "").slice(0, 300) || null;

  const key = manualRowKey(kind, { briefVersion, draftVersion, step: input.step ?? null, now: Date.now() });
  if ("error" in key) return { ok: false, reason: "nothing_to_send", error: key.error };

  // create-or-get: the unique (deal_id, kind, step) makes a double click a no-op
  const { error: insErr } = await sb.from("influencer_reminders").upsert({
    deal_id: deal.id,
    kind: key.kind,
    step: key.step,
    audience: "creator",
    channel: "whatsapp",
    status: "scheduled",
    due_at: new Date().toISOString(),
    template_name: TEMPLATES[kind].name,
    meta,
  }, { onConflict: "deal_id,kind,step", ignoreDuplicates: true });
  if (insErr) return { ok: false, reason: "db_error", error: errStr(insErr) };

  const { data: row } = await sb.from("influencer_reminders").select("id, status")
    .eq("deal_id", deal.id).eq("kind", key.kind).eq("step", key.step).maybeSingle();
  if (!row) return { ok: false, reason: "db_error", error: "reminder row not found after insert" };

  if (row.status === "sent") return { ok: true, already_sent: true, reminder_id: row.id, status: "sent" };
  if (row.status === "sending") return { ok: false, reason: "in_progress", reminder_id: row.id };
  if (row.status === "failed" || row.status === "cancelled") {
    if (!input.retry) return { ok: false, reason: row.status, reminder_id: row.id };
    // explicit retry: failed/cancelled → scheduled (CAS). The ledger check
    // still runs before any send, so a retry can never double-deliver.
    await sb.from("influencer_reminders").update({ status: "scheduled", due_at: new Date().toISOString(), attempts: 0 })
      .eq("id", row.id).eq("status", row.status);
  }

  const claimed = await claimReminder(row.id);
  if (!claimed) return { ok: false, reason: "claimed_elsewhere", reminder_id: row.id };
  return await processClaimedCreatorRow(claimed, settings, { pace: false, actor: input.actor });
}
