import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Call log for one WhatsApp number (Customer panel) or the latest 50 overall.
export async function GET(req: NextRequest) {
  const waId = req.nextUrl.searchParams.get("wa_id");
  let q = supabaseAdmin.from("voice_calls")
    .select("id, wa_id, order_ref, status, outcome, duration_s, failure_reason, transcript, link_sent_at, created_at")
    .order("created_at", { ascending: false }).limit(50);
  if (waId) q = q.eq("wa_id", waId.replace(/\D/g, ""));
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ calls: data ?? [] });
}
