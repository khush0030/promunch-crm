import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { enrollEmailFlow } from "@/lib/email/enroll";
import { fetchSuppressed } from "@/lib/email-studio/audience-server";
import { runSegmentTriggers } from "@/lib/email/segment-triggers";

// Daily segment / date triggers for email flows (win-back, VIP, sunset,
// first-order anniversary). Scheduled via Supabase pg_cron at 04:30 UTC
// (10:00 IST) by migration 20260930140000_email_segment_tick_cron.sql, which
// POSTs here with the CRON_SECRET bearer; fails closed if the secret is unset.
//
// Never sends: it only writes flow_enrollments (idempotent on
// (flow_id, dedup_key)); email-flow-tick sends with its own atomic claim.
// ?dry=1 returns per-flow counts without enrolling anyone.
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
  const dryParam = req.nextUrl.searchParams.get("dry");
  const dry = dryParam === "1" || dryParam === "true";
  try {
    const summary = await runSegmentTriggers(
      { db: supabaseAdmin, enroll: enrollEmailFlow, fetchSuppressed },
      { dry },
    );
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error("email_segment_tick_failed", { message: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
