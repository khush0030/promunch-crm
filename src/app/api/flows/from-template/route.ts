import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { templateByKey, FLOW_TEMPLATES } from "@/lib/email/flow-templates";

// Dashboard backend (session-gated by middleware). Instantiates a flows row from
// a catalog template. Always created as 'draft' — nothing sends until the owner
// reviews the copy and sets it active.
export async function GET() {
  // Lets the gallery render the catalog without bundling it client-side.
  return NextResponse.json({
    templates: FLOW_TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      category: t.category,
      description: t.description,
      trigger_type: t.trigger_type,
      steps: t.steps.length,
      needsSetup: t.needsSetup ?? false,
    })),
  });
}

export async function POST(request: NextRequest) {
  let body: { templateKey?: string; blank?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // "Start from scratch": an empty draft the builder fills in.
  if (body.blank) {
    const { data, error } = await supabase
      .from("flows")
      .insert({ name: "Untitled flow", trigger_type: "segment_entry", trigger_config: {}, steps: [], status: "draft" })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ flow: data }, { status: 201 });
  }

  const tpl = body.templateKey ? templateByKey(body.templateKey) : undefined;
  if (!tpl) {
    return NextResponse.json({ error: "unknown template" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("flows")
    .insert({
      name: tpl.name,
      description: tpl.description,
      trigger_type: tpl.trigger_type,
      trigger_config: tpl.trigger_config,
      steps: tpl.steps,
      status: "draft",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ flow: data }, { status: 201 });
}
