import { NextRequest, NextResponse } from "next/server";
import { runBrevoSync } from "@/lib/brevo-sync";

// Daily CRM -> Brevo contact sync (vercel.json). Syncs to whatever target the
// owner has set in brevo_settings: in test mode that is only the test
// addresses. CRON_SECRET bearer, fails closed.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 401 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const r = await runBrevoSync();
    return NextResponse.json({ ok: true, target: r.target, synced: r.eligible, blocklisted: r.blocklisted, skipped: r.skipped, processIds: r.processIds });
  } catch (e) {
    console.error("[cron/brevo-sync]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "sync failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
