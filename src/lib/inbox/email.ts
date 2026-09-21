// Pure helpers for the Inbox › Email drafts queue (Task 2.8). No React, no
// Supabase, no fetch. The route (src/app/api/inbox/email/route.ts) reads
// rows and shapes them with these; the page reuses the types and stepIndex.
//
// tabOf is the single rule for "can this email be approved": only a pending
// thread whose classifier did not say "no reply needed" lands in "approve".
// Sending, failed, sent, skipped and no-reply threads are read-only. Failed
// threads and threads stuck in 'sending' land in "attention" (read-only, no
// retry): their reply may or may not have gone out.

import {
  ALREADY_ANSWERED_MESSAGE,
  DRAFT_CHANGED_MESSAGE,
  GMAIL_CHECK_FAILED_MESSAGE,
  NOT_SENT_MESSAGE,
} from "./email-action";

export type EmailQueueTab = "approve" | "attention" | "noreply" | "sent" | "skipped";

export const EMAIL_TABS: EmailQueueTab[] = ["approve", "attention", "noreply", "sent", "skipped"];

// A thread still 'sending' after this long is stuck, not in flight.
export const STUCK_SENDING_MS = 5 * 60_000;

export const ATTENTION_MESSAGE =
  "This reply may or may not have gone out. Check the support mailbox's Sent folder in Gmail before doing anything.";

export function isEmailQueueTab(v: unknown): v is EmailQueueTab {
  return typeof v === "string" && (EMAIL_TABS as string[]).includes(v);
}

// Cutoff for "stuck sending": rows whose updated_at is before this ISO time.
export function stuckSendingBefore(nowMs: number): string {
  return new Date(nowMs - STUCK_SENDING_MS).toISOString();
}

export function tabOf(
  r: { status: string; should_reply: boolean | null; updated_at?: string | null },
  nowMs: number = Date.now(),
): EmailQueueTab | null {
  if (r.status === "pending") return r.should_reply === false ? "noreply" : "approve";
  if (r.status === "sent") return "sent";
  if (r.status === "skipped") return "skipped";
  if (r.status === "failed") return "attention";
  if (r.status === "sending") {
    const t = r.updated_at ? Date.parse(r.updated_at) : NaN;
    // No usable timestamp: we can't tell in-flight from stuck, so show it.
    if (!Number.isFinite(t)) return "attention";
    return nowMs - t > STUCK_SENDING_MS ? "attention" : null;
  }
  return null;
}

// Whole days since `iso`, but only when the email has waited MORE than
// 3 days (the "N days old" warning). Otherwise null.
export const OLD_EMAIL_DAYS = 3;
export function oldEmailDays(iso: string, nowMs: number = Date.now()): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((nowMs - t) / 86_400_000);
  return days > OLD_EMAIL_DAYS ? days : null;
}

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1 };

// Critical, then high, then everything else; oldest first inside a group.
export function sortQueue<T extends { urgency: string | null; created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ra = URGENCY_RANK[a.urgency ?? ""] ?? 2;
    const rb = URGENCY_RANK[b.urgency ?? ""] ?? 2;
    if (ra !== rb) return ra - rb;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return 0;
  });
}

// Position of `current` in the queue for the phone stepper ("2 of 5").
// `index` is 0-based; a missing or null id falls back to the first item.
export function stepIndex(
  ids: string[],
  current: string | null,
): { index: number; total: number; prev: string | null; next: string | null } {
  const total = ids.length;
  if (total === 0) return { index: 0, total: 0, prev: null, next: null };
  const found = current ? ids.indexOf(current) : -1;
  const index = found >= 0 ? found : 0;
  return {
    index,
    total,
    prev: index > 0 ? ids[index - 1] : null,
    next: index < total - 1 ? ids[index + 1] : null,
  };
}

// Cap a long email body for the bubble; the page offers "Show all".
export function clipText(s: string | null, max: number): { text: string; clipped: boolean } {
  const text = s ?? "";
  if (text.length <= max) return { text, clipped: false };
  return { text: text.slice(0, max).trimEnd() + "…", clipped: true };
}

export type EmailQueueItem = {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string | null;
  category: string;
  urgency: { tone: "crit" | "warn"; text: string } | null;
  created_at: string;
};

export type EmailQueueSelected = {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string | null;
  body_plain: string | null;
  created_at: string;
  category: string;
  urgency: { tone: "crit" | "warn"; text: string } | null;
  status: string;
  // The thread's real tab (from its own status + should_reply), not the tab
  // in the URL. Action buttons show only when this is "approve".
  tab: EmailQueueTab | null;
  // `id` is the draft_revisions row id: Approve sends it as
  // draft_revision_id so the edge refuses if a newer draft replaced it.
  draft: { id: string; body: string; revision: number } | null;
  revisions: { revision: number; feedback: string | null; created_at: string }[];
  sent: { body: string; sent_at: string; approved_by: string | null } | null;
};

