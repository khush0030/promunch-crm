import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Per-RFM-tier rollup for the campaigns segment overview.
// GET /api/whatsapp/segments  ->  { segments: [{ rfm_tier, customers, spend, avg_recency }] }
export async function GET() {
  const { data, error } = await supabaseAdmin.rpc("wa_rfm_summary");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ segments: data ?? [] });
}
