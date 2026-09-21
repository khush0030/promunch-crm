// Pure request validation for email-draft-action (unit-tested in
// validate_test.ts). Mirrors src/lib/inbox/email-action.ts on the Next side;
// both enforce the same limits so neither side trusts the other blindly.

export const EDIT_MAX_CHARS = 8000;
export const FEEDBACK_MAX_CHARS = 500;

export type EmailDraftActionReq =
  | { action: "approve"; email_thread_id: string; actor_email: string }
  | { action: "skip"; email_thread_id: string; actor_email: string }
  | { action: "rewrite"; email_thread_id: string; actor_email: string; feedback?: string }
  | { action: "edit"; email_thread_id: string; actor_email: string; body: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseEmailDraftActionReq(
  raw: unknown,
): { ok: true; value: EmailDraftActionReq } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "body must be a JSON object" };
  const b = raw as Record<string, unknown>;
  const id = typeof b.email_thread_id === "string" ? b.email_thread_id.trim() : "";
  if (!UUID_RE.test(id)) return { ok: false, error: "email_thread_id must be a uuid" };
  const actor = typeof b.actor_email === "string" ? b.actor_email.trim() : "";
  if (!actor || !actor.includes("@") || actor.length > 320) {
    return { ok: false, error: "actor_email required" };
  }

  switch (b.action) {
    case "approve":
    case "skip":
      return { ok: true, value: { action: b.action, email_thread_id: id, actor_email: actor } };
    case "rewrite": {
      if (b.feedback !== undefined && b.feedback !== null && typeof b.feedback !== "string") {
        return { ok: false, error: "feedback must be text" };
      }
      const feedback = typeof b.feedback === "string" ? b.feedback.trim() : "";
      if (feedback.length > FEEDBACK_MAX_CHARS) {
        return { ok: false, error: `feedback must be ${FEEDBACK_MAX_CHARS} characters or fewer` };
      }
      return {
        ok: true,
        value: {
          action: "rewrite",
          email_thread_id: id,
          actor_email: actor,
          ...(feedback ? { feedback } : {}),
        },
      };
    }
    case "edit": {
      if (typeof b.body !== "string") return { ok: false, error: "body must be text" };
      const text = b.body.trim();
      if (text.length < 1) return { ok: false, error: "the draft can't be empty" };
      if (text.length > EDIT_MAX_CHARS) {
        return { ok: false, error: `the draft must be ${EDIT_MAX_CHARS} characters or fewer` };
      }
      return { ok: true, value: { action: "edit", email_thread_id: id, actor_email: actor, body: text } };
    }
    default:
      return { ok: false, error: "action must be approve, skip, rewrite or edit" };
  }
}
