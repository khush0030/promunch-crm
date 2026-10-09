import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { addActivity, getDeal, updateDeal } from "@/lib/deals/repo";
import { dealActor, UUID_RE } from "@/lib/deals/session";

export const dynamic = "force-dynamic";

// POST /api/deals/[id]/merge {into: <deal id>}
// Folds this deal into another one: its emails, activity and bulk-form
// links move across, blank contact fields on the target are filled, value
// is kept if the target has none, then this deal is deleted. Sends nothing.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const who = await dealActor();
  if ("denied" in who) return who.denied;
  const { id } = await ctx.params;
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const into = typeof b.into === "string" ? b.into : "";
  if (!UUID_RE.test(id) || !UUID_RE.test(into)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (id === into) return NextResponse.json({ error: "Pick a different deal to merge into." }, { status: 400 });

  try {
    const [from, to] = await Promise.all([getDeal(id), getDeal(into)]);
    if (!from || !to) return NextResponse.json({ error: "One of these deals no longer exists." }, { status: 404 });

    const moves = await Promise.all([
      supabaseAdmin.from("deal_emails").update({ deal_id: into }).eq("deal_id", id),
      supabaseAdmin.from("bulk_inquiries").update({ deal_id: into }).eq("deal_id", id),
    ]);
    const moveErr = moves.find((m) => m.error)?.error;
    if (moveErr) return NextResponse.json({ error: moveErr.message }, { status: 500 });
    // The log is append-only (no UPDATE), so entries are copied across; the
    // originals go with the source deal's cascade delete. Before the
    // migration the table does not exist and act.error is simply ignored.
    const act = await supabaseAdmin.from("deal_activity").select("kind, body, author, created_at").eq("deal_id", id);
    if (!act.error && act.data?.length) {
      await supabaseAdmin.from("deal_activity").insert(act.data.map((a) => ({ ...a, deal_id: into })));
    }

    const fill: Record<string, unknown> = {};
    if (!to.contact_name && from.contact_name) fill.contact_name = from.contact_name;
    if (!to.contact_email && from.contact_email) fill.contact_email = from.contact_email;
    if (!to.contact_phone && from.contact_phone) fill.contact_phone = from.contact_phone;
    if (to.value_inr == null && from.value_inr != null) fill.value_inr = from.value_inr;
    if (!to.next_step && from.next_step) fill.next_step = from.next_step;
    if (!to.follow_up_at && from.follow_up_at) fill.follow_up_at = from.follow_up_at;
    if (from.notes && !act.data?.length) fill.notes = [to.notes, from.notes].filter(Boolean).join("\n\n").slice(0, 8000);
    const { count } = await supabaseAdmin.from("deal_emails").select("id", { count: "exact", head: true }).eq("deal_id", into);
    fill.email_count = count ?? to.email_count;
    await updateDeal(into, fill, to.notes);

    const { error: delErr } = await supabaseAdmin.from("deals").delete().eq("id", id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    await addActivity(into, [{ kind: "system", body: `Merged in "${from.company_name}"` }], who.actor.email).catch(() => {});
    return NextResponse.json({ ok: true, into });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "merge failed" }, { status: 500 });
  }
}
