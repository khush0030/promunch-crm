import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { firstHumanReplyAt } from "@/lib/inbox/tickets";
import {
  buildTicketReport,
  parseReportPeriod,
  reportFetchSince,
  type ReportTicketRow,
} from "@/lib/inbox/ticket-reports";

// GET /api/inbox/tickets/reports?period=7d|30d|90d — Inbox → Reports.
// Read-only: selects wa_threads ticket fields and the first human reply per
// ticket from wa_messages, then aggregates in src/lib/inbox/ticket-reports.ts.
// Session-gated by the middleware and mapped to the Inbox area under
// /api/inbox in src/lib/access.ts. Instagram threads carry no ticket
// category / solve time, so the report covers WhatsApp tickets.
export const dynamic = "force-dynamic";

type WaRow = {
  id: string;
  ticket_status: string | null;
  ticket_category: string | null;
  ticket_assignee: string | null;
  ticket_opened_at: string | null;
  ticket_resolved_at: string | null;
};

const PAGE = 1000;
const ID_CHUNK = 150;

export async function GET(req: Request) {
  const period = parseReportPeriod(new URL(req.url).searchParams.get("period"));
  const now = new Date();
  const sinceIso = reportFetchSince(period, now).toISOString();

  // Every ticket opened or solved since the previous window began, plus every
  // ticket still open (for "open now" and the per-person load).
  const threads: WaRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("wa_threads")
      .select("id, ticket_status, ticket_category, ticket_assignee, ticket_opened_at, ticket_resolved_at")
      .not("ticket_status", "is", null)
      .or(`ticket_opened_at.gte.${sinceIso},ticket_resolved_at.gte.${sinceIso},ticket_status.in.(open,pending)`)
      .order("ticket_opened_at", { ascending: true, nullsFirst: true })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as WaRow[];
    threads.push(...page);
    if (page.length < PAGE) break;
  }

  const openedAt: Record<string, string> = {};
  for (const t of threads) if (t.ticket_opened_at) openedAt[t.id] = t.ticket_opened_at;
  const ids = Object.keys(openedAt);

  let replies: Record<string, string> = {};
  if (ids.length > 0) {
    const minOpened = ids.reduce((m, id) => (openedAt[id] < m ? openedAt[id] : m), openedAt[ids[0]]);
    const msgs: { thread_id: string; direction: string; sent_by: string | null; created_at: string }[] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const { data, error } = await supabaseAdmin
        .from("wa_messages")
        .select("thread_id, direction, sent_by, created_at")
        .in("thread_id", ids.slice(i, i + ID_CHUNK))
        .eq("direction", "outbound")
        // Human senders only (same rule as isHumanReplySender).
        .or("sent_by.like.%@%,sent_by.eq.human")
        .gte("created_at", minOpened)
        .order("created_at", { ascending: true })
        .limit(5000);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      msgs.push(...((data ?? []) as typeof msgs));
    }
    replies = firstHumanReplyAt(msgs, openedAt);
  }

  const rows: ReportTicketRow[] = threads.map((t) => ({
    status: t.ticket_status,
    category: t.ticket_category,
    assignee: t.ticket_assignee,
    openedAt: t.ticket_opened_at,
    resolvedAt: t.ticket_resolved_at,
    firstReplyAt: replies[t.id] ?? null,
  }));

  return NextResponse.json(buildTicketReport(rows, period, now));
}