export type EmailQueueResponse = {
  // null = that count query failed; the page shows no number rather than 0.
  counts: Record<EmailQueueTab, number | null>;
  items: EmailQueueItem[];
  selected: EmailQueueSelected | null;
};

// ---- Action outcomes -----------------------------------------------------
// One place decides what the reviewer reads after Approve / Skip / Edit /
// Rewrite. "Nothing went to the customer" is only ever said when the failure
// is definite (refused before any send). Anything ambiguous on Approve
// (network drop, non-JSON body, 504, Gmail error mid-send) says we couldn't
// confirm, and the page refetches to settle it.

export type DraftAction = "approve" | "skip" | "edit" | "rewrite";

export const UNCERTAIN_SEND_MESSAGE =
  "We couldn't confirm whether the reply went out. Check the Sent tab before trying again.";
// The uncertain copy once the refetched thread turned out failed/stuck: the
// Sent tab won't have it, Gmail's Sent folder is the only truth.
export const UNCERTAIN_CHECK_GMAIL_MESSAGE =
  "We couldn't confirm whether the reply went out. Check the support mailbox's Sent folder in Gmail.";
export const REPLY_SENT_MESSAGE = "The reply was sent.";
const NOTHING_WENT = "Nothing went to the customer.";

// Edge refusals that happen before Gmail is ever called.
const PRE_SEND_EDGE_ERRORS = new Set([
  "could not start the send",
  "no current draft",
  "thread not found",
  "draft changed",
  "already answered in gmail",
  "could not check gmail",
]);

// Known edge strings to plain sentences. The route's own copy is already a
// plain sentence (capitalised, ends in punctuation) and passes through.
// Anything else returns null so raw error text never reaches the screen.
export function plainEdgeError(error: unknown): string | null {
  if (typeof error !== "string") return null;
  const e = error.trim();
  if (e === "already sent") return "This reply was already sent.";
  if (e === "no current draft") return "There's no draft to send yet.";
  if (e === "draft changed" || e.startsWith("another revision")) return DRAFT_CHANGED_MESSAGE;
  if (e === "thread not found") return "This email no longer exists.";
  if (e === "could not start the send") return NOT_SENT_MESSAGE;
  if (e === "already answered in gmail") return ALREADY_ANSWERED_MESSAGE;
  if (e === "could not check gmail") return GMAIL_CHECK_FAILED_MESSAGE;
  if (/^[A-Z][^\n]{0,200}[.!?]$/.test(e)) return e;
  return null;
}

export type ActionOutcome =
  | { kind: "success"; status: string | null }
  | { kind: "failed"; tone: "crit"; message: string; uncertain: boolean };

const NOT_DONE: Record<Exclude<DraftAction, "approve">, string> = {
  skip: "The email was not skipped.",
  edit: "The draft was not saved.",
  rewrite: "The draft was not rewritten.",
};

// httpStatus null = the fetch threw; body null = the response wasn't JSON.
export function actionOutcome(
  action: DraftAction,
  res: { httpStatus: number | null; body: { ok?: unknown; status?: unknown; error?: unknown; [k: string]: unknown } | null },
): ActionOutcome {
  const { httpStatus, body } = res;
  if (httpStatus != null && httpStatus >= 200 && httpStatus < 300 && body?.ok === true) {
    return { kind: "success", status: typeof body.status === "string" ? body.status : null };
  }
  const fail = (message: string, uncertain: boolean): ActionOutcome => ({ kind: "failed", tone: "crit", message, uncertain });

  if (action !== "approve") {
    const plain = body?.status === "draft_changed" ? DRAFT_CHANGED_MESSAGE : plainEdgeError(body?.error);
    return fail(`${NOT_DONE[action]} ${plain ?? "Something went wrong, please try again."}`, false);
  }

  const uncertain = fail(UNCERTAIN_SEND_MESSAGE, true);
  if (httpStatus == null || body == null) return uncertain;

  // Refused before the claim: already answered in Gmail, or Gmail couldn't
  // be checked (fail closed). Both are definite not-sent outcomes.
  if (body.status === "already_answered") return fail(ALREADY_ANSWERED_MESSAGE, false);
  if (body.status === "gmail_check_failed") return fail(GMAIL_CHECK_FAILED_MESSAGE, false);

  if (httpStatus === 409) {
    if (body.status === "draft_changed") return fail(DRAFT_CHANGED_MESSAGE, false);
    return fail(plainEdgeError(body.error) ?? `${NOT_SENT_MESSAGE}`, false);
  }
  // Refused by the route or edge before any send.
  if (httpStatus === 400 || httpStatus === 401 || httpStatus === 404) {
    const plain = plainEdgeError(body.error);
    return fail(plain ? `${plain} ${NOTHING_WENT}` : NOT_SENT_MESSAGE, false);
  }
  if (httpStatus === 502 && body.error === NOT_SENT_MESSAGE) return fail(NOT_SENT_MESSAGE, false);
  if (typeof body.error === "string" && PRE_SEND_EDGE_ERRORS.has(body.error.trim())) {
    const plain = plainEdgeError(body.error)!;
    const saysNotSent = plain === NOT_SENT_MESSAGE || plain === ALREADY_ANSWERED_MESSAGE || plain === GMAIL_CHECK_FAILED_MESSAGE;
    return fail(saysNotSent ? plain : `${plain} ${NOTHING_WENT}`, false);
  }
  return uncertain;
}

