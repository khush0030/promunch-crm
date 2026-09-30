import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { warmAudienceError } from "@/lib/wa-warm-guard";
import { campaignTemplateError } from "@/lib/wa-campaign-template-guard";
import { armFollowups } from "@/lib/wa-campaign-journeys";

// A broadcast can take a couple of minutes; allow the full window.
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // A Warm campaign must never start before the SQL understands Warm (it
  // would otherwise go to everyone opted in).
  const { data: row } = await supabaseAdmin.from("wa_campaigns").select("*").eq("id", id).maybeSingle();
  const warmErr = await warmAudienceError(row?.audience_filter);
  if (warmErr) return NextResponse.json({ error: warmErr }, { status: 409 });
  const kindErr = await campaignTemplateError(row?.template_id);
  if (kindErr) return NextResponse.json({ error: kindErr }, { status: 400 });
  // A follow-up starts from its parent: it can't be launched before the
  // campaign it follows has started (the engine would find nobody anyway).
  if (row?.followup_of) {
    const { data: parent } = await supabaseAdmin.from("wa_campaigns")
      .select("started_at,status").eq("id", row.followup_of).maybeSingle();
    if (!parent?.started_at) {
      return NextResponse.json({
        error: "This follow-up starts by itself once the campaign it follows is sent. Send that campaign first.",
      }, { status: 409 });
    }
  }
  // Launching arms this campaign's draft follow-ups (recursively). They send
  // nothing now: each person gets a follow-up only once their time comes.
  let followups_armed = 0;
  try {
    followups_armed = await armFollowups(id);
  } catch (e) {
    console.error("wa_campaign_followup_arming_failed", { id, error: e instanceof Error ? e.message : String(e) });
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-campaign-send`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ campaign_id: id }),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json({ ...data, followups_armed }, { status: res.status });
}
