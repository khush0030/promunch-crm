import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { parseDesign, contentHash } from "@/lib/email-studio/design";
import { parseRules } from "@/lib/email-studio/segments";
import { caller, isResponse, bad, migrationHint } from "@/lib/email-studio/route-helpers";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const EDITABLE = ["draft", "paused"];

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const { data, error } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (error) return bad(migrationHint(error.message), 500);
  if (!data) return bad("not found", 404);
  const hash = contentHash(data.subject ?? "", data.preview_text ?? "", data.design);
  return NextResponse.json({ campaign: data, testIsCurrent: !!data.test_sent_hash && data.test_sent_hash === hash });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  const { id } = await params;
  const body = await parseBody<Record<string, unknown>>(req);
  if (!body) return bad("invalid JSON body");

  const { data: cur } = await supabase.from("campaigns").select("status, approval_status").eq("id", id).maybeSingle();
  if (!cur) return bad("not found", 404);

  // Unschedule: scheduled → draft (only this transition is allowed on a scheduled one).
  if (body.unschedule === true) {
    const { data, error } = await supabase
      .from("campaigns")
      .update({ status: "draft", scheduled_at: null })
      .eq("id", id)
      .eq("status", "scheduled")
      .select("id");
    if (error) return bad(error.message, 500);
    if (!data?.length) return bad("This campaign is not scheduled.", 409);
    await recordAudit({ action: "email_campaign.unschedule", entityType: "campaign", entityId: id, actor: me.user, request: req });
    return NextResponse.json({ ok: true });
  }

  if (!EDITABLE.includes(cur.status as string)) {
    return bad(cur.status === "scheduled" ? "Unschedule the campaign before editing it." : "This campaign has already gone out.", 409);
  }

  const patch: Record<string, unknown> = {};
  let contentChanged = false;
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 120);
    if (!name) return bad("name cannot be empty");
    patch.name = name;
  }
  if (body.subject !== undefined) {
    patch.subject = String(body.subject).slice(0, 200);
    contentChanged = true;
  }
  if (body.preview_text !== undefined) {
    patch.preview_text = String(body.preview_text).slice(0, 300);
    contentChanged = true;
  }
  if (body.design !== undefined) {
    const d = parseDesign(body.design);
    if (!d) return bad("invalid design");
    patch.design = d;
    contentChanged = true;
  }
  if (body.audience_rules !== undefined) {
    patch.audience_rules = parseRules(body.audience_rules);
    patch.segment_id = null;
    contentChanged = true;
  }
  if (body.segment_id !== undefined) {
    patch.segment_id = body.segment_id || null;
    contentChanged = true;
  }
  // An approval covers exactly what the admin saw: any change needs a new one.
  if (contentChanged && cur.approval_status !== "not_needed") {
    patch.approval_status = "not_needed";
    patch.approved_by = null;
    patch.approved_at = null;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const { error } = await supabase.from("campaigns").update(patch).eq("id", id).in("status", EDITABLE);
  if (error) return bad(migrationHint(error.message), 500);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  const { id } = await params;
  const { count } = await supabase.from("campaign_emails").select("id", { count: "exact", head: true }).eq("campaign_id", id);
  if (count) return bad("This campaign already sent emails, so it is kept for reporting.", 409);
  const { data, error } = await supabase.from("campaigns").delete().eq("id", id).in("status", ["draft", "paused"]).select("id, name");
  if (error) return bad(error.message, 500);
  if (!data?.length) return bad("Only drafts can be deleted. Unschedule it first.", 409);
  await recordAudit({ action: "email_campaign.delete", entityType: "campaign", entityId: id, summary: `Deleted email campaign "${data[0].name}"`, actor: me.user, request: req });
  return NextResponse.json({ ok: true });
}
