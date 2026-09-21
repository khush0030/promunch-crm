// email-draft-action
// ---------------------------------------------------------------------------
// CRM Inbox › Email drafts: Approve & send / Edit / Rewrite / Skip a support
// email draft (owner-approved 17 Sep 2026). Called ONLY by the Next.js route
// POST /api/inbox/email/[id]/action with the service-role bearer, gated by
// requireInternal.
//
// Approve reuses the exact Slack pipeline (_shared/approve.ts) and therefore
// its atomic claim: a second click from the CRM or from Slack can never send
// the customer a second email (CLAUDE.md §0). The other actions never send.

import { requireInternal } from "../_shared/require-internal.ts";
import { db } from "../_shared/supabase.ts";
import { approveAndSend } from "../_shared/approve.ts";
import { rewriteDraft, saveEditedDraft, skipThread } from "../_shared/email-actions.ts";
import { parseEmailDraftActionReq } from "./validate.ts";

type EmailDraftActionRes = {
  ok: boolean;
  status?: "sent" | "already_sent" | "skipped" | "rewritten" | "saved";
  error?: string;
  revision?: number;
};

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return j({ ok: false, error: "bad json" }, 400);
  }
  const parsed = parseEmailDraftActionReq(raw);
  if (!parsed.ok) return j({ ok: false, error: parsed.error }, 400);
  const r = parsed.value;

  try {
    let out: EmailDraftActionRes;
    switch (r.action) {
      case "approve": {
        const { data: thread } = await db()
          .from("email_threads")
          .select("slack_channel_id, slack_thread_ts")
          .eq("id", r.email_thread_id)
          .maybeSingle();
        if (!thread) return j({ ok: false, error: "thread not found" }, 404);
        out = await approveAndSend({
          emailThreadId: r.email_thread_id,
          approvedBySlackUser: null,
          approvedByEmail: r.actor_email,
          slackChannel: thread.slack_channel_id,
          slackThreadTs: thread.slack_thread_ts,
        });
        break;
      }
      case "skip":
        out = await skipThread({
          emailThreadId: r.email_thread_id,
          source: { kind: "crm", email: r.actor_email },
        });
        break;
      case "rewrite":
        out = await rewriteDraft({
          emailThreadId: r.email_thread_id,
          source: { kind: "crm", email: r.actor_email },
          feedback: r.feedback ?? null,
        });
        break;
      case "edit":
        out = await saveEditedDraft({
          emailThreadId: r.email_thread_id,
          body: r.body,
          actorEmail: r.actor_email,
        });
        break;
    }
    return j(out, statusFor(out));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`email-draft-action ${r.action} failed:`, msg);
    return j({ ok: false, error: msg }, 500);
  }
});

// 200 for success (incl. already_sent), 404/409 for refusals the CRM should
// show as-is, 500 for real failures (e.g. Gmail send error).
function statusFor(out: EmailDraftActionRes): number {
  if (out.ok) return 200;
  const err = out.error ?? "";
  if (err === "thread not found") return 404;
  if (err === "already sent" || err === "no current draft" || err.startsWith("another revision")) {
    return 409;
  }
  return 500;
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json" },
  });
}
