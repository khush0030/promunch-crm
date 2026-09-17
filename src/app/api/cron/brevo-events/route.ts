import { NextRequest, NextResponse } from "next/server";
import { runBrevoEvents } from "@/lib/brevo-events";

// Order events -> Brevo, every 10 min via pg_cron (Vercel Hobby can't run
// sub-daily crons). Does nothing until brevo_settings.events_enabled is on.
// CRON_SECRET bearer, fails closed.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 401 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const r = await runBrevoEvents();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("[cron/brevo-events]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "events failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
