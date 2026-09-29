import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { normalizeBrand } from "@/lib/email-studio/design";
import { getStudioSettings } from "@/lib/email-studio/server";
import { caller, isResponse, bad, migrationHint } from "@/lib/email-studio/route-helpers";
import { recordAudit } from "@/lib/audit";

// Brand kit + send guardrails. Anyone with Email marketing can read; only an
// admin can change them (the warm-up cap and approval threshold are the
// owner's safety net).
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await caller();
  if (isResponse(me)) return me;
  const s = await getStudioSettings();
  return NextResponse.json({ settings: s, canEdit: me.admin });
}

export async function PUT(req: NextRequest) {
  const me = await caller();
  if (isResponse(me)) return me;
  if (!me.admin) return bad("Only an admin can change Email Studio settings.", 403);
  const body = await parseBody<{ brand?: unknown; approval_threshold?: unknown; warmup_max_recipients?: unknown }>(req);
  if (!body) return bad("invalid JSON body");

  const patch: Record<string, unknown> = { id: 1, updated_by: me.email, updated_at: new Date().toISOString() };
  if (body.brand !== undefined) patch.brand = normalizeBrand(body.brand);
  if (body.approval_threshold !== undefined) {
    const n = Number(body.approval_threshold);
    if (!Number.isInteger(n) || n < 1) return bad("approval_threshold must be a positive whole number");
    patch.approval_threshold = n;
  }
  if (body.warmup_max_recipients !== undefined) {
    if (body.warmup_max_recipients === null) patch.warmup_max_recipients = null;
    else {
      const n = Number(body.warmup_max_recipients);
      if (!Number.isInteger(n) || n < 1) return bad("warm-up limit must be a positive whole number, or off");
      patch.warmup_max_recipients = n;
    }
  }
  const { error } = await supabase.from("email_studio_settings").upsert(patch, { onConflict: "id" });
  if (error) return bad(migrationHint(error.message), 500);
  await recordAudit({
    action: "email_studio.settings",
    entityType: "email_studio_settings",
    summary: "Email Studio settings changed",
    metadata: { keys: Object.keys(body) },
    actor: me.user,
    request: req,
  });
  return NextResponse.json({ settings: await getStudioSettings() });
}
