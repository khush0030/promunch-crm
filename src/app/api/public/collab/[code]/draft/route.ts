import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { stagePatch } from "@/lib/influencers/health";
import { DEFAULT_SETTINGS } from "@/lib/influencers/db";
import { cleanNote, decidePortalTransition, isOwnStoragePath, normaliseHttpUrl } from "@/lib/influencers/portal-rules";
import { isSameOrigin, portalDealOr404, logPortalEvent, readSmallJson, viewResponse } from "@/lib/influencers/portal-server";

export const dynamic = "force-dynamic";

// POST /api/public/collab/[code]/draft  { url? | storage_path?, note? }
// delivered | changes_requested → draft_submitted, inserting influencer_drafts
// version max+1. The stage compare-and-set runs first so a double submit makes
// exactly one draft row; a repeat at a later stage is a 200 no-op.
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isSameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const got = await portalDealOr404(code);
  if (!got.ok) return got.response;
  const deal = got.deal;

  const body = await readSmallJson(req);
  if (!body) return NextResponse.json({ error: "Could not read that. Please try again." }, { status: 400 });

  const decision = decidePortalTransition("draft", deal.stage);
  if (decision.kind === "reject") return NextResponse.json({ error: decision.error }, { status: 409 });
  if (decision.kind === "noop") return viewResponse(code);

  const hasUrl = body.url !== undefined && body.url !== null && body.url !== "";
  const hasPath = body.storage_path !== undefined && body.storage_path !== null && body.storage_path !== "";
  if (hasUrl === hasPath) {
    return NextResponse.json({ error: "Paste a link to your draft or upload the video." }, { status: 400 });
  }
  let url: string | null = null;
  let storagePath: string | null = null;
  if (hasUrl) {
    url = normaliseHttpUrl(body.url);
    if (!url)
      return NextResponse.json({ error: "That link does not look right. Paste the full link to your draft." }, { status: 400 });
  } else {
    if (!isOwnStoragePath(deal.id, body.storage_path)) {
      return NextResponse.json({ error: "That upload could not be found. Please upload again." }, { status: 400 });
    }
    storagePath = body.storage_path;
  }
  const note = cleanNote(body.note, 1000);

  const now = new Date().toISOString();
  const { data: won, error: stageErr } = await supabaseAdmin
    .from("influencer_deals")
    // stagePatch keeps the FIRST draft_submitted_at (reliability measures v1 vs due date)
    .update({
      ...stagePatch(deal, decision.to, Date.parse(now), {
        postAfterApprovalDays: DEFAULT_SETTINGS.default_post_after_approval_days,
      }),
      stage: decision.to,
      updated_at: now,
    })
    .eq("id", deal.id)
    .eq("stage", deal.stage)
    .select("id");
  if (stageErr) return NextResponse.json({ error: "Could not save. Please try again." }, { status: 500 });
  if (!won?.length) return viewResponse(code);

  const { data: last } = await supabaseAdmin
    .from("influencer_drafts")
    .select("version")
    .eq("deal_id", deal.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = ((last?.version as number | undefined) ?? 0) + 1;
  const { error: insErr } = await supabaseAdmin.from("influencer_drafts").insert({
    deal_id: deal.id,
    version,
    url,
    storage_path: storagePath,
    note,
    review_status: "pending",
    submitted_at: now,
  });
  if (insErr) {
    // put the stage back so the creator can retry
    await supabaseAdmin
      .from("influencer_deals")
      .update({ stage: deal.stage, updated_at: new Date().toISOString() })
      .eq("id", deal.id)
      .eq("stage", decision.to);
    return NextResponse.json({ error: "Could not save your draft. Please try again." }, { status: 500 });
  }

  await logPortalEvent(deal, "draft_submitted", `Creator submitted draft v${version}`, {
    version,
    kind: url ? "link" : "upload",
    from: deal.stage,
    to: decision.to,
  });
  return viewResponse(code);
}
