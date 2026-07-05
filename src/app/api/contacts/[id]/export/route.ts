import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";
import { buildExport } from "@/lib/gdpr";

// GDPR/DPDP right-to-access: download everything we hold about a contact as
// JSON. Admin-gated (it exposes full PII) and itself audit-logged.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const data = await buildExport(id);
  if (!data.contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  await recordAudit({
    action: "contact.export",
    entityType: "contact",
    entityId: id,
    summary: `Exported data-subject data for contact ${id}`,
    actor: gate.user,
    request,
  });

  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="contact-${id}-export.json"`,
    },
  });
}
