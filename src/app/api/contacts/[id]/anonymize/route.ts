import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";
import { anonymizeContact } from "@/lib/gdpr";
import { assertHuman } from "@/lib/botid-guard";

// GDPR/DPDP right-to-erasure (our chosen shape: anonymize in place). Scrubs the
// contact's identifying fields but keeps order rows linked for financial
// integrity. Admin-gated and audit-logged.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const bot = await assertHuman();
  if (bot) return bot;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const { ok, wasEmail } = await anonymizeContact(id);
  if (!ok && !wasEmail) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  if (!ok) return NextResponse.json({ error: "Anonymize failed" }, { status: 500 });

  await recordAudit({
    action: "contact.anonymize",
    entityType: "contact",
    entityId: id,
    summary: `Anonymized contact ${id}${wasEmail ? ` (was ${wasEmail})` : ""}`,
    actor: gate.user,
    request,
  });

  return NextResponse.json({ ok: true });
}
