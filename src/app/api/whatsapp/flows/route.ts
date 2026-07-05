import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";

// Settings for the automated WhatsApp journeys (Flows tab).
// Backed by the wa_flow_settings singleton (id=1, migration 20260705190000).
// DEFAULTS mirrors FLOW_DEFAULTS in supabase/functions/_shared/flow-settings.ts
// and reproduces the pre-settings hardcoded behavior — keep the two in sync.

export const dynamic = "force-dynamic";

const DEFAULTS = {
  order_confirmation_enabled: true,
  shipping_update_enabled: true,
  abandoned_cart_enabled: true,
  cart_step1_delay_hours: 1,
  cart_step2_delay_hours: 6,
  cart_deadline_hours: 72,
  cart_backoff_hours: 6,
  cart_coupon_code: "PROMUNCH10",
  review_request_enabled: true,
  review_delay_days: 7,
  replenishment_enabled: true,
  replenishment_delay_days: 30,
};
type Settings = typeof DEFAULTS;

const BOOL_KEYS = [
  "order_confirmation_enabled", "shipping_update_enabled", "abandoned_cart_enabled",
  "review_request_enabled", "replenishment_enabled",
] as const;

const NUM_LIMITS: Record<string, { min: number; max: number }> = {
  cart_step1_delay_hours: { min: 0.25, max: 168 },
  cart_step2_delay_hours: { min: 0.5, max: 336 },
  cart_deadline_hours: { min: 6, max: 720 },
  cart_backoff_hours: { min: 1, max: 72 },
  review_delay_days: { min: 1, max: 90 },
  replenishment_delay_days: { min: 1, max: 365 },
};

async function currentSettings(): Promise<Settings> {
  const { data } = await supabaseAdmin
    .from("wa_flow_settings").select("*").eq("id", 1).maybeSingle();
  const out: Record<string, unknown> = { ...DEFAULTS };
  if (data) {
    for (const k of Object.keys(DEFAULTS) as Array<keyof Settings>) {
      const v = (data as Record<string, unknown>)[k];
      if (v === null || v === undefined) continue;
      out[k] = typeof DEFAULTS[k] === "number" ? Number(v) : v;
    }
  }
  return out as Settings;
}

export async function GET() {
  const settings = await currentSettings().catch(() => DEFAULTS);

  // Last-30-day journey outcomes, grouped per journey_key.
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: runs } = await supabaseAdmin
    .from("wa_journey_runs")
    .select("journey_key, status")
    .gte("created_at", since)
    .limit(10000);
  const stats: Record<string, Record<string, number>> = {};
  for (const r of runs ?? []) {
    const byKey = (stats[r.journey_key] ??= {});
    byKey[r.status] = (byKey[r.status] ?? 0) + 1;
  }

  // Templates: the built-in flow set PLUS any referenced by custom flows —
  // fetch all names so the page can show approval dots everywhere.
  const { data: templates } = await supabaseAdmin
    .from("wa_templates")
    .select("name, language, status");

  // User-created flows (empty array when the table isn't migrated yet).
  const { data: custom } = await supabaseAdmin
    .from("wa_custom_flows")
    .select("*")
    .order("created_at", { ascending: true });

  return NextResponse.json({ settings, stats, templates: templates ?? [], custom: custom ?? [] });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const k of BOOL_KEYS) {
    if (typeof body[k] === "boolean") patch[k] = body[k];
  }
  for (const [k, lim] of Object.entries(NUM_LIMITS)) {
    if (body[k] === undefined) continue;
    const n = Number(body[k]);
    if (!Number.isFinite(n) || n < lim.min || n > lim.max) {
      return NextResponse.json(
        { error: `${k} must be between ${lim.min} and ${lim.max}` }, { status: 400 });
    }
    patch[k] = n;
  }
  if (body.cart_coupon_code !== undefined) {
    const code = String(body.cart_coupon_code).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,40}$/.test(code)) {
      return NextResponse.json(
        { error: "coupon code must be 2–40 letters/digits (dashes/underscores ok)" }, { status: 400 });
    }
    patch.cart_coupon_code = code;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no editable fields in body" }, { status: 400 });
  }

  // Cross-field sanity against the MERGED result, since fields patch independently.
  const merged = { ...(await currentSettings().catch(() => DEFAULTS)), ...patch } as Settings;
  if (merged.cart_step2_delay_hours <= merged.cart_step1_delay_hours) {
    return NextResponse.json(
      { error: "the coupon message must come after the reminder (step 2 delay > step 1 delay)" },
      { status: 400 });
  }
  if (merged.cart_deadline_hours <= merged.cart_step2_delay_hours) {
    return NextResponse.json(
      { error: "the give-up deadline must be after the coupon message (deadline > step 2 delay)" },
      { status: 400 });
  }

  const changed = Object.keys(patch);
  patch.updated_at = new Date().toISOString();
  patch.updated_by = gate.user.email ?? null;
  const { error } = await supabaseAdmin
    .from("wa_flow_settings")
    .upsert({ id: 1, ...patch }, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    action: "wa_flows.update",
    entityType: "wa_flow_settings",
    entityId: "1",
    summary: `Updated WhatsApp flow settings: ${changed.join(", ")}`,
    request: req,
    actor: gate.user,
  });

  return NextResponse.json({ settings: await currentSettings() });
}
