// Durable-job + NO-SPAM per-turn reply claim helpers.
// Extracted verbatim from wa-ai-reply/index.ts (audit R5 split). No behavior change.

import { db } from "../_shared/supabase.ts";

// Mark the durable wa_jobs row done so wa-jobs-tick won't retry it.
// No-op for draft mode / dashboard calls, which carry no job_id.
export async function markJobDone(jobId?: string | null) {
  if (!jobId) return;
  await db().from("wa_jobs").update({ status: "done", last_error: null })
    .eq("id", jobId).then(() => {}, () => {});
}

// ---- NO-SPAM per-turn reply claim -----------------------------------------
// Decide whether THIS run may send the reply for the current inbound turn.
//   - a newer customer message arrived  -> bow out; a later run answers the
//     fuller context (collapses a rapid-fire burst into ONE reply)
//   - another run / a wa-jobs-tick retry already owns this exact turn -> bow out
// Atomic via the claim_ai_reply RPC (mirrors claim_order_confirmation). If that
// RPC isn't deployed yet it degrades to a read-based check so the bot keeps
// working until the migration is applied.
export async function claimReplyTurn(
  sb: any,
  threadId: string,
  inbound: { id: string; created_at: string } | undefined,
): Promise<{ send: boolean; reason?: string }> {
  if (!inbound) return { send: true }; // nothing to dedup against

  const { data: newer } = await sb
    .from("wa_messages").select("id")
    .eq("thread_id", threadId).eq("direction", "inbound")
    .gt("created_at", inbound.created_at).limit(1);
  if (newer && newer.length) return { send: false, reason: "superseded" };

  const { data: won, error } = await sb.rpc("claim_ai_reply", {
    p_thread: threadId,
    p_inbound: inbound.id,
  });
  if (!error) {
    return won === true ? { send: true } : { send: false, reason: "claimed_elsewhere" };
  }

  // RPC not deployed yet — best-effort read fallback (not fully atomic).
  const { data: replied } = await sb
    .from("wa_messages").select("id")
    .eq("thread_id", threadId).eq("direction", "outbound").eq("sent_by", "bot")
    .gt("created_at", inbound.created_at).limit(1);
  return replied && replied.length
    ? { send: false, reason: "already_replied" }
    : { send: true };
}

export async function markReplyTurnSent(sb: any, threadId: string, inbound?: { id: string }) {
  if (!inbound) return;
  await sb.rpc("mark_ai_reply_sent", { p_thread: threadId, p_inbound: inbound.id })
    .then(() => {}, () => {});
}

export async function releaseReplyTurn(sb: any, threadId: string, inbound?: { id: string }) {
  if (!inbound) return;
  await sb.rpc("release_ai_reply", { p_thread: threadId, p_inbound: inbound.id })
    .then(() => {}, () => {});
}
