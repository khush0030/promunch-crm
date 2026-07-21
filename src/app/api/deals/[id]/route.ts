import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/leads/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ALL_KINDS, ALL_STAGES } from "@/components/deals/constants";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const [{ data: deal, error }, { data: emails }] = await Promise.all([
    supabaseAdmin.from("deals").select("*").eq("id", id).maybeSingle(),
    supabaseAdmin
      .from("deal_emails")
      .select("id, deal_id, gmail_message_id, gmail_thread_id, direction, from_email, to_email, subject, snippet, sent_at")
      .eq("deal_id", id)
      .order("sent_at", { ascending: true })
      .limit(200),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deal, emails: emails ?? [] });
}

// Manual edits from the drawer. A hand-set stage flips manual_stage_override
// so the scanner never fights the human.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.company_name === "string" && body.company_name.trim()) {
    patch.company_name = body.company_name.trim().slice(0, 200);
  }
  if (typeof body.kind === "string" && (ALL_KINDS as string[]).includes(body.kind)) {
    patch.kind = body.kind;
    patch.manual_kind_override = true;
  }
  if (typeof body.stage === "string" && (ALL_STAGES as string[]).includes(body.stage)) {
    patch.stage = body.stage;
    patch.stage_updated_at = new Date().toISOString();
    patch.manual_stage_override = true;
    if (body.stage === "samples_sent") patch.samples_sent_at = new Date().toISOString();
  }
  if (typeof body.next_step === "string") patch.next_step = body.next_step.slice(0, 500) || null;
  if (body.next_step_owner === "us" || body.next_step_owner === "them" || body.next_step_owner === null) {
    patch.next_step_owner = body.next_step_owner;
  }
  if (typeof body.follow_up_needed === "boolean") {
    patch.follow_up_needed = body.follow_up_needed;
    if (!body.follow_up_needed) patch.follow_up_reason = null;
  }
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 4000) || null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no editable fields in body" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("deals")
    .update(patch)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deal: data });
}
