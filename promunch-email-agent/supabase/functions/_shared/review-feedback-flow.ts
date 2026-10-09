// Review feedback ask: the stateful half (sends, claims, ticket, ORM case).
// Pure logic + copy live in ./review-feedback.ts (unit-tested).
//
// NEVER TWICE (promunch-email-agent/CLAUDE.md §0):
//   * The ASK is one wa_journey_runs row; claimAsk() flips it active ->
//     completed atomically before any send, exactly like every other in-window
//     ask. An ambiguous wa-send outcome keeps the claim (silence over a repeat).
//   * Each TAP reply takes an insert-first claim on wa_review_feedback, unique
//     (wa_id, ref). Only the insert that wins replies. A second tap on any
//     button of the same ask hits 23505 and gets NO reply (logged). Any other
//     claim error sends nothing. The reply also carries a per-ask ledger marker
//     (sent_by review_feedback:<ref>) that is checked before claiming.
//   * A failed reply is NOT released for retry: a missed thank-you is
//     recoverable, a duplicate is not.

import { db } from "./supabase.ts";
import { logConnector } from "./connector-log.ts";
import { getFlowSettings, type FlowSettings } from "./flow-settings.ts";
import { REVIEW_URL } from "./journeys.ts";
import { claimAsk, logAskDelivery, markAskDelivered, releaseAsk } from "./window-asks.ts";
import { openTicket } from "./support-ticket.ts";
import { matchCustomer } from "./orm-enrich.ts";
import {
  buildFeedbackInteractive,
  buildNotHappyMention,
  claimVerdict,
  classifyTapRun,
  type FeedbackChoice,
  feedbackReplyMarker,
  buildFeedbackReplyInteractive,
  isRunRef,
  REVIEW_FEEDBACK_LANGUAGE,
  REVIEW_FEEDBACK_TEMPLATE,
  reviewFeedbackActiveFor,
} from "./review-feedback.ts";

type Sb = ReturnType<typeof db>;

// Is the feedback ask live for this customer (flag + optional staged allowlist)?
export async function reviewFeedbackActive(
  waId: string | null | undefined,
  flows?: FlowSettings,
): Promise<boolean> {
  const f = flows ?? await getFlowSettings();
  return reviewFeedbackActiveFor(
    f.review_feedback_enabled === true,
    waId,
    Deno.env.get("REVIEW_FEEDBACK_ONLY_WA_IDS"),
  );
}

// review_feedback_v1 approved at Meta? Any doubt (missing row, DB error) =
// not approved, so the caller keeps the legacy review_request template.
export async function feedbackTemplateApproved(sb: Sb): Promise<boolean> {
  try {
    const { data, error } = await sb.from("wa_templates").select("status")
      .eq("name", REVIEW_FEEDBACK_TEMPLATE).eq("language", REVIEW_FEEDBACK_LANGUAGE).maybeSingle();
    return !error && data?.status === "approved";
  } catch {
    return false;
  }
}

type SendOut = { ok?: boolean; message_id?: string | null; error?: string | null } | null;

// null = outcome unknown (network error / unparseable response): Meta may or
// may not have accepted it. Callers must treat null as "maybe sent".
async function waSend(body: Record<string, unknown>): Promise<SendOut> {
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
    return out && typeof out === "object" ? out as SendOut : null;
  } catch {
    return null;
  }
}

