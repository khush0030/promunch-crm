// Pure helpers for running new code against an older deals schema (before
// migration 20261010100000_deals_simplify.sql). No I/O.

import { toLegacyStage, type DealStage } from "./stages";
import { formatPhone, formatRupees, shortDay } from "./model";

export type PgError = { code?: string; message?: string } | null;

const NEW_COLUMNS = [
  "follow_up_at",
  "owner_email",
  "value_inr",
  "contact_phone",
  "source",
  "source_ref",
  "closed_reason",
  "human_touched_at",
] as const;

/** The DB is older than the code (missing column / table / old stage check). */
export function isSchemaLag(e: PgError): boolean {
  if (!e) return false;
  if (e.code && ["PGRST204", "PGRST205", "42703", "42P01", "23514"].includes(e.code)) return true;
  const m = (e.message ?? "").toLowerCase();
  return (m.includes("column") && (m.includes("does not exist") || m.includes("could not find"))) ||
    m.includes("deals_stage_check") ||
    m.includes("deal_activity");
}

/** Strip new columns, map the stage back, fold extra facts into notes. */
export function toLegacyRow(row: Record<string, unknown>, existingNotes: string | null = null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  const extras: string[] = [];
  if (row.contact_phone) extras.push(`Phone ${formatPhone(String(row.contact_phone))}`);
  if (row.value_inr != null) extras.push(`Value ${formatRupees(Number(row.value_inr), false)}`);
  if (row.follow_up_at) extras.push(`Follow up ${shortDay(String(row.follow_up_at))}`);
  if (row.owner_email) extras.push(`Owner ${row.owner_email}`);
  if (row.closed_reason) extras.push(`Reason: ${row.closed_reason}`);
  if (row.source_ref) extras.push(`Ref ${row.source_ref}`);
  for (const c of NEW_COLUMNS) delete out[c];
  if (typeof out.stage === "string") out.stage = toLegacyStage(out.stage as DealStage);
  if (row.follow_up_at) out.follow_up_needed = true;
  if (extras.length) {
    out.notes = [existingNotes ?? (row.notes as string | null) ?? null, extras.join(" · ")]
      .filter(Boolean).join("\n\n").slice(0, 8000);
  }
  return out;
}
