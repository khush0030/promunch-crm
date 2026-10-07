import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSettings, jsonError, requireUser } from "@/lib/influencers/db";
import { OPEN_STAGES, boardSummary, type SummaryDeal } from "@/lib/influencers/health";

export const dynamic = "force-dynamic";

// Board strip counts (BoardSummary).
export async function GET() {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const [settings, deals, briefs, drafts] = await Promise.all([
    getSettings(),
    supabaseAdmin
      .from("influencer_deals")
      .select(
        "id, stage, agreed_at, brief_sent_at, brief_acknowledged_at, dispatched_at, delivered_at, draft_due_at, draft_submitted_at, go_live_at, shopify_order_id",
      )
      .in("stage", OPEN_STAGES)
      .limit(2000),
    supabaseAdmin.from("influencer_briefs").select("deal_id").eq("status", "draft").limit(2000),
    supabaseAdmin.from("influencer_drafts").select("deal_id").eq("review_status", "pending").limit(2000),
  ]);
  const err = deals.error ?? briefs.error ?? drafts.error;
  if (err) return jsonError(err.message, 500);
  const summary = boardSummary(
    (deals.data ?? []) as SummaryDeal[],
    {
      briefDealIds: (briefs.data ?? []).map((b) => b.deal_id as string),
      pendingDraftDealIds: (drafts.data ?? []).map((d) => d.deal_id as string),
    },
    Date.now(),
    settings,
  );
  return NextResponse.json({ summary });
}
