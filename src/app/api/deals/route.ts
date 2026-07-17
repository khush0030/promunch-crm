import { NextResponse } from "next/server";
import { requireSession } from "@/lib/leads/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Full pipeline in one payload (a few hundred deals at most); the client
// filters by kind/stage/search locally so the board stays snappy.
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const [{ data: deals, error }, { data: scan }] = await Promise.all([
    supabaseAdmin
      .from("deals")
      .select("*")
      .order("follow_up_needed", { ascending: false })
      .order("last_email_at", { ascending: false, nullsFirst: false })
      .limit(500),
    supabaseAdmin
      .from("deal_scan_state")
      .select("last_run_at, backfill_done, threads_scanned, last_error")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deals: deals ?? [], scan: scan ?? null });
}
