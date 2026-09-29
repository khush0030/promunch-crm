import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { blankDesign, parseDesign, type EmailDesign } from "@/lib/email-studio/design";
import { systemTemplate } from "@/lib/email-studio/templates";
import { PRESETS } from "@/lib/email-studio/segments";
import { getStudioSettings, utmSlug } from "@/lib/email-studio/server";
import { caller, isResponse, bad, migrationHint } from "@/lib/email-studio/route-helpers";

export const dynamic = "force-dynamic";

const LIST_COLS =
  "id, name, subject, status, scheduled_at, sent_at, created_at, updated_at, total_recipients, total_sent, total_opened, total_clicked, total_bounced, total_unsubscribed, approval_status, created_by, design";

export async function GET() {
  const { data, error } = await supabase
    .from("campaigns")
    .select(LIST_COLS)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    // Before migration 016 the new columns don't exist: fall back so the list still loads.
    const legacy = await supabase
      .from("campaigns")
      .select("id, name, subject, status, scheduled_at, sent_at, created_at, updated_at, total_recipients, total_sent, total_opened, total_clicked, total_bounced, total_unsubscribed")
      .order("created_at", { ascending: false })
      .limit(200);
    return NextResponse.json({ campaigns: legacy.data ?? [], warning: migrationHint(error.message) });
  }
  const { data: rev } = await supabase.from("email_attributions").select("campaign_id, revenue").not("campaign_id", "is", null);
  const revenue = new Map<string, { orders: number; revenue: number }>();
  for (const r of rev ?? []) {
    const cur = revenue.get(r.campaign_id as string) ?? { orders: 0, revenue: 0 };
    cur.orders += 1;
    cur.revenue += Number(r.revenue) || 0;
    revenue.set(r.campaign_id as string, cur);
  }
  return NextResponse.json({
    campaigns: (data ?? []).map(({ design, ...c }) => ({
      ...c,
      builder: !!design,
      orders: revenue.get(c.id)?.orders ?? 0,
      revenue: revenue.get(c.id)?.revenue ?? 0,
    })),
  });
}

/** New campaign from a built-in template, a saved template, or blank. */
export async function POST(req: NextRequest) {
  const me = await caller();
  if (isResponse(me)) return me;
  const body = await parseBody<{ name?: string; templateKey?: string; templateId?: string }>(req);
  if (!body) return bad("invalid JSON body");

  let design: EmailDesign | null = null;
  let subject = "";
  let preview = "";
  let templateId: string | null = null;
  if (body.templateId) {
    const { data: t } = await supabase.from("email_studio_templates").select("id, design, subject, preview_text").eq("id", body.templateId).maybeSingle();
    if (!t) return bad("template not found", 404);
    design = parseDesign(t.design);
    subject = t.subject ?? "";
    preview = t.preview_text ?? "";
    templateId = t.id;
  } else if (body.templateKey) {
    const t = systemTemplate(body.templateKey);
    if (!t) return bad("unknown template");
    design = t.build();
    subject = t.subject;
    preview = t.previewText;
  }
  if (!design) design = blankDesign((await getStudioSettings()).brand.theme);

  const name = String(body.name ?? "").trim().slice(0, 120) || `Campaign ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      name,
      subject,
      preview_text: preview,
      design,
      template_id: templateId,
      audience_rules: PRESETS.all.rules,
      status: "draft",
      created_by: me.email,
    })
    .select("id")
    .single();
  if (error || !data) return bad(migrationHint(error?.message ?? "create failed"), 500);
  await supabase.from("campaigns").update({ utm_campaign: utmSlug(name, data.id) }).eq("id", data.id);
  return NextResponse.json({ id: data.id }, { status: 201 });
}
