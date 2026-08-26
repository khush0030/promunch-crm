import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/whatsapp/engagement/refresh
// Re-derives the tier:* tag on every wa_contacts row from the live
// wa_contact_engagement view. Idempotent, returns the number of rows whose tier
// actually changed. Runs nightly from /api/cron/wa-engagement-tiers; this route
// is the "refresh now" button in the dashboard.
export async function POST() {
  const { data, error } = await supabaseAdmin.rpc("recompute_wa_engagement_tags");
  if (error) {
    const missing = error.code === "42883" || error.code === "PGRST202";
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        needsMigration: missing,
        hint: missing
          ? "Apply supabase/migrations/014_wa_engagement_tiers_and_consent.sql in the Supabase SQL editor."
          : undefined,
      },
      { status: missing ? 503 : 500 },
    );
  }
  return NextResponse.json({ ok: true, changed: Number(data ?? 0) });
}
