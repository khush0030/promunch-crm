import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sanitizeSearch } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "30"));
  const status = searchParams.get("status") || "";        // bot|human|snoozed|closed
  const ticket = searchParams.get("ticket") || "";        // none|open|pending|resolved|closed
  const search = searchParams.get("search") || "";
  const assignee = searchParams.get("assignee") || "";    // email | "unassigned"
  const archived = searchParams.get("archived") === "1";  // 1 = show archived only
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // Order by most-recent activity in either direction. Sorting by
  // last_inbound_at alone hides every customer we messaged who hasn't
  // replied yet — order confirmations sent to first-time recipients would
  // never appear in the inbox. last_activity_at is a generated column =
  // greatest(last_inbound_at, last_outbound_at).
  //
  // If that generated column hasn't been added to the DB yet, ordering by it
  // throws Postgres 42703 (undefined column) and the inbox renders empty.
  // Fall back to created_at so the inbox still loads; it self-heals to the
  // ideal sort the moment the column exists.
  const build = (orderCol: string) => {
    let q = supabaseAdmin
      .from("wa_threads")
      .select("*, contact:wa_contacts!inner(id, wa_id, phone, name, tags)", { count: "exact" })
      .order(orderCol, { ascending: false, nullsFirst: false })
      .range(from, to);

    // archived threads are hidden from every normal view; only ?archived=1 shows them
    q = archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);

    if (status) q = q.eq("status", status);
    if (ticket) q = q.eq("ticket_status", ticket);
    if (assignee === "unassigned") q = q.is("assigned_to", null);
    else if (assignee) q = q.eq("assigned_to", assignee);
    if (search) {
      const safe = sanitizeSearch(search);
      if (safe) q = q.or(`wa_id.ilike.%${safe}%,last_message_snippet.ilike.%${safe}%,ticket_subject.ilike.%${safe}%`);
    }
    return q;
  };

  let { data, count, error } = await build("last_activity_at");
  if (error?.code === "42703") {
    console.warn(
      "[wa/threads] last_activity_at column missing — falling back to created_at sort. " +
        "Add the generated column to restore activity-based ordering.",
    );
    ({ data, count, error } = await build("created_at"));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach the last message's direction + delivery status to each thread so the
  // inbox list can render WhatsApp-style ticks (sent → delivered → read) next to
  // proactive/bot sends. Ticks only make sense for OUTBOUND messages, so we also
  // expose the direction and let the UI hide them when the customer spoke last.
  const rows = data ?? [];
  if (rows.length) {
    const threadIds = rows.map((t: any) => t.id);
    const { data: msgs } = await supabaseAdmin
      .from("wa_messages")
      .select("thread_id, direction, status, created_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false });

    // First row per thread (already sorted newest-first) = the last message.
    const lastByThread = new Map<string, { direction: string; status: string }>();
    for (const m of msgs ?? []) {
      if (!lastByThread.has(m.thread_id)) {
        lastByThread.set(m.thread_id, { direction: m.direction, status: m.status });
      }
    }
    for (const t of rows) {
      const last = lastByThread.get(t.id);
      t.last_message_direction = last?.direction ?? null;
      t.last_outbound_status = last?.direction === "outbound" ? last.status : null;
    }
  }

  return NextResponse.json({
    threads: rows,
    total: count ?? 0,
    page,
    pages: Math.max(1, Math.ceil((count ?? 0) / limit)),
  });
}
