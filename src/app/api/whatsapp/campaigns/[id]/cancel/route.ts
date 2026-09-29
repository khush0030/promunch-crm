import { NextRequest } from "next/server";
import { campaignAction } from "@/lib/wa-campaign-action-route";

export const maxDuration = 300;

// POST /api/whatsapp/campaigns/[id]/cancel  ->  { campaign, engine }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return campaignAction(req, ctx, "cancel");
}
