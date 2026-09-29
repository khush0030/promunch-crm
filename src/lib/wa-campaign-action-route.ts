// Shared handler for POST /api/whatsapp/campaigns/[id]/{pause,resume,cancel}.
// The state change is a guarded UPDATE (status IN allowed-from), so double
// clicks and concurrent tabs can't race. Pause/cancel take effect in the edge
// engine within a few sends (it re-reads status between sends); resume
// re-drives the engine immediately (it re-checks quiet hours, budget, holds).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordAudit } from "@/lib/audit";
import { planTransition, type CampaignAction } from "@/lib/wa-campaigns";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function campaignAction(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
  action: CampaignAction,
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const { data: c, error } = await supabaseAdmin
    .from("wa_campaigns")
    .select("id,name,status,started_at,scheduled_at,repeat_rule")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!c) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  const plan = planTransition(action, c);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });

  const { data: updated, error: upErr } = await supabaseAdmin
    .from("wa_campaigns")
    .update(plan.patch)
    .eq("id", id)
    .in("status", plan.from)
    .select("*")
    .maybeSingle();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  if (!updated) {
    return NextResponse.json({ error: "The campaign changed state meanwhile. Refresh and try again." }, { status: 409 });
  }

  await recordAudit({
    action: `wa_campaign.${action}`,
    entityType: "wa_campaign",
    entityId: id,
    summary: `${action} WhatsApp campaign "${c.name}"`,
    request: req,
  }).catch(() => {});

  let engine: unknown = null;
  if (plan.kick) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-campaign-send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: id, _continue: true }),
      });
      engine = await res.json().catch(() => ({ status: res.status }));
    } catch (e) {
      // The pg_cron worker re-drives any 'sending' campaign within minutes.
      engine = { error: e instanceof Error ? e.message : String(e), note: "worker will pick it up" };
    }
  }
  return NextResponse.json({ campaign: updated, engine });
}