// In-window delivery of the ask (wa-journey-tick, flag on, 24h window open):
// one interactive button message instead of the AI-composed free-text ask.
//   { sent: true }        delivered (claim kept, delivered_at stamped)
//   { skipped: string }   another path owns it, or the outcome is unknown
//   { ok: false }         Meta explicitly refused; claim handed back so the
//                         tick may fall through to the template path
export async function sendReviewFeedbackInWindow(
  sb: Sb,
  threadId: string,
  run: { id: string; wa_id: string; order_ref?: string | null; context?: { vars?: Record<string, string> } | null },
): Promise<{ sent?: boolean; skipped?: string; ok?: boolean; error?: string }> {
  if (!(await claimAsk(sb, run.id))) return { skipped: "already claimed" };
  const res = await waSend({
    thread_id: threadId,
    kind: "interactive",
    interactive: buildFeedbackInteractive(run.context?.vars?.["1"], run.id),
    sent_by: "journey:review_request",
    journey_run_id: run.id,
  });
  if (res === null) {
    // Unknown outcome: keep the claim. Never risk a second ask.
    await logConnector({
      connector: "whatsapp", level: "warn", event: "review_feedback_ask_unknown",
      message: `${run.wa_id}: review feedback ask send outcome unknown; run kept claimed (no retry).`,
      ref: run.order_ref ?? run.id,
    }).catch(() => {});
    return { skipped: "send outcome unknown" };
  }
  if (!res.ok) {
    await releaseAsk(sb, run.id);
    return { ok: false, error: res.error ?? "send failed" };
  }
  await markAskDelivered(sb, run.id);
  await logAskDelivery({
    journeyKey: "review_request", mode: "free_text", path: "tick_window",
    runId: run.id, waId: run.wa_id, orderRef: run.order_ref ?? null,
  });
  return { sent: true };
}

function log(level: "info" | "warn" | "error", event: string, message: string, ref: string, detail?: Record<string, unknown>) {
  return logConnector({ connector: "whatsapp", level, event, message, ref, detail }).catch(() => {});
}

// wa-webhook entry point for an rvf:<choice>:<ref> tap. Never throws into the
// webhook; never reaches the AI. Replies at most once per (wa_id, ref).
export async function handleReviewFeedbackTap(t: {
  choice: FeedbackChoice;
  ref: string;
  waId: string;
  threadId: string;
  tapWamid: string | null;
  name: string | null;
}): Promise<void> {
  const sb = db();
  const detail = { choice: t.choice, ref: t.ref, wa_id: t.waId, tap: t.tapWamid };

  if (!(await reviewFeedbackActive(t.waId))) {
    await log("info", "review_feedback_tap_inactive", `${t.waId}: review feedback tap while the feature is off; no reply.`, t.ref, detail);
    return;
  }
  if (!isRunRef(t.ref)) {
    await log("warn", "review_feedback_tap_unknown", `${t.waId}: review feedback tap with unknown ref '${t.ref}'; no reply.`, t.ref, detail);
    return;
  }
  const { data: run, error: runErr } = await sb.from("wa_journey_runs")
    .select("id, wa_id, journey_key, order_ref").eq("id", t.ref).maybeSingle();
  if (runErr) {
    await log("error", "review_feedback_tap_error", `${t.waId}: run lookup failed (${runErr.message}); no reply.`, t.ref, detail);
    return;
  }
  const verdict = classifyTapRun(run, t.waId);
  if (verdict !== "ok") {
    await log("warn", "review_feedback_tap_unknown", `${t.waId}: review feedback tap rejected (${verdict}); no reply.`, t.ref, detail);
    return;
  }
  const orderRef = (run!.order_ref as string | null) ?? null;
  const marker = feedbackReplyMarker(t.ref);

  // Ledger check first (belt and braces with the claim below). In doubt: silence.
  const { data: prior, error: pErr } = await sb.from("wa_messages").select("id")
    .eq("sent_by", marker).in("status", ["queued", "sent", "delivered", "read"]).limit(1);
  if (pErr) {
    await log("error", "review_feedback_tap_error", `${t.waId}: ledger check failed (${pErr.message}); no reply.`, orderRef ?? t.ref, detail);
    return;
  }
  if (prior?.length) {
    await log("info", "review_feedback_duplicate_tap", `${t.waId}: already replied to this review ask (ledger); second tap '${t.choice}' ignored.`, orderRef ?? t.ref, detail);
    return;
  }

  // Atomic claim, insert-first. Only the winner replies.
  const { error: cErr } = await sb.from("wa_review_feedback").insert({
    wa_id: t.waId,
    ref: t.ref,
    choice: t.choice,
    run_id: run!.id,
    order_ref: orderRef,
    tap_wa_message_id: t.tapWamid,
  });
  const cv = claimVerdict(cErr);
  if (cv === "duplicate") {
    await log("info", "review_feedback_duplicate_tap", `${t.waId}: second tap '${t.choice}' on an answered review ask; no reply.`, orderRef ?? t.ref, detail);
    return;
  }
  if (cv === "error") {
    await log("error", "review_feedback_tap_error", `${t.waId}: claim insert failed (${cErr?.message ?? "unknown"}); no reply.`, orderRef ?? t.ref, detail);
    return;
  }

  const res = await waSend({
    thread_id: t.threadId,
    kind: "interactive",
    interactive: buildFeedbackReplyInteractive(t.choice, REVIEW_URL),
    sent_by: marker,
  });
  await sb.from("wa_review_feedback").update({
    status: res?.ok ? "replied" : "reply_failed",
    replied_at: res?.ok ? new Date().toISOString() : null,
    reply_wa_message_id: res?.message_id ?? null,
    error: res?.ok ? null : (res?.error ?? "send outcome unknown"),
  }).eq("wa_id", t.waId).eq("ref", t.ref).then(() => {}, () => {});
  if (!res?.ok) {
    await log("error", "review_feedback_reply_failed", `${t.waId}: '${t.choice}' reply not confirmed (${res?.error ?? "unknown outcome"}); not retried (never twice).`, orderRef ?? t.ref, detail);
  }

  if (t.choice === "unhappy") {
    await escalateNotHappy(sb, { ...t, orderRef, runId: run!.id as string })
      .catch((e) => log("error", "review_feedback_escalation_failed", `${t.waId}: Not happy escalation failed: ${String(e).slice(0, 200)}`, orderRef ?? t.ref, detail));
  }
}

