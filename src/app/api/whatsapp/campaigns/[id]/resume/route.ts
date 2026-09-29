import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { campaignAction } from "@/lib/wa-campaign-action-route";
import { warmAudienceError } from "@/lib/wa-warm-guard";

export const maxDuration = 300;

// POST /api/whatsapp/campaigns/[id]/resume  ->  { campaign, engine }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Never restart a Warm campaign before the SQL understands Warm.
  const { data: row } = await supabaseAdmin.from("wa_campaigns").select("audience_filter").eq("id", id).maybeSingle();
  const warmErr = await warmAudienceError(row?.audience_filter);
  if (warmErr) return NextResponse.json({ error: warmErr }, { status: 409 });
  return campaignAction(req, { params: Promise.resolve({ id }) }, "resume");
}
