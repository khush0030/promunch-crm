import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getCaller } from "@/lib/rbac-server";
import { requireSecretsOwner, SECRETS_OWNER } from "@/lib/secrets";
import { recordAudit } from "@/lib/audit";
import { getBrevoSettings, validateSettingsPatch, type BrevoSettings } from "@/lib/brevo-settings";

// Brevo integration settings.
//   GET -> settings + whether the caller is the owner (UI hides owner actions)
//   PUT -> owner only. Flipping sync_target to "live" is what lets real
//          customers reach Brevo, so it is audited.
export const dynamic = "force-dynamic";

export type SettingsResponse = { settings: BrevoSettings; migrated: boolean; isOwner: boolean };

export async function GET() {
  const [caller, s] = await Promise.all([getCaller(), getBrevoSettings()]);
  const { migrated, ...settings } = s;
  const body: SettingsResponse = { settings, migrated, isOwner: (caller?.email ?? "").toLowerCase() === SECRETS_OWNER };
  return NextResponse.json(body);
}

export async function PUT(req: NextRequest) {
  const gate = await requireSecretsOwner();
  if (!gate.ok) return gate.response;

  const parsed = validateSettingsPatch(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const before = await getBrevoSettings();
  if (!before.migrated) return NextResponse.json({ ok: false, error: "brevo_settings table missing: apply migration 20260917100000_brevo_integration.sql" }, { status: 409 });

  const { error } = await supabaseAdmin
    .from("brevo_settings")
    .update({ ...parsed.patch, updated_at: new Date().toISOString(), updated_by: gate.user.email })
    .eq("id", 1);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const changes = Object.entries(parsed.patch)
    .filter(([k, v]) => JSON.stringify(before[k as keyof BrevoSettings]) !== JSON.stringify(v))
    .map(([k, v]) => `${k}: ${JSON.stringify(before[k as keyof BrevoSettings])} -> ${JSON.stringify(v)}`);
  if (changes.length) {
    await recordAudit({ action: "brevo.settings_update", entityType: "brevo", summary: changes.join("; "), actor: gate.user, request: req });
  }
  const after = await getBrevoSettings();
  const { migrated, ...settings } = after;
  return NextResponse.json({ ok: true, settings, migrated, isOwner: true });
}
