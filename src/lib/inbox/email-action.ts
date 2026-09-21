// Request validation for POST /api/inbox/email/[id]/action (CRM email draft
// actions). Pure so it can be unit-tested; the edge function
// email-draft-action re-validates with the same limits.

export const EDIT_MAX_CHARS = 8000;
export const FEEDBACK_MAX_CHARS = 500;

export type EmailDraftAction =
  | { action: "approve" }
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
    case "approve":
    case "skip":
      return { ok: true, value: { action: b.action } };
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
