import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getCaller } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";
import { validateCustomFlow } from "./validate";

// Create a user-defined WhatsApp flow (wa_custom_flows). Enrolment/delivery
// happen in the edge functions — see _shared/custom-flows.ts.
//
// Any teammate with the WhatsApp marketing area may create one (the middleware
// enforces the area). A new flow is ALWAYS saved switched off (a draft): it
// only starts messaging customers after someone turns it on explicitly with
// the enabled-only PATCH, which the dashboard confirms first.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const gate = { user: caller };

  const body = await req.json().catch(() => null);
  const v = validateCustomFlow(body);
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("wa_custom_flows")
    .insert({ ...v.flow, enabled: false, updated_by: gate.user.email ?? null })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    action: "wa_flows.custom_create",
    entityType: "wa_custom_flow",
    entityId: data.id,
    summary: `Created WhatsApp flow "${v.flow.name}" as a draft (off) (${v.flow.trigger_event}, ${v.flow.steps.length} step(s))`,
    request: req,
    actor: gate.user,
  });
  return NextResponse.json({ flow: data });
}
