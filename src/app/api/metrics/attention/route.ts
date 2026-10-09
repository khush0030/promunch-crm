import { NextResponse } from "next/server";
import { loadAttention } from "@/lib/metrics/attention-load";

// The "needs attention" feed: powers the Needs Attention page, the Home
// attention panel, and the sidebar/tab-bar badge counts. READ-ONLY — this
// route only SELECTs (via loadAttention). It must never send a WhatsApp/email
// message or call an edge function, no matter what the underlying tables say.
//
// GET /api/metrics/attention[?fresh=1]
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const { body, hit } = await loadAttention({ fresh });
  return NextResponse.json(body, { headers: { "x-cache": hit ? "hit" : "miss" } });
}
