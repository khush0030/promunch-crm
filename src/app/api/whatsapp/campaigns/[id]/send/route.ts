import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { warmAudienceError } from "@/lib/wa-warm-guard";

// A broadcast can take a couple of minutes; allow the full window.
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // A Warm campaign must never start before the SQL understands Warm (it
  // would otherwise go to everyone opted in).
  const { data: row } = await supabaseAdmin.from("wa_campaigns").select("audience_filter").eq("id", id).maybeSingle();
  const warmErr = await warmAudienceError(row?.audience_filter);
  if (warmErr) return NextResponse.json({ error: warmErr }, { status: 409 });
  const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-campaign-send`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ campaign_id: id }),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
