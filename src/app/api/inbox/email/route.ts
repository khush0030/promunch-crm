import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { categoryWord, urgencyPill } from "@/components/inbox/labels";
import { isEmailThreadId } from "@/lib/inbox/email-action";
import {
  EMAIL_TABS,
  isEmailQueueTab,
  sortQueue,
  stuckSendingBefore,
  tabOf,
  type EmailQueueItem,
  type EmailQueueResponse,
  type EmailQueueSelected,
  type EmailQueueTab,
} from "@/lib/inbox/email";

// GET /api/inbox/email?tab=approve|attention|noreply|sent|skipped&id=
// Inbox › Email drafts queue (Task 2.8). READ-ONLY: this route only SELECTs.
// Every write (approve, edit, rewrite, skip) goes through
// POST /api/inbox/email/[id]/action, which proxies to the email-draft-action
// edge function and its atomic send claim.
export const dynamic = "force-dynamic";

const MAX_ITEMS = 200;
// Pending queues are sorted urgency-first, so read a wider window than we
// return; the history tabs just show the newest 200.
const PENDING_WINDOW = 1000;

const ITEM_COLUMNS =
  "id, from_name, from_email, subject, lead_category, urgency, created_at, updated_at, status, should_reply";
const THREAD_COLUMNS =
  "id, from_name, from_email, subject, body_plain, snippet, created_at, updated_at, lead_category, urgency, status, should_reply";

type ThreadRow = {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string | null;
  lead_category: string | null;
  urgency: string | null;
  created_at: string;
  updated_at: string | null;
  status: string;
  should_reply: boolean | null;
};

type FullThreadRow = ThreadRow & { body_plain: string | null; snippet: string | null };

type DraftRow = {
  id: string;
  revision: number;
  body: string;
  feedback: string | null;
  created_at: string;
  is_current: boolean;
};

type SentRow = {
  body: string;
  sent_at: string;
  approved_by_slack_user: string | null;
  approved_by_email?: string | null;
};

// The same WHERE clause per tab for counts and items. Kept as data so both
// query builders apply it identically. "attention" = failed, or stuck in
// 'sending' for more than 5 minutes (same rule as tabOf).
type TabFilter = { status: string; shouldReply?: "null_or_true" | "false" } | { attention: true };
const TAB_FILTER: Record<EmailQueueTab, TabFilter> = {
  approve: { status: "pending", shouldReply: "null_or_true" },
  attention: { attention: true },
  noreply: { status: "pending", shouldReply: "false" },
  sent: { status: "sent" },
  skipped: { status: "skipped" },
};

// PostgREST filter for "attention": failed, or 'sending' with no update for
// more than 5 minutes.
function attentionFilter(nowMs: number): string {
  return `status.eq.failed,and(status.eq.sending,updated_at.lt.${stuckSendingBefore(nowMs)})`;
}

function countQuery(tab: EmailQueueTab, nowMs: number) {
  const f = TAB_FILTER[tab];
  const base = supabaseAdmin.from("email_threads").select("id", { count: "exact", head: true });
  if ("attention" in f) return base.or(attentionFilter(nowMs));
  let q = base.eq("status", f.status);
  if (f.shouldReply === "null_or_true") q = q.or("should_reply.is.null,should_reply.eq.true");
  if (f.shouldReply === "false") q = q.eq("should_reply", false);
  return q;
}

function itemsQuery(tab: EmailQueueTab, ascending: boolean, limit: number, nowMs: number) {
  const f = TAB_FILTER[tab];
  const base = supabaseAdmin.from("email_threads").select(ITEM_COLUMNS);
  if ("attention" in f) return base.or(attentionFilter(nowMs)).order("created_at", { ascending }).limit(limit);
  let q = base.eq("status", f.status);
  if (f.shouldReply === "null_or_true") q = q.or("should_reply.is.null,should_reply.eq.true");
  if (f.shouldReply === "false") q = q.eq("should_reply", false);
  return q.order("created_at", { ascending }).limit(limit);
}

// A failed count is null, not 0: "0 drafts waiting" would be a lie.
async function countTab(tab: EmailQueueTab, nowMs: number): Promise<number | null> {
  try {
    const { count, error } = await countQuery(tab, nowMs);
    if (error) {
      console.error(`[inbox/email] count ${tab}:`, error.message);
      return null;
    }
    return count ?? 0;
  } catch (e) {
    console.error(`[inbox/email] count ${tab}:`, e);
    return null;
  }
}

