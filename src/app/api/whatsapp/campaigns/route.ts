import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { basicInputErrors, normalizeAudienceFilter, templateInputErrors } from "@/lib/wa-campaigns";
import { warmAudienceError } from "@/lib/wa-warm-guard";
import { campaignTemplateError } from "@/lib/wa-campaign-template-guard";

const TEMPLATE_JOIN =
  "*, template:wa_templates(id,name,language,category,status,body,header_type,header_text,header_media_url,buttons)";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("wa_campaigns")
    .select(TEMPLATE_JOIN)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await parseBody<{
    name?: string;
    template_id?: string;
    template_vars?: Record<string, unknown>;
    audience_filter?: Record<string, unknown>;
    header_media_url?: string | null;
    scheduled_at?: string | null;
    repeat_rule?: string;
    repeat_until?: string | null;
    created_by?: string | null;
  }>(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!body.template_id) return NextResponse.json({ error: "template_id required" }, { status: 400 });
  const kindErr = await campaignTemplateError(body.template_id);
  if (kindErr) return NextResponse.json({ error: kindErr }, { status: 400 });

  const aud = normalizeAudienceFilter(body.audience_filter ?? {});
  if (!aud.ok) return NextResponse.json({ error: aud.error }, { status: 400 });
  const warmErr = await warmAudienceError(aud.filter);
  if (warmErr) return NextResponse.json({ error: warmErr }, { status: 409 });
  const headerMediaUrl = (body.header_media_url ?? "").trim() || null;
  const basic = basicInputErrors({ template_vars: body.template_vars ?? {}, header_media_url: headerMediaUrl });
  if (basic.length) return NextResponse.json({ error: basic.join("; "), errors: basic }, { status: 400 });

  // A campaign with a future scheduled_at is parked as 'scheduled' — the
  // /api/cron/wa-campaign-tick job fires it at that time. Without one it's a
  // plain draft the user sends manually.
  const scheduledAt = body.scheduled_at ?? null;
  const isScheduled = scheduledAt && new Date(scheduledAt).getTime() > Date.now();
  // Recurring: a repeat_rule turns a scheduled campaign into an ongoing series.
  // The wa-campaign-tick cron spawns a child send each occurrence.
  const repeatRule = ["daily", "weekly", "monthly"].includes(body.repeat_rule ?? "")
    ? body.repeat_rule : null;

  // A scheduled campaign fires unattended, so it must be sendable now: the
  // same template/param rules the engine applies at start. (Drafts may be
  // incomplete; the engine re-validates when they are sent.)
  if (isScheduled) {
    const { data: tpl } = await supabaseAdmin
      .from("wa_templates")
      .select("name,header_type,header_text,header_media_url,body,buttons")
      .eq("id", body.template_id)
      .maybeSingle();
    const errs = templateInputErrors(tpl, body.template_vars ?? {}, headerMediaUrl);
    if (errs.length) return NextResponse.json({ error: errs.join("; "), errors: errs }, { status: 400 });
  }
  const row = {
    name: body.name,
    template_id: body.template_id,
    template_vars: body.template_vars ?? {},
    audience_filter: aud.filter,
    header_media_url: headerMediaUrl,
    scheduled_at: scheduledAt,
    status: isScheduled ? "scheduled" : "draft",
    created_by: body.created_by ?? null,
    repeat_rule: isScheduled ? repeatRule : null, // recurrence needs a schedule
    repeat_until: isScheduled && repeatRule ? (body.repeat_until ?? null) : null,
  };
  const { data, error } = await supabaseAdmin
    .from("wa_campaigns")
    .insert(row)
    .select(TEMPLATE_JOIN)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
