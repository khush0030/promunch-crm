import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const TEMPLATE_JOIN = "*, template:wa_templates(id,name,language,category,status,body)";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("wa_campaigns")
    .select(TEMPLATE_JOIN)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!body.template_id) return NextResponse.json({ error: "template_id required" }, { status: 400 });

  // A campaign with a future scheduled_at is parked as 'scheduled' — the
  // /api/cron/wa-campaign-tick job fires it at that time. Without one it's a
  // plain draft the user sends manually.
  const scheduledAt = body.scheduled_at ?? null;
  const isScheduled = scheduledAt && new Date(scheduledAt).getTime() > Date.now();
  const row = {
    name: body.name,
    template_id: body.template_id,
    template_vars: body.template_vars ?? {},
    audience_filter: body.audience_filter ?? {},
    scheduled_at: scheduledAt,
    status: isScheduled ? "scheduled" : "draft",
    created_by: body.created_by ?? null,
  };
  const { data, error } = await supabaseAdmin
    .from("wa_campaigns")
    .insert(row)
    .select(TEMPLATE_JOIN)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
