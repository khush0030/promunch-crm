import { NextRequest, NextResponse } from "next/server";
import { campaignAction } from "@/lib/wa-campaign-action-route";
import { cancelDescendants } from "@/lib/wa-campaign-journeys";

export const maxDuration = 300;

// POST /api/whatsapp/campaigns/[id]/cancel  ->  { campaign, engine, followups_cancelled }
// Cancelling a campaign cancels every unfinished follow-up below it too
// (the engine also cancels a follow-up whose parent is cancelled, as a backstop).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await campaignAction(req, { params: Promise.resolve({ id }) }, "cancel");
  if (!res.ok) return res;
  let followups_cancelled = 0;
  try {
    followups_cancelled = await cancelDescendants(id);
  } catch (e) {
    console.error("wa_campaign_followup_cancel_failed", { id, error: e instanceof Error ? e.message : String(e) });
  }
  const body = await res.json().catch(() => ({}));
  return NextResponse.json({ ...body, followups_cancelled });
}
