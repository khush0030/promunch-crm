// nudge-pending
// ---------------------------------------------------------------------------
// SLA reminder cron. Scans email_threads in `pending` state that needed a
// human reply (should_reply=true) and nudges them in their Slack thread:
//   - First nudge at 6h: gentle "still waiting" reply in thread.
//   - Escalation at 12h: same + @mention SLACK_ESCALATION_USERS.
//
// Idempotent — uses reminded_6h_at / reminded_12h_at / escalated_at on the
// thread row so each tier fires at most once per thread.
//
// Schedule via pg_cron to call this every ~15 minutes.

import { db } from "../_shared/supabase.ts";
import { replyInThread } from "../_shared/slack.ts";
import { logEvent } from "../_shared/log.ts";

const REMIND_6H_MS = 6 * 60 * 60 * 1000;
const REMIND_12H_MS = 12 * 60 * 60 * 1000;
const NUDGE_SCORE_THRESHOLD = Number(Deno.env.get("NUDGE_SCORE_THRESHOLD") ?? "4");

// Comma-separated Slack user IDs (U…) to @mention on 12h escalation.
const ESCALATE_USERS = (Deno.env.get("SLACK_ESCALATION_USERS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function mentions(ids: string[]): string {
  return ids.map((u) => `<@${u}>`).join(" ");
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }
  const supabase = db();
  const now = Date.now();

  const { data: candidates, error } = await supabase
    .from("email_threads")
    .select(
      "id, from_email, subject, urgency, score, status, should_reply, slack_channel_id, slack_thread_ts, created_at, reminded_6h_at, reminded_12h_at, escalated_at",
    )
    .eq("status", "pending")
    .neq("should_reply", false)
    .gte("score", NUDGE_SCORE_THRESHOLD)
    .lt("created_at", new Date(now - REMIND_6H_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  let nudged6 = 0;
  let escalated12 = 0;

  for (const t of candidates ?? []) {
    if (!t.slack_channel_id || !t.slack_thread_ts) continue;
    const created = new Date(t.created_at as string).getTime();
    const age = now - created;

    if (age >= REMIND_12H_MS && !t.escalated_at) {
      const mention = ESCALATE_USERS.length ? `${mentions(ESCALATE_USERS)} ` : "";
      const text =
        `${mention}:rotating_light: *12+ hours unanswered* — ${t.from_email} (${t.urgency ?? "?"} · ${t.score ?? "?"}/10). ` +
        `Please review the draft and Approve/Skip.`;
      await replyInThread(t.slack_channel_id, t.slack_thread_ts, text);
      await supabase
        .from("email_threads")
        .update({ escalated_at: new Date().toISOString(), reminded_12h_at: new Date().toISOString() })
        .eq("id", t.id);
      await logEvent({
        eventType: "feedback", // re-use existing event_type; detail says "nudge_12h"
        emailThreadId: t.id as string,
        fromEmail: t.from_email as string,
        subject: t.subject as string | null,
        actor: "system",
        detail: { nudge: "12h", escalated_to: ESCALATE_USERS },
      });
      escalated12++;
    } else if (age >= REMIND_6H_MS && !t.reminded_6h_at) {
      const text =
        `:bell: *Waiting 6+ hours* — ${t.from_email} (${t.urgency ?? "?"} · ${t.score ?? "?"}/10). ` +
        `The draft is still pending — Approve & Send, give feedback, or Skip.`;
      await replyInThread(t.slack_channel_id, t.slack_thread_ts, text);
      await supabase
        .from("email_threads")
        .update({ reminded_6h_at: new Date().toISOString() })
        .eq("id", t.id);
      await logEvent({
        eventType: "feedback",
        emailThreadId: t.id as string,
        fromEmail: t.from_email as string,
        subject: t.subject as string | null,
        actor: "system",
        detail: { nudge: "6h" },
      });
      nudged6++;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, considered: candidates?.length ?? 0, nudged6, escalated12 }),
    { headers: { "content-type": "application/json" } },
  );
});
