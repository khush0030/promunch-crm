import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseDealPatch } from "@/lib/deals/patch";
import { addActivity, getDeal, listActivity, updateDeal } from "@/lib/deals/repo";
import { dealActor, UUID_RE } from "@/lib/deals/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// One deal: the row, its emails, its activity log (newest first).
export async function GET(_req: NextRequest, ctx: Ctx) {
  const who = await dealActor();
  if ("denied" in who) return who.denied;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  try {
    const [deal, { data: emails }, activity] = await Promise.all([
      getDeal(id),
      supabaseAdmin
        .from("deal_emails")
        .select("id, deal_id, gmail_message_id, gmail_thread_id, direction, from_email, to_email, subject, snippet, sent_at")
        .eq("deal_id", id)
        .order("sent_at", { ascending: false })
        .limit(200),
      listActivity(id),
    ]);
    if (!deal) return NextResponse.json({ error: "This deal no longer exists." }, { status: 404 });
    return NextResponse.json({ deal, emails: emails ?? [], activity: activity.rows, schema_ready: activity.ready });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

// Edits from the board and drawer. Contract in src/lib/deals/patch.ts.
// A hand-set stage pins it (manual_stage_override); stage / next step /
// follow-up edits stamp human_touched_at so the scanner leaves them alone.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const who = await dealActor();
  if ("denied" in who) return who.denied;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  try {
    const current = await getDeal(id);
    if (!current) return NextResponse.json({ error: "This deal no longer exists." }, { status: 404 });
    const parsed = parseDealPatch(body, current);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { patch, activities } = parsed.value;
    const deal = Object.keys(patch).length ? await updateDeal(id, patch, current.notes) : current;
    if (!deal) return NextResponse.json({ error: "This deal no longer exists." }, { status: 404 });
    if (activities.length) {
      await addActivity(id, activities, who.actor.email).catch((e) => console.error("[deals] activity failed", e));
    }
    return NextResponse.json({ deal });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "save failed" }, { status: 500 });
  }
}

// Delete a deal (the UI asks to confirm first). Its activity goes with it;
// its emails stay in the scan ledger, unlinked, so a rescan does not
// recreate the deal from the same messages.
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const who = await dealActor();
  if ("denied" in who) return who.denied;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  // deal_emails.deal_id cascades on delete; detach first so the ledger rows
  // (the scanner's idempotency set) survive.
  const { error: detachErr } = await supabaseAdmin.from("deal_emails").update({ deal_id: null }).eq("deal_id", id);
  if (detachErr) return NextResponse.json({ error: detachErr.message }, { status: 500 });
  const { error } = await supabaseAdmin.from("deals").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
