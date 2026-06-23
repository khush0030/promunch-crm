import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Fires scheduled WhatsApp campaigns at their time. Runs on Vercel cron
// (independent of Supabase pg_cron). For each campaign that is 'scheduled' and
// whose scheduled_at has passed, it atomically claims the row (status →
// 'sending') and kicks wa-campaign-send. The claim is a guarded UPDATE so two
// overlapping ticks can't both fire the same campaign; the real
// duplicate-message guard is wa-campaign-send's per-recipient ledger
// (wa_messages.campaign_id), so a recipient is never messaged twice even if a
// send is invoked more than once.
//
// Auth: /api/cron/* is allowlisted in middleware and self-authenticates with
// CRON_SECRET (Vercel sends it as a Bearer token). Fail-closed if unset.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 401 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabaseAdmin
    .from("wa_campaigns")
    .select("id, name")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const fired: { id: string; name: string; ok: boolean; note?: string }[] = [];
  for (const c of due ?? []) {
    // Atomic claim: only the tick that flips 'scheduled' → 'sending' proceeds.
    const { data: claimed } = await supabaseAdmin
      .from("wa_campaigns")
      .update({ status: "sending", started_at: nowIso, last_error: null })
      .eq("id", c.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      // _continue:true so the send doesn't reject our pre-set 'sending' status.
      const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-campaign-send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: c.id, _continue: true }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        // Roll back to 'scheduled' so a transient failure (e.g. template not yet
        // approved) retries on the next tick rather than getting stuck 'sending'.
        await supabaseAdmin
          .from("wa_campaigns")
          .update({ status: "scheduled", last_error: String(j.error ?? `send HTTP ${res.status}`) })
          .eq("id", c.id);
        fired.push({ id: c.id, name: c.name, ok: false, note: String(j.error ?? res.status) });
      } else {
        fired.push({ id: c.id, name: c.name, ok: true, note: `${j.sent ?? 0} sent, ${j.remaining ?? 0} remaining` });
      }
    } catch (e) {
      await supabaseAdmin
        .from("wa_campaigns")
        .update({ status: "scheduled", last_error: e instanceof Error ? e.message : String(e) })
        .eq("id", c.id);
      fired.push({ id: c.id, name: c.name, ok: false, note: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, checked: (due ?? []).length, fired });
}
