// Brevo integration settings (singleton brevo_settings row). The validator is
// pure; getBrevoSettings is server-only.

import { supabaseAdmin } from "@/lib/supabase-admin";

export type BrevoSettings = {
  sync_target: "test" | "live";
  test_emails: string[];
  test_list_id: number | null;
  live_list_id: number | null;
  events_enabled: boolean;
  sms_enabled: boolean;
  last_sync_at: string | null;
  last_sync_cursor: string | null;
  last_sync_count: number | null;
  last_sync_error: string | null;
  updated_at: string;
  updated_by: string | null;
};

export const DEFAULT_SETTINGS: BrevoSettings = {
  sync_target: "test",
  test_emails: ["kmutha@vippysoya.com"],
  test_list_id: null,
  live_list_id: null,
  events_enabled: false,
  sms_enabled: false,
  last_sync_at: null,
  last_sync_cursor: null,
  last_sync_count: null,
  last_sync_error: null,
  updated_at: new Date(0).toISOString(),
  updated_by: null,
};

/** The settings row; defaults (test mode, everything off) if the migration isn't applied yet. */
export async function getBrevoSettings(): Promise<BrevoSettings & { migrated: boolean }> {
  const { data, error } = await supabaseAdmin.from("brevo_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !data) return { ...DEFAULT_SETTINGS, migrated: false };
  return { ...DEFAULT_SETTINGS, ...(data as Partial<BrevoSettings>), migrated: true };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SettingsPatch = Partial<Pick<BrevoSettings, "sync_target" | "test_emails" | "test_list_id" | "live_list_id" | "events_enabled" | "sms_enabled">>;

export function validateSettingsPatch(input: unknown): { ok: true; patch: SettingsPatch } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "body must be an object" };
  const b = input as Record<string, unknown>;
  const patch: SettingsPatch = {};
  if ("sync_target" in b) {
    if (b.sync_target !== "test" && b.sync_target !== "live") return { ok: false, error: "sync_target must be test or live" };
    patch.sync_target = b.sync_target;
  }
  if ("test_emails" in b) {
    if (!Array.isArray(b.test_emails)) return { ok: false, error: "test_emails must be a list" };
    const emails = [...new Set(b.test_emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
    if (emails.length === 0) return { ok: false, error: "keep at least one test address" };
    if (emails.length > 20) return { ok: false, error: "at most 20 test addresses" };
    const bad = emails.find((e) => !EMAIL_RE.test(e));
    if (bad) return { ok: false, error: `not an email: ${bad}` };
    patch.test_emails = emails;
  }
  for (const k of ["test_list_id", "live_list_id"] as const) {
    if (k in b) {
      const v = b[k];
      if (v === null) patch[k] = null;
      else if (typeof v === "number" && Number.isInteger(v) && v > 0) patch[k] = v;
      else return { ok: false, error: `${k} must be a positive integer or null` };
    }
  }
  for (const k of ["events_enabled", "sms_enabled"] as const) {
    if (k in b) {
      if (typeof b[k] !== "boolean") return { ok: false, error: `${k} must be true or false` };
      patch[k] = b[k] as boolean;
    }
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "nothing to update" };
  return { ok: true, patch };
}
