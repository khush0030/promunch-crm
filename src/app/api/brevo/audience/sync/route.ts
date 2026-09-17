import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { requireSecretsOwner } from "@/lib/secrets";
import { recordAudit } from "@/lib/audit";
import { runBrevoSync } from "@/lib/brevo-sync";

// Contact sync to Brevo.
//   {dryRun: true, previewTarget?: "test"|"live"} -> admin; writes nothing,
//     returns counts + skip reasons + a sample.
//   {dryRun: false} -> owner only; syncs to the CURRENT target in settings.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { dryRun?: boolean; previewTarget?: "test" | "live" };
  const dryRun = b.dryRun !== false;
  const gate = dryRun ? await requireAdmin() : await requireSecretsOwner();
  if (!gate.ok) return gate.response;

  try {
    const result = await runBrevoSync({ dryRun, previewTarget: b.previewTarget === "live" || b.previewTarget === "test" ? b.previewTarget : undefined });
    if (!dryRun) {
      await recordAudit({
        action: "brevo.contact_sync",
        entityType: "brevo_list",
        entityId: result.listId ? String(result.listId) : undefined,
        summary: `${result.target}: ${result.eligible} contacts to ${result.listName}, ${result.blocklisted} blocklisted`,
        metadata: { skipped: result.skipped, processIds: result.processIds },
        actor: gate.user,
        request: req,
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[brevo/audience/sync]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "sync failed" }, { status: 502 });
  }
}
