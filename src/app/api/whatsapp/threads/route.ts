import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "30"));
  const status = searchParams.get("status") || "";        // bot|human|snoozed|closed
  const ticket = searchParams.get("ticket") || "";        // none|open|pending|resolved|closed
  const search = searchParams.get("search") || "";
  const archived = searchParams.get("archived") === "1";  // 1 = show archived only
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // Order by most-recent activity in either direction. Sorting by
  // last_inbound_at alone hides every customer we messaged who hasn't
  // replied yet — order confirmations sent to first-time recipients would
  // never appear in the inbox. last_activity_at is a generated column =
  // greatest(last_inbound_at, last_outbound_at).
  let q = supabaseAdmin
    .from("wa_threads")
    .select("*, contact:wa_contacts!inner(id, wa_id, phone, name, tags)", { count: "exact" })
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .range(from, to);

  // archived threads are hidden from every normal view; only ?archived=1 shows them
  q = archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);

  if (status) q = q.eq("status", status);
  if (ticket) q = q.eq("ticket_status", ticket);
  if (search) q = q.or(`wa_id.ilike.%${search}%,last_message_snippet.ilike.%${search}%,ticket_subject.ilike.%${search}%`);

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    threads: data ?? [],
    total: count ?? 0,
    page,
    pages: Math.max(1, Math.ceil((count ?? 0) / limit)),
  });
}