function toItem(r: ThreadRow): EmailQueueItem {
  return {
    id: r.id,
    from_name: r.from_name,
    from_email: r.from_email,
    subject: r.subject,
    category: categoryWord(r.lead_category),
    urgency: urgencyPill(r.urgency),
    created_at: r.created_at,
  };
}

async function loadSent(id: string): Promise<EmailQueueSelected["sent"]> {
  let rows: SentRow[] = [];
  const withEmail = await supabaseAdmin
    .from("sent_replies")
    .select("body, sent_at, approved_by_slack_user, approved_by_email")
    .eq("email_thread_id", id)
    .order("sent_at", { ascending: false })
    .limit(1);
  if (!withEmail.error) {
    rows = (withEmail.data ?? []) as SentRow[];
  } else if (withEmail.error.code === "42703") {
    // approved_by_email arrives with migration 20260917120000; until it is
    // applied in prod, read without it rather than failing the page.
    const without = await supabaseAdmin
      .from("sent_replies")
      .select("body, sent_at, approved_by_slack_user")
      .eq("email_thread_id", id)
      .order("sent_at", { ascending: false })
      .limit(1);
    if (without.error) {
      console.error("[inbox/email] sent_replies:", without.error.message);
      return null;
    }
    rows = (without.data ?? []) as SentRow[];
  } else {
    console.error("[inbox/email] sent_replies:", withEmail.error.message);
    return null;
  }
  const row = rows[0];
  if (!row) return null;
  return { body: row.body, sent_at: row.sent_at, approved_by: row.approved_by_email ?? "Slack" };
}

async function loadSelected(id: string, nowMs: number): Promise<EmailQueueSelected | null> {
  const { data: t, error } = await supabaseAdmin.from("email_threads").select(THREAD_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!t) return null;
  const thread = t as FullThreadRow;

  const [draftsRes, sent] = await Promise.all([
    supabaseAdmin
      .from("draft_revisions")
      .select("id, revision, body, feedback, created_at, is_current")
      .eq("email_thread_id", id)
      .order("revision", { ascending: true }),
    loadSent(id),
  ]);
  if (draftsRes.error) console.error("[inbox/email] draft_revisions:", draftsRes.error.message);
  const drafts = (draftsRes.data ?? []) as DraftRow[];
  // Only the current revision is approvable; the edge refuses anything else.
  const current = drafts.filter((d) => d.is_current).sort((a, b) => b.revision - a.revision)[0] ?? null;

  return {
    id: thread.id,
    from_name: thread.from_name,
    from_email: thread.from_email,
    subject: thread.subject,
    body_plain: thread.body_plain ?? thread.snippet,
    created_at: thread.created_at,
    category: categoryWord(thread.lead_category),
    urgency: urgencyPill(thread.urgency),
    status: thread.status,
    tab: tabOf({ status: thread.status, should_reply: thread.should_reply, updated_at: thread.updated_at }, nowMs),
    draft: current ? { id: current.id, body: current.body, revision: current.revision } : null,
    revisions: drafts.map((d) => ({ revision: d.revision, feedback: d.feedback, created_at: d.created_at })),
    sent,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawTab = url.searchParams.get("tab");
  const tab: EmailQueueTab = isEmailQueueTab(rawTab) ? rawTab : "approve";
  const rawId = url.searchParams.get("id");
  const wantedId = rawId && isEmailThreadId(rawId) ? rawId : null;

  const pending = tab === "approve" || tab === "noreply";
  const nowMs = Date.now();
  const [countList, itemsRes] = await Promise.all([
    Promise.all(EMAIL_TABS.map((t) => countTab(t, nowMs))),
    itemsQuery(tab, pending, pending ? PENDING_WINDOW : MAX_ITEMS, nowMs),
  ]);
  if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });

  // Belt and braces: keep only rows whose own status really belongs to this
  // tab, so a row can never be offered for approval from the wrong list.
  const rows = ((itemsRes.data ?? []) as ThreadRow[]).filter((r) => tabOf(r, nowMs) === tab);
  const ordered = pending ? sortQueue(rows) : rows;
  const items = ordered.slice(0, MAX_ITEMS).map(toItem);

  const counts = Object.fromEntries(EMAIL_TABS.map((t, i) => [t, countList[i]])) as Record<EmailQueueTab, number | null>;

  let selected: EmailQueueSelected | null = null;
  try {
    if (wantedId) selected = await loadSelected(wantedId, nowMs);
    if (!selected && items[0]) selected = await loadSelected(items[0].id, nowMs);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const body: EmailQueueResponse = { counts, items, selected };
  return NextResponse.json(body);
}
