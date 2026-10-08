import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, readJson, requireUser, UUID_RE } from "@/lib/orm/db";
import { findWaContactForCrm } from "@/lib/customer-link";
import { validateMentionPatch, withCaseOpened } from "@/lib/orm/settings-patch";
import { MENTION_COLUMNS, type OrmAlert, type OrmMention } from "@/lib/orm/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The matched customer's WhatsApp inbox thread (read-only link in the drawer's
 * Case section; nothing is sent). Best effort: any error -> null.
 */
async function waThreadFor(contactId: string | null): Promise<string | null> {
  if (!contactId) return null;
  try {
    const { data: crm } = await supabaseAdmin
      .from("contacts")
      .select("id, email, phone, shopify_customer_id")
      .eq("id", contactId)
      .maybeSingle();
    if (!crm) return null;
    const wa = await findWaContactForCrm(crm);
    if (!wa) return null;
    const { data } = await supabaseAdmin
      .from("wa_threads")
      .select("id")
      .eq("contact_id", wa.id)
      .order("last_inbound_at", { ascending: false, nullsFirst: false })
      .limit(1);
    return data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// GET /api/orm/mentions/[id] -> { mention, alerts, reply_claim, wa_thread_id }
export async function GET(_req: NextRequest, { params }: Ctx) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError("mention not found", 404);
  const [m, a] = await Promise.all([
    supabaseAdmin.from("orm_mentions").select(MENTION_COLUMNS).eq("id", id).maybeSingle(),
    supabaseAdmin
      .from("orm_alert_log")
      .select("id, mention_id, kind, status, detail, error, created_at, sent_at")
      .eq("mention_id", id)
      .order("created_at", { ascending: true }),
  ]);
  if (m.error) return jsonError(m.error.message, 500);
  if (!m.data) return jsonError("mention not found", 404);
  const mention = m.data as unknown as OrmMention;
  const [claim, wa_thread_id] = await Promise.all([
    mention.source === "judgeme"
      ? supabaseAdmin.from("orm_reply_claims").select("status, error, posted_at").eq("mention_id", id).maybeSingle()
      : Promise.resolve({ data: null }),
    waThreadFor(mention.contact_id),
  ]);
  return NextResponse.json({
    mention,
    alerts: (a.data ?? []) as OrmAlert[],
    reply_claim: claim.data ?? null,
    wa_thread_id,
  });
}

// PATCH /api/orm/mentions/[id]
//   { status?, assignee?, note?, reply_text?, reply_draft?, case_status?, case_outcome? }
// status = 'replied' stamps replied_at / replied_by. case_status = 'resolved'
// needs case_outcome and stamps case_resolved_at; reopening clears it. Posts
// nothing anywhere.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError("mention not found", 404);
  const body = await readJson(req);
  if (!body) return jsonError("bad json");
  const now = new Date().toISOString();
  const v = validateMentionPatch(body, gate.actor, now);
  if (!v.ok) return jsonError(v.error);
  let patch = v.value;
  if (typeof patch.case_status === "string") {
    const { data: cur, error: cErr } = await supabaseAdmin
      .from("orm_mentions")
      .select("case_opened_at")
      .eq("id", id)
      .maybeSingle();
    if (cErr) return jsonError(cErr.message, 500);
    if (!cur) return jsonError("mention not found", 404);
    patch = withCaseOpened(patch, cur, now);
  }
  const { data, error } = await supabaseAdmin
    .from("orm_mentions")
    .update(patch)
    .eq("id", id)
    .select(MENTION_COLUMNS)
    .maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError("mention not found", 404);
  return NextResponse.json({ mention: data as unknown as OrmMention });
}
