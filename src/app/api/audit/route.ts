import { NextRequest, NextResponse } from "next/server";
import { getCaller } from "@/lib/rbac-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Read the audit log for the in-app viewer. Any signed-in, allowed-domain user
// may read it; writes only ever happen server-side via recordAudit().
export async function GET(req: NextRequest) {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
  const action = url.searchParams.get("action");

  let q = supabaseAdmin
    .from("audit_log")
    .select("id, actor_email, action, entity_type, entity_id, summary, metadata, ip, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (action) q = q.eq("action", action);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}
