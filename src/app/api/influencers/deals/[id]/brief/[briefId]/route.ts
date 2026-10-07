import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, logEvent, readJson, requireUser } from "@/lib/influencers/db";
import { UUID_RE } from "@/lib/influencers/normalize";
import { validateBriefContent } from "@/lib/influencers/brief-content";

export const dynamic = "force-dynamic";

// PATCH /api/influencers/deals/[id]/brief/[briefId]  { content: BriefContent }
// Edit a brief while it is still a draft. Content is validated + brand-cleaned
// (no em dashes, PROMUNCH caps) by validateBriefContent.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; briefId: string }> }) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id, briefId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(briefId)) return jsonError("brief not found", 404);

  const body = await readJson(req);
  const v = validateBriefContent(body?.content);
  if (!v.ok) return jsonError(v.error, 400);

  const { data: brief } = await supabaseAdmin
    .from("influencer_briefs")
    .select("id, deal_id, version, status")
    .eq("id", briefId)
    .eq("deal_id", id)
    .maybeSingle();
  if (!brief) return jsonError("brief not found", 404);
  if (brief.status !== "draft") {
    return jsonError(`brief v${brief.version} is ${brief.status}; only drafts can be edited`, 409);
  }

  const { data: updated, error } = await supabaseAdmin
    .from("influencer_briefs")
    .update({ content: v.value, generated_by: gate.actor })
    .eq("id", briefId)
    .eq("status", "draft")
    .select("*")
    .maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!updated) return jsonError("brief is no longer a draft", 409);

  const { data: deal } = await supabaseAdmin.from("influencer_deals").select("influencer_id").eq("id", id).maybeSingle();
  if (deal) {
    await logEvent(deal.influencer_id, id, "brief_edited", "dashboard", gate.actor, `Brief v${brief.version} edited`, {
      version: brief.version,
    });
  }
  return NextResponse.json({ ok: true, brief: updated });
}
