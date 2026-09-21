// Pure helpers for the Inbox › Email drafts queue (Task 2.8). No React, no
// Supabase, no fetch. The route (src/app/api/inbox/email/route.ts) reads
// rows and shapes them with these; the page reuses the types and stepIndex.
//
// tabOf is the single rule for "can this email be approved": only a pending
// thread whose classifier did not say "no reply needed" lands in "approve".
// Sending, failed, sent, skipped and no-reply threads are read-only.

export type EmailQueueTab = "approve" | "noreply" | "sent" | "skipped";

export const EMAIL_TABS: EmailQueueTab[] = ["approve", "noreply", "sent", "skipped"];

export function isEmailQueueTab(v: unknown): v is EmailQueueTab {
  return typeof v === "string" && (EMAIL_TABS as string[]).includes(v);
}

export function tabOf(r: { status: string; should_reply: boolean | null }): EmailQueueTab | null {
  if (r.status === "pending") return r.should_reply === false ? "noreply" : "approve";
  if (r.status === "sent") return "sent";
  if (r.status === "skipped") return "skipped";
  return null;
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
  counts: Record<EmailQueueTab, number>;
  items: EmailQueueItem[];
  selected: EmailQueueSelected | null;
};
