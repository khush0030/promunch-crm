import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DRAFT_BUCKET, draftStoragePath, validateUpload } from "@/lib/influencers/portal-rules";
import { isSameOrigin, portalDealOr404, readSmallJson } from "@/lib/influencers/portal-server";

export const dynamic = "force-dynamic";

// POST /api/public/collab/[code]/upload-url  { filename, size, contentType }
// → { path, token, signedUrl } for a direct browser upload to the PRIVATE
// bucket 'influencer-drafts' at <deal_id>/<timestamp>-<safe name>. Video only,
// ≤ 200 MB, and only while the creator is due to submit a draft. The bytes
// never pass through Vercel. Submitting the draft is a separate call (/draft).
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isSameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const got = await portalDealOr404(code);
  if (!got.ok) return got.response;
  const deal = got.deal;

  if (deal.stage !== "delivered" && deal.stage !== "changes_requested") {
    return NextResponse.json({ error: "Uploads open once your box has arrived and a draft is due." }, { status: 409 });
  }

  const body = await readSmallJson(req);
  if (!body) return NextResponse.json({ error: "Could not read the upload request." }, { status: 400 });
  const v = validateUpload(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const path = draftStoragePath(deal.id, v.filename);
  const { data, error } = await supabaseAdmin.storage.from(DRAFT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.warn("influencer upload-url failed:", error?.message);
    return NextResponse.json({ error: "Could not prepare the upload. Please paste a link instead." }, { status: 500 });
  }
  return NextResponse.json(
    { ok: true, path: data.path, token: data.token, signedUrl: data.signedUrl },
    { headers: { "Cache-Control": "no-store" } },
  );
}