// After the refetch: an uncertain send that landed on the Sent tab reads as
// sent. One that landed failed (or stuck, "attention") points at Gmail's Sent
// folder, never the Sent tab. Everything else is shown as decided.
export function settleNotice(
  n: { tone: "crit" | "plain"; message: string; uncertain: boolean },
  tab: EmailQueueTab | null,
  status?: string | null,
): { tone: "crit" | "plain"; message: string } {
  if (n.uncertain && tab === "sent") return { tone: "plain", message: REPLY_SENT_MESSAGE };
  if (n.uncertain && (tab === "attention" || status === "failed")) {
    return { tone: "crit", message: UNCERTAIN_CHECK_GMAIL_MESSAGE };
  }
  return { tone: n.tone, message: n.message };
}

// ---- Draft block label ---------------------------------------------------

export type DraftBlock = { kind: "sent" | "draft"; label: string; sublabel?: string; body: string } | null;

export function draftBlock(
  s: Pick<EmailQueueSelected, "tab" | "status" | "from_email" | "draft" | "sent">,
  fmt: (iso: string) => string,
): DraftBlock {
  if (s.tab === "sent") {
    if (s.sent) {
      return { kind: "sent", label: `Sent · ${s.sent.approved_by || "Slack"} · ${fmt(s.sent.sent_at)}`, body: s.sent.body };
    }
    return s.draft
      ? { kind: "sent", label: "Sent · copy not recorded", sublabel: "The draft that was current", body: s.draft.body }
      : { kind: "sent", label: "Sent · copy not recorded", body: "" };
  }
  if (!s.draft) return null;
  if (s.tab === "approve") {
    return { kind: "draft", label: `Draft · reply goes to ${s.from_email} · grounded in Master KB`, body: s.draft.body };
  }
  if (s.tab === "attention") {
    return { kind: "draft", label: "Draft · may or may not have gone out", body: s.draft.body };
  }
  if (s.tab === "skipped" || s.tab === "noreply" || s.status === "failed") {
    return { kind: "draft", label: "Draft · not sent", body: s.draft.body };
  }
  if (s.status === "sending") return { kind: "draft", label: "Draft · sending now", body: s.draft.body };
  return { kind: "draft", label: "Draft", body: s.draft.body };
}

// ---- Senders that can't receive a reply ----------------------------------
// A reply goes to from_email. Contact-form relays and no-reply senders would
// swallow it, so Approve is hidden for them.

const BLOCKED_LOCAL = /(^|[._+-])(no[-_]?reply|do[-_]?not[-_]?reply|mailer-daemon|postmaster|notifications?|bounces?)([._+-]|$)/i;
const BLOCKED_DOMAIN = /(^|\.)(no[-_]?reply|bounces?)\./i;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function contactFormEmail(body: string | null): string | null {
  if (!body) return null;
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*Email:\s*(.*)$/i.exec(lines[i]);
    if (!m) continue;
    let v = m[1].trim();
    if (!v) {
      for (let j = i + 1; j < lines.length && !v; j++) v = lines[j].trim();
    }
    v = v.replace(/^<|>$/g, "");
    return EMAIL_RE.test(v) ? v : null;
  }
  return null;
}

export function replyBlockedReason(
  fromEmail: string,
  bodyPlain: string | null,
): { message: string; customerEmail: string | null } | null {
  const from = (fromEmail || "").trim().toLowerCase();
  const at = from.lastIndexOf("@");
  const local = at >= 0 ? from.slice(0, at) : from;
  const domain = at >= 0 ? from.slice(at + 1) : "";
  const shopifyForm = from === "mailer@shopify.com";
  if (!shopifyForm && !BLOCKED_LOCAL.test(local) && !BLOCKED_DOMAIN.test(domain)) return null;
  const customerEmail = shopifyForm ? contactFormEmail(bodyPlain) : null;
  const middle = customerEmail ? ` The customer wrote from ${customerEmail}; reply to them directly from Gmail.` : "";
  return { message: `Replies to this sender don't reach anyone.${middle} Skip it once handled.`, customerEmail };
}
