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

// The pg_cron job for this route calls it with net.http_POST, but only GET was
// exported — so every firing since it was scheduled came back 405 Method Not
// Allowed (24 of them in the last 2 days alone, visible in net._http_response).
// Scheduled/recurring campaigns were never actually being fired by this tick.
// Accept both verbs rather than rewrite the cron command, so an existing GET
// caller (Vercel's own cron) keeps working too.
export async function POST(req: NextRequest) {
  return GET(req);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 401 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabaseAdmin
    .from("wa_campaigns")
    .select("id, name, scheduled_at, repeat_rule, repeat_until, template_id, template_vars, audience_filter, created_by")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const fired: { id: string; name: string; ok: boolean; note?: string }[] = [];
  for (const c of due ?? []) {
    // Recurring campaign: spawn a one-time CHILD for this occurrence and advance
    // the parent to the next slot. The parent itself never sends.
    if (c.repeat_rule) {
      const next = nextOccurrence(c.scheduled_at, c.repeat_rule);
      const stop = c.repeat_until != null && next.getTime() > new Date(c.repeat_until).getTime();
      // Atomic claim: advance scheduled_at guarded on its current value so two
      // overlapping ticks can't both spawn this occurrence.
      const { data: advanced } = await supabaseAdmin
        .from("wa_campaigns")
        .update(stop
          ? { status: "completed", completed_at: nowIso }
          : { scheduled_at: next.toISOString() })
        .eq("id", c.id)
        .eq("status", "scheduled")
        .eq("scheduled_at", c.scheduled_at)
        .select("id")
        .maybeSingle();
      if (!advanced) continue; // another tick won the claim

      const occLabel = new Date(c.scheduled_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      const { data: child, error: childErr } = await supabaseAdmin
        .from("wa_campaigns")
        .insert({
          name: `${c.name} · ${occLabel}`,
          template_id: c.template_id,
          template_vars: c.template_vars ?? {},
          audience_filter: c.audience_filter ?? {},
          status: "sending",
          started_at: nowIso,
          parent_campaign_id: c.id,
          created_by: c.created_by ?? null,
        })
        .select("id")
        .single();
      if (childErr || !child) {
        fired.push({ id: c.id, name: c.name, ok: false, note: `spawn failed: ${childErr?.message ?? "?"}` });
        continue;
      }
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-campaign-send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ campaign_id: child.id, _continue: true }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) {
          await supabaseAdmin.from("wa_campaigns")
            .update({ status: "failed", last_error: String(j.error ?? `send HTTP ${res.status}`) })
            .eq("id", child.id);
          fired.push({ id: child.id, name: `${c.name} (occurrence)`, ok: false, note: String(j.error ?? res.status) });
        } else {
          fired.push({ id: child.id, name: `${c.name} (occurrence)`, ok: true, note: `${j.sent ?? 0} sent${stop ? " · series ended" : " · next " + next.toISOString().slice(0, 10)}` });
        }
      } catch (e) {
        await supabaseAdmin.from("wa_campaigns")
          .update({ status: "failed", last_error: e instanceof Error ? e.message : String(e) })
          .eq("id", child.id);
        fired.push({ id: child.id, name: `${c.name} (occurrence)`, ok: false, note: e instanceof Error ? e.message : String(e) });
      }
      continue;
    }

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

// Next occurrence from a given time for a repeat rule. Monthly clamps to the
// last day of shorter months (e.g. Jan 31 -> Feb 28).
function nextOccurrence(fromIso: string, rule: string): Date {
  const d = new Date(fromIso);
  if (rule === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (rule === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (rule === "monthly") {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d;
}
