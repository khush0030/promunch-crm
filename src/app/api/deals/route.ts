import { NextResponse } from "next/server";
import { requireSession } from "@/lib/leads/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseNewDeal } from "@/lib/deals/create";

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

// POST /api/deals — add a deal by hand ("New deal" drawer). Validates in
// src/lib/deals/create.ts. Writes one deals row; never emails anyone.
// Session-gated here and by the middleware; mapped to the B2B area under
// /api/deals in src/lib/access.ts.
export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const parsed = parseNewDeal(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await supabaseAdmin.from("deals").insert(parsed.row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deal: data }, { status: 201 });
}
