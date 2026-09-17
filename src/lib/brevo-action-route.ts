// Shared handlers for /api/brevo/campaigns/[id]/actions and
// /api/brevo/sms/[id]/actions.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { BrevoError } from "@/lib/brevo";
import { ACTIONS, ActionError, preflight, runCampaignAction, type CampaignAction, type Channel } from "@/lib/brevo-campaign-actions";

const idOf = (raw: string) => (/^\d+$/.test(raw) ? Number(raw) : null);

function fail(e: unknown, tag: string) {
  if (e instanceof ActionError) return NextResponse.json({ ok: false, error: e.message, errors: e.details }, { status: e.status });
  if (e instanceof BrevoError) return NextResponse.json({ ok: false, error: `Brevo: ${e.message}` }, { status: e.notFound ? 404 : 502 });
  console.error(tag, e);
  return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
}

// GET ?action=send_now|schedule&confirmCount=&scheduledAt= -> preflight for the confirm dialog.
export async function preflightHandler(channel: Channel, req: NextRequest, rawId: string) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const id = idOf(rawId);
  if (id == null) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  const u = new URL(req.url);
  const action = u.searchParams.get("action") === "schedule" ? "schedule" : "send_now";
  const cc = u.searchParams.get("confirmCount");
  try {
    const { campaign, ...rest } = await preflight(channel, id, action, cc != null && /^\d+$/.test(cc) ? Number(cc) : null, u.searchParams.get("scheduledAt"));
    return NextResponse.json({ ...rest, campaign: { id: campaign.id, name: campaign.name, status: campaign.status, modifiedAt: campaign.modifiedAt ?? null } });
  } catch (e) {
    return fail(e, `[brevo/${channel}/preflight]`);
  }
}

export async function actionHandler(channel: Channel, req: NextRequest, rawId: string) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const id = idOf(rawId);
  if (id == null) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = b?.action as CampaignAction;
  if (!ACTIONS.includes(action)) return NextResponse.json({ ok: false, error: `action must be one of ${ACTIONS.join(", ")}` }, { status: 400 });
  try {
    const result = await runCampaignAction({
      channel,
      id,
      action,
      actor: gate.user,
      confirmCount: typeof b?.confirmCount === "number" ? b.confirmCount : null,
      scheduledAt: typeof b?.scheduledAt === "string" ? b.scheduledAt : null,
      recipientsType: typeof b?.recipientsType === "string" ? b.recipientsType : undefined,
      reportTo: Array.isArray(b?.reportTo) ? (b.reportTo as unknown[]).map(String) : undefined,
      phoneNumber: typeof b?.phoneNumber === "string" ? b.phoneNumber : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    return fail(e, `[brevo/${channel}/action:${action}]`);
  }
}
