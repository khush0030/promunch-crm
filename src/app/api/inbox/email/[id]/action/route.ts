import { NextRequest, NextResponse } from "next/server";
import { getCaller } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";
import {
  auditSummary,
  isEmailThreadId,
  parseEmailDraftAction,
  routeStatusFor,
} from "@/lib/inbox/email-action";

// CRM Inbox › Email drafts: Approve & send / Edit / Rewrite / Skip.
// Owner-approved 17 Sep 2026 for any signed-in team member.
//
// This route never talks to Gmail or Slack itself (Next.js is the control
// plane). It proxies to the email-draft-action edge function, which reuses the
// Slack approval pipeline and its atomic claim, so a second click from the CRM
// or Slack can never email the customer twice. The actor is always the
// session user; the client can't claim to be someone else.

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCaller();
  if (!user?.email) {
    return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
  }

  const { id } = await params;
  if (!isEmailThreadId(id)) {
    return NextResponse.json({ ok: false, error: "That email thread id isn't valid." }, { status: 400 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = parseEmailDraftAction(raw);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const action = parsed.value;

  let edgeStatus: number;
  let out: Record<string, unknown>;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/email-draft-action`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...action, email_thread_id: id, actor_email: user.email }),
    });
    edgeStatus = r.status;
    out = await r.json().catch(() => ({ ok: false, error: "bad edge response" }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Couldn't reach the email service: ${msg}` }, { status: 502 });
  }

  const status = routeStatusFor(edgeStatus);
  if (status === 200 && out.ok === true) {
    await recordAudit({
      action: `email_draft.${action.action}`,
      entityType: "email_thread",
      entityId: id,
      summary: auditSummary(action.action, id),
      metadata: {
        result: out.status ?? null,
        revision: out.revision ?? null,
        ...(action.action === "rewrite" && action.feedback ? { feedback: action.feedback } : {}),
      },
      request: req,
      actor: user,
    });
  }

  if (status === 502) {
    return NextResponse.json(
      { ok: false, error: typeof out.error === "string" ? out.error : "email service failed" },
      { status },
    );
  }
  return NextResponse.json(out, { status });
}
