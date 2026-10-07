import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { stagePatch } from "@/lib/influencers/health";
import { DEFAULT_SETTINGS } from "@/lib/influencers/db";
import { decidePortalTransition, normaliseInstagramPostUrl } from "@/lib/influencers/portal-rules";
import { isSameOrigin, portalDealOr404, logPortalEvent, readSmallJson, viewResponse } from "@/lib/influencers/portal-server";

export const dynamic = "force-dynamic";

// POST /api/public/collab/[code]/post  { post_url }  (instagram.com post/reel link)
// draft_approved → posted; stamps posted_at + post_url. Repeats are idempotent.
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isSameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const got = await portalDealOr404(code);
  if (!got.ok) return got.response;
  const deal = got.deal;

  const body = await readSmallJson(req);
  if (!body) return NextResponse.json({ error: "Could not read that. Please try again." }, { status: 400 });

  const decision = decidePortalTransition("post", deal.stage);
  if (decision.kind === "reject") return NextResponse.json({ error: decision.error }, { status: 409 });
  if (decision.kind === "noop") return viewResponse(code);

  const postUrl = normaliseInstagramPostUrl(body.post_url);
  if (!postUrl) {
    return NextResponse.json(
      { error: "Paste the Instagram link to your post, like https://www.instagram.com/reel/..." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const { data: won, error } = await supabaseAdmin
    .from("influencer_deals")
    .update({
      ...stagePatch(deal, decision.to, Date.parse(now), {
        postAfterApprovalDays: DEFAULT_SETTINGS.default_post_after_approval_days,
      }),
      stage: decision.to,
      post_url: postUrl,
      updated_at: now,
    })
    .eq("id", deal.id)
    .eq("stage", deal.stage)
    .select("id");
  if (error) return NextResponse.json({ error: "Could not save. Please try again." }, { status: 500 });
  if (!won?.length) return viewResponse(code);

  await logPortalEvent(deal, "posted", "Creator submitted the live post link", {
    post_url: postUrl,
    from: deal.stage,
    to: decision.to,
  });
  return viewResponse(code);
}
