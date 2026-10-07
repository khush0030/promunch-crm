import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { stagePatch } from "@/lib/influencers/health";
import { DEFAULT_SETTINGS } from "@/lib/influencers/db";
import { decidePortalTransition, isBefore } from "@/lib/influencers/portal-rules";
import { isSameOrigin, latestSentBrief, portalDealOr404, logPortalEvent, viewResponse } from "@/lib/influencers/portal-server";

export const dynamic = "force-dynamic";

// POST /api/public/collab/[code]/ack — "I've read the brief and I'm in".
// brief_sent → brief_acknowledged. If the team re-sent a newer brief version
// after the creator already moved on (stage later than brief_sent), acking it
// just stamps the brief + deal without moving the stage back or forward.
// Repeats are idempotent: 200 with the current view, no duplicate rows.
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isSameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const got = await portalDealOr404(code);
  if (!got.ok) return got.response;
  const deal = got.deal;

  const brief = await latestSentBrief(deal.id);
  if (!brief) {
    if (isBefore(deal.stage, "brief_sent")) {
      return NextResponse.json({ error: "Your brief is not ready yet. We will WhatsApp you as soon as it is." }, { status: 409 });
    }
    return viewResponse(code);
  }
  if (brief.acknowledged_at) return viewResponse(code);

  const decision = decidePortalTransition("ack", deal.stage);
  if (decision.kind === "reject") return NextResponse.json({ error: decision.error }, { status: 409 });

  const now = new Date().toISOString();
  // Claim the brief ack first (compare-and-set on acknowledged_at is null) so a
  // double tap writes exactly one event.
  const { data: won } = await supabaseAdmin
    .from("influencer_briefs")
    .update({ acknowledged_at: now })
    .eq("id", brief.id)
    .is("acknowledged_at", null)
    .select("id");
  if (!won?.length) return viewResponse(code);

  // The deal-level ack tracks the latest sent brief (send clears it), so stamp it fresh.
  const dealPatch: Record<string, unknown> = {
    ...(decision.kind === "apply"
      ? stagePatch({ ...deal, brief_acknowledged_at: null }, decision.to, Date.parse(now), {
          postAfterApprovalDays: DEFAULT_SETTINGS.default_post_after_approval_days,
        })
      : {}),
    brief_acknowledged_at: now,
    updated_at: now,
  };
  if (decision.kind === "apply") dealPatch.stage = decision.to;
  let q = supabaseAdmin.from("influencer_deals").update(dealPatch).eq("id", deal.id);
  if (decision.kind === "apply") q = q.eq("stage", deal.stage);
  const { error } = await q;
  if (error) return NextResponse.json({ error: "Could not save. Please try again." }, { status: 500 });

  await logPortalEvent(deal, "brief_ack", `Creator acknowledged brief v${brief.version}`, {
    brief_version: brief.version,
    ...(decision.kind === "apply" ? { from: deal.stage, to: decision.to } : {}),
  });
  return viewResponse(code);
}
