import type { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getCaller } from "@/lib/rbac-server";

// Append a row to the audit_log. BEST-EFFORT: never throws and never blocks the
// action it records — a failed audit write must not fail the delete. Call it
// AFTER the action succeeds so the log reflects reality.
//
// Pass the already-resolved `actor` (e.g. requireAdmin()'s gate.user) when you
// have it to avoid a second auth round-trip; otherwise it resolves the caller
// from the session.

export type AuditEntry = {
  action: string;                 // 'contact.delete', 'campaign.delete', 'team.role_change', ...
  entityType?: string;            // 'contact' | 'campaign' | 'kb_document' | ...
  entityId?: string;
  summary?: string;               // one human-readable line
  metadata?: Record<string, unknown>;
  actor?: User | null;            // pass gate.user if you already have it
  request?: NextRequest;          // to capture the client IP
};

function clientIp(req?: NextRequest): string | null {
  if (!req) return null;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const actor = entry.actor ?? (await getCaller().catch(() => null));
    await supabaseAdmin.from("audit_log").insert({
      actor_email: actor?.email ?? null,
      actor_id: actor?.id ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      summary: entry.summary ?? null,
      metadata: entry.metadata ?? null,
      ip: clientIp(entry.request),
    });
  } catch (e) {
    // Swallow — auditing must never break the operation it records.
    console.error("[audit] failed to record", entry.action, e);
  }
}
