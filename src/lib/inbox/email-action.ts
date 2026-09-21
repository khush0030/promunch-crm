// Request validation for POST /api/inbox/email/[id]/action (CRM email draft
// actions). Pure so it can be unit-tested; the edge function
// email-draft-action re-validates with the same limits.

export const EDIT_MAX_CHARS = 8000;
export const FEEDBACK_MAX_CHARS = 500;

export type EmailDraftAction =
  | { action: "approve"; draft_revision_id: string }
  | { action: "skip" }
  | { action: "rewrite"; feedback?: string }
  | { action: "edit"; body: string };

export type ParseResult =
  | { ok: true; value: EmailDraftAction }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEmailThreadId(id: string): boolean {
  return UUID_RE.test(id);
}

export function parseEmailDraftAction(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Send a JSON body with an action." };
  }
  const b = raw as Record<string, unknown>;
  switch (b.action) {
    case "approve": {
      // The draft revision the approver was looking at. The edge function
      // refuses to send if a newer draft has replaced it.
      const rev = typeof b.draft_revision_id === "string" ? b.draft_revision_id.trim() : "";
      if (!UUID_RE.test(rev)) {
        return { ok: false, error: "Approve needs the id of the draft you reviewed." };
      }
      return { ok: true, value: { action: "approve", draft_revision_id: rev } };
    }
    case "skip":
      return { ok: true, value: { action: "skip" } };
    case "rewrite": {
      if (b.feedback !== undefined && b.feedback !== null && typeof b.feedback !== "string") {
        return { ok: false, error: "Rewrite instructions must be text." };
      }
      const feedback = typeof b.feedback === "string" ? b.feedback.trim() : "";
      if (feedback.length > FEEDBACK_MAX_CHARS) {
        return {
          ok: false,
          error: `Rewrite instructions must be ${FEEDBACK_MAX_CHARS} characters or fewer.`,
        };
      }
      return { ok: true, value: feedback ? { action: "rewrite", feedback } : { action: "rewrite" } };
    }
    case "edit": {
      if (typeof b.body !== "string") return { ok: false, error: "The edited draft must be text." };
      const body = b.body.trim();
      if (body.length < 1) return { ok: false, error: "The edited draft can't be empty." };
      if (body.length > EDIT_MAX_CHARS) {
        return { ok: false, error: `The edited draft must be ${EDIT_MAX_CHARS} characters or fewer.` };
      }
      return { ok: true, value: { action: "edit", body } };
    }
    default:
      return { ok: false, error: "Action must be approve, skip, rewrite or edit." };
  }
}

// Map the edge function's HTTP status to what the CRM route returns: refusals
// the UI should show (bad input, missing thread, already sent) pass through;
// anything else is an upstream failure (502).
export function routeStatusFor(edgeStatus: number): number {
  if (edgeStatus >= 200 && edgeStatus < 300) return 200;
  if (edgeStatus === 400 || edgeStatus === 404 || edgeStatus === 409) return edgeStatus;
  return 502;
}

export const DRAFT_CHANGED_MESSAGE = "The draft changed. Review the new version before sending.";
export const NOT_SENT_MESSAGE = "The reply was not sent. Nothing went to the customer.";
// Owner decision D2: Approve refuses when the support mailbox already replied
// in Gmail, and refuses (fails closed) when Gmail can't be checked. Both are
// definite: nothing was sent.
export const ALREADY_ANSWERED_MESSAGE = "Already answered in Gmail. Nothing was sent.";
export const GMAIL_CHECK_FAILED_MESSAGE = "Couldn't check Gmail, so nothing was sent. Try again in a minute.";

// Final HTTP status + JSON body for the CRM, from the edge function's answer.
export function shapeActionResponse(
  edgeStatus: number,
  out: Record<string, unknown>,
): { status: number; body: Record<string, unknown> } {
  if (out.status === "draft_changed") {
    return { status: 409, body: { ok: false, status: "draft_changed", error: DRAFT_CHANGED_MESSAGE } };
  }
  if (out.status === "already_answered") {
    return { status: 409, body: { ok: false, status: "already_answered", error: ALREADY_ANSWERED_MESSAGE } };
  }
  if (out.status === "gmail_check_failed") {
    return { status: 502, body: { ok: false, status: "gmail_check_failed", error: GMAIL_CHECK_FAILED_MESSAGE } };
  }
  if (out.error === "could not start the send") {
    return { status: 502, body: { ok: false, error: NOT_SENT_MESSAGE } };
  }
  const status = routeStatusFor(edgeStatus);
  if (status === 502) {
    return {
      status,
      body: { ok: false, error: typeof out.error === "string" ? out.error : "email service failed" },
    };
  }
  return { status, body: out };
}

export function auditSummary(action: EmailDraftAction["action"], threadId: string): string {
  switch (action) {
    case "approve":
      return `Approved and sent email draft for thread ${threadId}`;
    case "skip":
      return `Skipped email thread ${threadId}`;
    case "rewrite":
      return `Asked AI to rewrite email draft for thread ${threadId}`;
    case "edit":
      return `Edited email draft for thread ${threadId}`;
  }
}
