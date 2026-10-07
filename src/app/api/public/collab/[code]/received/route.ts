import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { stagePatch } from "@/lib/influencers/health";
import { DEFAULT_SETTINGS } from "@/lib/influencers/db";
import { decidePortalTransition } from "@/lib/influencers/portal-rules";
import { isSameOrigin, portalDealOr404, logPortalEvent, viewResponse } from "@/lib/influencers/portal-server";

export const dynamic = "force-dynamic";

// POST /api/public/collab/[code]/received — "My box arrived".
// brief_acknowledged | dispatched → delivered; stamps delivered_at and
// draft_due_at = delivered_at + draft_due_days. Repeats are idempotent.
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isSameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const got = await portalDealOr404(code);
  if (!got.ok) return got.response;
  const deal = got.deal;

  const decision = decidePortalTransition("received", deal.stage);
  if (decision.kind === "reject") return NextResponse.json({ error: decision.error }, { status: 409 });
  if (decision.kind === "noop") return viewResponse(code);

  // stagePatch: delivered_at (kept if already set) + draft_due_at = delivered_at + draft_due_days
  const now = Date.now();
  const patch = stagePatch({ ...deal, delivered_at: null }, decision.to, now, {
    postAfterApprovalDays: DEFAULT_SETTINGS.default_post_after_approval_days,
  });
  const dueAt = patch.draft_due_at;
  const { data: won, error } = await supabaseAdmin
    .from("influencer_deals")
    .update({ ...patch, stage: decision.to, updated_at: new Date(now).toISOString() })
    .eq("id", deal.id)
    .eq("stage", deal.stage) // compare-and-set: a double tap moves it once
    .select("id");
  if (error) return NextResponse.json({ error: "Could not save. Please try again." }, { status: 500 });
  if (!won?.length) return viewResponse(code);

  await logPortalEvent(deal, "delivered", "Creator confirmed the box arrived", {
    from: deal.stage,
    to: decision.to,
    draft_due_at: dueAt,
  });
  return viewResponse(code);
}
