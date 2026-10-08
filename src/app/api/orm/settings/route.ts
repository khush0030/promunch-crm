import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/rbac-server";
import { asinSuggestions, getOrmSettings, jsonError, listSources, readJson, requireUser } from "@/lib/orm/db";
import { validateSettingsPatch } from "@/lib/orm/settings-patch";

export const dynamic = "force-dynamic";

// GET /api/orm/settings -> { settings, sources, asin_suggestions }
export async function GET() {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  try {
    const [settings, sources, asin_suggestions] = await Promise.all([getOrmSettings(), listSources(), asinSuggestions()]);
    return NextResponse.json({ settings, sources, asin_suggestions });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e), 500);
  }
}

// PATCH /api/orm/settings (admin only): settings fields +
// sources: { <key>: { enabled?, config?, every_minutes? } }
export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const body = await readJson(req);
  if (!body) return jsonError("bad json");
  const v = validateSettingsPatch(body);
  if (!v.ok) return jsonError(v.error);
  const now = new Date().toISOString();

  if (Object.keys(v.value.settings).length) {
    const { error } = await supabaseAdmin
      .from("orm_settings")
      .upsert({ id: 1, ...v.value.settings, updated_at: now }, { onConflict: "id" });
    if (error) return jsonError(error.message, 500);
  }
  for (const [key, patch] of Object.entries(v.value.sources)) {
    const row: Record<string, unknown> = { ...patch, updated_at: now };
    // Turning a source on makes it due now, so the next tick collects it.
    if (patch.enabled === true) row.next_run_at = now;
    const { error } = await supabaseAdmin.from("orm_sources").update(row).eq("key", key);
    if (error) return jsonError(error.message, 500);
  }
  console.info("orm_settings_updated", {
    by: gate.user.email,
    fields: Object.keys(v.value.settings),
    sources: Object.keys(v.value.sources),
  });
  const [settings, sources] = await Promise.all([getOrmSettings(), listSources()]);
  return NextResponse.json({ settings, sources });
}
