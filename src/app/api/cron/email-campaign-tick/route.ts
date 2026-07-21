import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendCampaign } from "@/lib/email/campaign-send";

// Drains scheduled email campaigns. Scheduled via Supabase pg_cron (every 15
// min) because Vercel Hobby can't run sub-daily crons — pg_cron POSTs here with
// the CRON_SECRET bearer. Fails closed if the secret is unset.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 401 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { data: due, error } = await supabase
    .from("campaigns")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(25);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<{ id: string; ok: boolean; sent?: number; error?: string }> = [];
  for (const c of due ?? []) {
    // sendCampaign takes the atomic scheduled → sending claim, so overlapping
    // ticks cannot double-send the same campaign.
    const r = await sendCampaign(c.id);
    results.push({ id: c.id, ok: r.ok, sent: r.total_sent, error: r.ok ? undefined : r.error });
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// GET support lets a Vercel daily cron or a manual curl drive it too.
export async function GET(req: NextRequest) {
  return handle(req);
}
