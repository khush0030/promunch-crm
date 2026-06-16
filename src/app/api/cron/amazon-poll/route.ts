import { NextRequest, NextResponse } from "next/server";

// Vercel cron → triggers the Supabase amazon-poll edge function (orders +
// inventory + finances). The edge function holds the SP-API secrets and does the
// real work; this route just kicks it on schedule. Settlements have their own
// daily route (heavier report download), see /api/cron/amazon-settlements.
//
// Env on Vercel: NEXT_PUBLIC_SUPABASE_URL (+ optional CRON_SECRET to lock it).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return NextResponse.json({ ok: false, error: "no supabase url" }, { status: 500 });

  try {
    const r = await fetch(`${base}/functions/v1/amazon-poll`, { method: "GET" });
    const body = await r.json().catch(() => ({}));
    return NextResponse.json({ ok: r.ok, status: r.status, result: body }, { status: r.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "fetch failed" }, { status: 502 });
  }
}
