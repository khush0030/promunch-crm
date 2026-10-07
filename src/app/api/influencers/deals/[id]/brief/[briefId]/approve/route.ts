import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, logEvent, requireUser } from "@/lib/influencers/db";
import { UUID_RE } from "@/lib/influencers/normalize";

export const dynamic = "force-dynamic";

// POST /api/influencers/deals/[id]/brief/[briefId]/approve — draft → approved.
// Approving an already-approved brief is a 200 no-op.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; briefId: string }> }) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id, briefId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(briefId)) return jsonError("brief not found", 404);

  const { data: brief } = await supabaseAdmin
    .from("influencer_briefs")
    .select("*")
    .eq("id", briefId)
    .eq("deal_id", id)
    .maybeSingle();
  if (!brief) return jsonError("brief not found", 404);
  if (brief.status === "approved") return NextResponse.json({ ok: true, brief });
  if (brief.status !== "draft") {
    return jsonError(`brief v${brief.version} is ${brief.status}; only drafts can be approved`, 409);
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabaseAdmin
    .from("influencer_briefs")
    .update({ status: "approved", approved_by: gate.actor, approved_at: now })
    .eq("id", briefId)
    .eq("status", "draft")
    .select("*")
    .maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!updated) return jsonError("brief changed while approving, refresh and retry", 409);

  const { data: deal } = await supabaseAdmin.from("influencer_deals").select("influencer_id").eq("id", id).maybeSingle();
  if (deal) {
    await logEvent(deal.influencer_id, id, "brief_approved", "dashboard", gate.actor, `Brief v${brief.version} approved`, {
      version: brief.version,
    });
  }
  return NextResponse.json({ ok: true, brief: updated });
}
