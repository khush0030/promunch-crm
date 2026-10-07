import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/rbac-server";
import { getSettings, jsonError, readJson, requireUser } from "@/lib/influencers/db";
import { normalizePhone } from "@/lib/influencers/normalize";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  return NextResponse.json({ settings: await getSettings() });
}

const intIn = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

// Admin-only: engine_enabled is the master switch for messages to creators.
export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const body = await readJson(req);
  if (!body) return jsonError("bad json");
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const patch: Record<string, unknown> = {};

  for (const k of ["engine_enabled", "digest_enabled"] as const) {
    if (!has(k)) continue;
    if (typeof body[k] !== "boolean") return jsonError(`${k} must be true or false`);
    patch[k] = body[k];
  }
  if (has("digest_hour_ist")) {
    if (!intIn(body.digest_hour_ist, 0, 23)) return jsonError("digest_hour_ist must be 0 to 23");
    patch.digest_hour_ist = body.digest_hour_ist;
  }
  if (has("owner_wa_id")) {
    if (body.owner_wa_id === null || body.owner_wa_id === "") patch.owner_wa_id = null;
    else {
      const p = normalizePhone(body.owner_wa_id);
      if (!p) return jsonError("owner_wa_id is not a valid number");
      patch.owner_wa_id = p;
    }
  }
  if (has("default_draft_due_days")) {
    if (!intIn(body.default_draft_due_days, 7, 15)) return jsonError("default_draft_due_days must be 7 to 15");
    patch.default_draft_due_days = body.default_draft_due_days;
  }
  if (has("default_post_after_approval_days")) {
    if (!intIn(body.default_post_after_approval_days, 0, 60)) return jsonError("default_post_after_approval_days must be 0 to 60");
    patch.default_post_after_approval_days = body.default_post_after_approval_days;
  }

  const current = await getSettings();
  if (has("nudges")) {
    const n = body.nudges;
    if (!n || typeof n !== "object" || Array.isArray(n)) return jsonError("nudges must be an object");
    // Merge per gate so a form that edits one gate keeps the others.
    const merged: Record<string, unknown> = { ...current.nudges };
    for (const [gateKey, v] of Object.entries(n as Record<string, unknown>)) {
      if (!["brief_ack", "delivery_check", "draft_due", "post_due"].includes(gateKey)) return jsonError(`unknown nudge ${gateKey}`);
      if (!v || typeof v !== "object" || Array.isArray(v)) return jsonError(`nudges.${gateKey} must be an object`);
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const ok = Array.isArray(val)
          ? val.length <= 6 && val.every((x) => typeof x === "number" && x >= 0 && x <= 720)
          : typeof val === "number" && val >= 0 && val <= 720;
        if (!ok) return jsonError(`nudges.${gateKey}.${k} must be hours/days (0 to 720)`);
      }
      merged[gateKey] = { ...((current.nudges[gateKey] as Record<string, unknown>) ?? {}), ...(v as Record<string, unknown>) };
    }
    patch.nudges = merged;
  }
  if (has("team_sla")) {
    const t = body.team_sla as Record<string, unknown> | null;
    if (!t || typeof t !== "object") return jsonError("team_sla must be an object");
    const next = { ...current.team_sla };
    for (const k of ["brief_approval_hours", "dispatch_hours", "draft_review_hours"] as const) {
      if (!(k in t)) continue;
      if (!intIn(t[k], 1, 720)) return jsonError(`team_sla.${k} must be 1 to 720 hours`);
      next[k] = t[k] as number;
    }
    patch.team_sla = next;
  }
  if (!Object.keys(patch).length) return jsonError("nothing to update");

  const { error } = await supabaseAdmin
    .from("influencer_settings")
    .upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) return jsonError(error.message, 500);
  console.info("influencer_settings_updated", { by: gate.user.email, fields: Object.keys(patch) });
  return NextResponse.json({ settings: await getSettings() });
}
