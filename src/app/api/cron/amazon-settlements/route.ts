import { NextRequest, NextResponse } from "next/server";

// Vercel cron → triggers the Supabase amazon-poll edge function in settlements
// mode. Settlement reports arrive ~fortnightly; a daily run catches each new one
// (one report per invocation) and reconciles it against the bank deposit,
// alerting #amazon-finance on any variance.
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
    const r = await fetch(`${base}/functions/v1/amazon-poll?only=settlements`, { method: "GET" });
    const body = await r.json().catch(() => ({}));
    return NextResponse.json({ ok: r.ok, status: r.status, result: body }, { status: r.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "fetch failed" }, { status: 502 });
  }
}