// Not happy: urgent ticket on the existing escalation path (order lane ->
// OPS_WA_ID + support fan-out, via the same openTicket the AI bot uses) and an
// ORM complaint mention with an open case. Runs once per ask: only the tap
// that won the wa_review_feedback claim gets here.
async function escalateNotHappy(
  sb: Sb,
  o: { waId: string; threadId: string; tapWamid: string | null; name: string | null; orderRef: string | null; runId: string; ref: string },
): Promise<void> {
  const reason = `Customer tapped Not happy on the review ask${o.orderRef ? ` for order ${o.orderRef}` : ""}. ` +
    `Reach out and sort it out within 24 hours.`;
  let ticketOk = true;
  await openTicket(o.threadId, o.waId, {
    category: "order_issue",
    priority: "urgent",
    reason,
    order_number: o.orderRef ?? undefined,
  }, false).catch((e) => {
    ticketOk = false;
    return log("error", "review_feedback_ticket_failed", `${o.waId}: ticket open failed: ${String(e).slice(0, 200)}`, o.orderRef ?? o.ref);
  });

  let mentionId: string | null = null;
  const contactId = await matchCustomer(o.orderRef).catch(() => null);
  const row = buildNotHappyMention({
    tapWamid: o.tapWamid ?? `rvf:${o.ref}`,
    waId: o.waId,
    name: o.name,
    orderRef: o.orderRef,
    runId: o.runId,
    contactId,
    nowIso: new Date().toISOString(),
  });
  const { data: m, error: mErr } = await sb.from("orm_mentions").insert(row).select("id").maybeSingle();
  if (mErr && mErr.code !== "23505") {
    await log("error", "review_feedback_orm_failed", `${o.waId}: ORM case insert failed (${mErr.message}).`, o.orderRef ?? o.ref);
  }
  mentionId = (m?.id as string | undefined) ?? null;

  await sb.from("wa_review_feedback").update({ ticket_opened: ticketOk, orm_mention_id: mentionId })
    .eq("wa_id", o.waId).eq("ref", o.ref).then(() => {}, () => {});
  await log("info", "review_feedback_not_happy", `${o.waId}: Not happy on review ask${o.orderRef ? ` (${o.orderRef})` : ""}; urgent ticket + ORM case opened.`, o.orderRef ?? o.ref, { mention_id: mentionId, ticket: ticketOk });
}
