import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, readJson, requireUser, UUID_RE } from "@/lib/orm/db";
import { validateMentionPatch } from "@/lib/orm/settings-patch";
import { MENTION_COLUMNS, type OrmAlert, type OrmMention } from "@/lib/orm/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/orm/mentions/[id] -> { mention, alerts }
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
  return NextResponse.json({
    mention: m.data as unknown as OrmMention,
    alerts: (a.data ?? []) as OrmAlert[],
  });
}

// PATCH /api/orm/mentions/[id]  { status?, assignee?, note?, reply_text?, reply_draft? }
// status = 'replied' stamps replied_at / replied_by. Posts nothing anywhere (v1).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError("mention not found", 404);
  const body = await readJson(req);
  if (!body) return jsonError("bad json");
  const v = validateMentionPatch(body, gate.actor, new Date().toISOString());
  if (!v.ok) return jsonError(v.error);
  const { data, error } = await supabaseAdmin
    .from("orm_mentions")
    .update(v.value)
    .eq("id", id)
    .select(MENTION_COLUMNS)
    .maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError("mention not found", 404);
  return NextResponse.json({ mention: data as unknown as OrmMention });
}
