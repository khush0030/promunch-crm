import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import {
  basicInputErrors,
  followupAudienceFilter,
  followupInitialStatus,
  followupParentError,
  JOURNEY_DUPLICATE_ERROR,
  journeyDuplicateError,
  MAX_FOLLOWUP_DEPTH,
  MAX_JOURNEY_FOLLOWUPS,
  needsFollowupSql,
  normalizeAudienceFilter,
  parseFollowupInput,
  templateInputErrors,
  type AudienceFilter,
  type FollowupInput,
} from "@/lib/wa-campaigns";
import { warmAudienceError } from "@/lib/wa-warm-guard";
import { campaignTemplateError } from "@/lib/wa-campaign-template-guard";
import {
  descendants,
  followupSqlError,
  journeyDepth,
  journeyMessages,
  journeyRoot,
  TEMPLATE_JOIN,
  templateDefaultMedia,
} from "@/lib/wa-campaign-journeys";

// GET  -> { campaigns: [...] }  every row (select *) incl. followup_of,
//         followup_after_hours, followup_stage (null on ordinary campaigns).
// POST -> { campaign }  An ordinary campaign, or a FOLLOW-UP when the body has
//         followup_of + followup_after_hours + followup_stage (all or none).
//         For a follow-up the audience is built here from the parent + timing
//         (any audience_filter / scheduled_at / repeat_rule in the body is
//         ignored), status is 'draft' while the parent is a draft, else
//         'scheduled' (armed: the worker starts it from its parent).

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
    followup_of?: string | null;
    followup_after_hours?: number | null;
    followup_stage?: string | null;
  }>(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!body.template_id) return NextResponse.json({ error: "template_id required" }, { status: 400 });
  const kindErr = await campaignTemplateError(body.template_id);
  if (kindErr) return NextResponse.json({ error: kindErr }, { status: 400 });

  const fu = parseFollowupInput(body as Record<string, unknown>);
  if (!fu.ok) return NextResponse.json({ error: fu.error }, { status: 400 });
  if (fu.followup) return await createFollowup(body, fu.followup);

  const aud = normalizeAudienceFilter(body.audience_filter ?? {});
  if (!aud.ok) return NextResponse.json({ error: aud.error }, { status: 400 });
  if (needsFollowupSql(aud.filter)) {
    const sqlErr = await followupSqlError();
    if (sqlErr) return NextResponse.json({ error: sqlErr }, { status: 409 });
  }
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

async function createFollowup(
  body: {
    name?: string;
    template_id?: string;
    template_vars?: Record<string, unknown>;
    header_media_url?: string | null;
    created_by?: string | null;
  },
  f: FollowupInput,
) {
  const sqlErr = await followupSqlError();
  if (sqlErr) return NextResponse.json({ error: sqlErr }, { status: 409 });

  const { data: parent, error: pErr } = await supabaseAdmin
    .from("wa_campaigns")
    .select("id,status,repeat_rule,started_at,template_id")
    .eq("id", f.followup_of)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  const parentErr = followupParentError(parent);
  if (parentErr) return NextResponse.json({ error: parentErr }, { status: 409 });

  let root, family, messages;
  try {
    const depth = (await journeyDepth(f.followup_of)) + 1;
    if (depth > MAX_FOLLOWUP_DEPTH) {
      return NextResponse.json({ error: `A journey can go at most ${MAX_FOLLOWUP_DEPTH} follow-ups deep.` }, { status: 409 });
    }
    root = await journeyRoot(f.followup_of);
    if (!root) return NextResponse.json({ error: "The campaign this follows no longer exists." }, { status: 409 });
    family = await descendants(root.id);
    messages = await journeyMessages(root.id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  if (family.length >= MAX_JOURNEY_FOLLOWUPS) {
    return NextResponse.json({ error: `A journey can have at most ${MAX_JOURNEY_FOLLOWUPS} follow-ups.` }, { status: 409 });
  }
  const headerMediaUrl = (body.header_media_url ?? "").trim() || null;
  const dupErr = journeyDuplicateError(
    { template_id: body.template_id, template_vars: body.template_vars ?? {}, header_media_url: headerMediaUrl },
    messages,
    await templateDefaultMedia(body.template_id),
  );
  if (dupErr) return NextResponse.json({ error: dupErr }, { status: 409 });
  const basic = basicInputErrors({ template_vars: body.template_vars ?? {}, header_media_url: headerMediaUrl });
  if (basic.length) return NextResponse.json({ error: basic.join("; "), errors: basic }, { status: 400 });

  const status = followupInitialStatus(parent!.status);
  // An armed follow-up fires unattended, so it must be sendable now (the same
  // rule as a scheduled campaign). A draft one is re-checked by the engine.
  if (status === "scheduled") {
    const { data: tpl } = await supabaseAdmin
      .from("wa_templates")
      .select("name,header_type,header_text,header_media_url,body,buttons")
      .eq("id", body.template_id!)
      .maybeSingle();
    const errs = templateInputErrors(tpl, body.template_vars ?? {}, headerMediaUrl);
    if (errs.length) return NextResponse.json({ error: errs.join("; "), errors: errs }, { status: 400 });
  }

  const audience: AudienceFilter = followupAudienceFilter(f);
  const { data, error } = await supabaseAdmin
    .from("wa_campaigns")
    .insert({
      name: body.name,
      template_id: body.template_id,
      template_vars: body.template_vars ?? {},
      audience_filter: audience,
      header_media_url: headerMediaUrl,
      scheduled_at: null,
      status,
      created_by: body.created_by ?? null,
      repeat_rule: null,
      repeat_until: null,
      followup_of: f.followup_of,
      followup_after_hours: f.followup_after_hours,
      followup_stage: f.followup_stage,
    })
    .select(TEMPLATE_JOIN)
    .single();
  // wa_campaigns_followup_identical_uniq: a concurrent identical create lost the race.
  if (error?.code === "23505") return NextResponse.json({ error: JOURNEY_DUPLICATE_ERROR }, { status: 409 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
