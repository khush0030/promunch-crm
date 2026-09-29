import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { intParam } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// Read the audit log for the Admin → Activity log viewer. Admin/Owner only:
// rows carry teammates' IP addresses and sign-in history. Writes only ever
// happen server-side (recordAudit() and the auth.sessions trigger, migration 015).
//
// Filters: action (exact, or a prefix ending in '.' e.g. 'auth.'), actor
// (email), before (ISO timestamp, for "load older").
export async function GET(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const limit = intParam(url.searchParams.get("limit"), 200, 1, 1000);
  const action = url.searchParams.get("action");
  const actor = url.searchParams.get("actor");
  const before = url.searchParams.get("before");

  let q = supabaseAdmin
    .from("audit_log")
    .select("id, actor_email, action, entity_type, entity_id, summary, metadata, ip, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (action) q = action.endsWith(".") ? q.like("action", `${action}%`) : q.eq("action", action);
  if (actor) q = q.eq("actor_email", actor.toLowerCase());
  if (before && !Number.isNaN(Date.parse(before))) q = q.lt("created_at", before);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}
