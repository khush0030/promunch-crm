import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildBoard, extractOrderRef, firstHumanReplyAt, type TicketRow } from "@/lib/inbox/tickets";

// GET /api/inbox/tickets — the Tickets board (Task 2.6). Read-only: reuses
// the existing PATCH /api/whatsapp/threads/[id] and
// PATCH /api/instagram/threads/[id]/stage routes for every write, never
// messages a customer. Ticket state lives on wa_threads/ig_threads (there
// is no dedicated ticket table); see AGENTS.md §6 for the schema notes.
export const dynamic = "force-dynamic";

const WA_COLUMNS =
  "id, ticket_number, ticket_status, ticket_subject, ticket_category, escalation_reason, ticket_assignee, ticket_opened_at, ticket_resolved_at, contact:wa_contacts!inner(name, phone, wa_id)";
// ig_threads has no ticket_number/ticket_subject/ticket_category/
// ticket_resolved_at/ticket_assignee columns (see the Instagram DM
// migration) — select only what exists and fill the rest with null below.
const IG_COLUMNS = "id, ticket_status, ticket_opened_at, escalation_reason, assigned_to, handle, full_name";

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

type WaThreadRow = {
  id: string;
  ticket_number: number | null;
  ticket_status: string | null;
  ticket_subject: string | null;
  ticket_category: string | null;
  escalation_reason: string | null;
  ticket_assignee: string | null;
  ticket_opened_at: string | null;
  ticket_resolved_at: string | null;
  contact: { name: string | null; phone: string | null; wa_id: string } | null;
};

type IgThreadRow = {
  id: string;
  ticket_status: string | null;
  ticket_opened_at: string | null;
  escalation_reason: string | null;
  assigned_to: string | null;
  handle: string | null;
  full_name: string | null;
};

function isOpenTicketStatus(s: string | null): s is "open" | "pending" | "resolved" | "closed" {
  return s === "open" || s === "pending" || s === "resolved" || s === "closed";
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Same name-resolution rule as GET /api/team (src/app/api/team/route.ts):
// user_metadata.full_name / .name, falling back to the capitalised email
// local part. There is no dedicated team-members table to import a helper
// from, so this mirrors that route's logic against the same auth users list.
async function loadTeamNames(): Promise<(email: string) => string> {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const map = new Map<string, string>();
  if (!error && data) {
    for (const u of data.users) {
      if (!u.email) continue;
      const meta = (u.user_metadata || {}) as Record<string, unknown>;
      const name =
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        capitalize(u.email.split("@")[0]);
      map.set(u.email, name);
    }
  }
  return (email: string) => map.get(email) ?? capitalize(email.split("@")[0] || email);
}

export async function GET() {
  const now = new Date();
  const cutoffIso = new Date(now.getTime() - FOURTEEN_DAYS_MS).toISOString();

  const { data: waRaw, error: waError } = await supabaseAdmin
    .from("wa_threads")
    .select(WA_COLUMNS)
    .is("archived_at", null)
    .or(`ticket_status.in.(open,pending),ticket_resolved_at.gte.${cutoffIso}`)
    .limit(500);
  if (waError) return NextResponse.json({ error: waError.message }, { status: 500 });
  const waRows = (waRaw ?? []) as unknown as WaThreadRow[];

  // Instagram tolerates any failure (missing table/columns, RLS, etc.) and
  // just contributes zero tickets rather than 500ing the whole board — IG
  // has no live ticket rows today (see the brief), so this path is untested
  // in prod but must never take the page down.
  let igRows: IgThreadRow[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from("ig_threads")
      .select(IG_COLUMNS)
      .is("archived_at", null)
      .in("ticket_status", ["open", "pending"])
      .limit(500);
    if (!error && data) igRows = data as unknown as IgThreadRow[];
  } catch {
    igRows = [];
  }

  // First human reply per WA thread: one query over wa_messages for the
  // threads we're actually showing, reduced in the pure helper.
  const openedByThread: Record<string, string> = {};
  for (const r of waRows) {
    if (r.ticket_opened_at) openedByThread[r.id] = r.ticket_opened_at;
  }
  const threadIds = Object.keys(openedByThread);
  let replyMap: Record<string, string> = {};
  if (threadIds.length > 0) {
    const minOpened = threadIds.reduce((min, id) => {
      const t = openedByThread[id];
      return !min || t < min ? t : min;
    }, "");
    const { data: msgs } = await supabaseAdmin
      .from("wa_messages")
      .select("thread_id, direction, sent_by, created_at")
      .in("thread_id", threadIds)
      .eq("direction", "outbound")
      .gte("created_at", minOpened)
      .limit(5000);
    replyMap = firstHumanReplyAt(
      (msgs ?? []) as { thread_id: string; direction: string; sent_by: string | null; created_at: string }[],
      openedByThread,
    );
  }

  const rows: TicketRow[] = [];
  for (const r of waRows) {
    if (!isOpenTicketStatus(r.ticket_status)) continue;
    const name = r.contact?.name?.trim();
    rows.push({
      id: r.id,
      channel: "wa",
      ticket_number: r.ticket_number,
      ticket_status: r.ticket_status,
      ticket_subject: r.ticket_subject,
      ticket_category: r.ticket_category,
      escalation_reason: r.escalation_reason,
      ticket_assignee: r.ticket_assignee,
      ticket_opened_at: r.ticket_opened_at,
      ticket_resolved_at: r.ticket_resolved_at,
      customer: name || r.contact?.phone || r.contact?.wa_id || "Unknown",
      firstHumanReplyAt: replyMap[r.id] ?? null,
    });
  }
  for (const r of igRows) {
    if (!isOpenTicketStatus(r.ticket_status)) continue;
    const name = r.full_name?.trim();
    rows.push({
      id: r.id,
      channel: "ig",
      ticket_number: null,
      ticket_status: r.ticket_status,
      ticket_subject: null,
      ticket_category: null,
      escalation_reason: r.escalation_reason,
      ticket_assignee: r.assigned_to,
      ticket_opened_at: r.ticket_opened_at,
      ticket_resolved_at: null,
      customer: name || (r.handle ? `@${r.handle}` : "Instagram user"),
      firstHumanReplyAt: null,
    });
  }

  // Order values: look up shopify_orders.total_price for every order ref we
  // can extract from a ticket's subject/escalation text.
  const refs = new Set<string>();
  for (const r of rows) {
    const ref = extractOrderRef(r.ticket_subject) ?? extractOrderRef(r.escalation_reason);
    if (ref) refs.add(ref);
  }
  const orders: Record<string, number> = {};
  if (refs.size > 0) {
    const numbers = [...refs].map((ref) => ref.slice(1));
    const { data: orderRows } = await supabaseAdmin
      .from("shopify_orders")
      .select("order_number, total_price")
      .in("order_number", numbers);
    for (const o of (orderRows ?? []) as { order_number: string; total_price: number | string | null }[]) {
      if (o.total_price != null) orders[`#${o.order_number}`] = Number(o.total_price);
    }
  }

  const teamName = await loadTeamNames();
  const board = buildBoard(rows, orders, now, teamName);

  return NextResponse.json(board);
}
