import { NextResponse } from "next/server";
import { buildPortalView, portalDealOr404 } from "@/lib/influencers/portal-server";

export const dynamic = "force-dynamic";

// GET /api/public/collab/[code] → PortalView for the creator portal.
// Public (middleware allowlists /api/public/*); the unguessable deal code is the
// credential. Never returns address, phone, email, notes or other deals.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const got = await portalDealOr404(code);
  if (!got.ok) return got.response;
  try {
    const view = await buildPortalView(got.deal);
    return NextResponse.json({ ok: true, view }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
