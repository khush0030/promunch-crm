import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Vercel cron (daily) → re-derives the tier:* tag on every wa_contacts row.
//
// Engagement tiers move slowly (a contact changes tier when they reply to us,
// opt out, or cross the 90-day line), so daily is the right cadence and fits
// inside the Hobby plan's daily-only cron limit. The campaign builder also
// exposes a "Refresh now" button via /api/whatsapp/engagement/refresh.
//
// Env on Vercel: CRON_SECRET (Vercel sends it as a Bearer token).
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 401 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin.rpc("recompute_wa_engagement_tags");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, changed: Number(data ?? 0) });
}
