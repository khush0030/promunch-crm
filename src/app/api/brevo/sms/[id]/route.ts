import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";
import { brevo, brevoGet, BrevoError } from "@/lib/brevo";
import { validateSmsDraft } from "@/lib/brevo-sms";
import type { SmsCampaign } from "@/app/api/brevo/sms/route";

// One SMS campaign (admin): GET, PUT (drafts/suspended only), DELETE (drafts only).
export const dynamic = "force-dynamic";

function fail(e: unknown) {
  if (e instanceof BrevoError) return NextResponse.json({ ok: false, error: `Brevo: ${e.message}` }, { status: e.notFound ? 404 : 502 });
  return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
}

async function guard(ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (!gate.ok) return { res: gate.response } as const;
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return { res: NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 }) } as const;
  return { gate, id } as const;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(ctx);
  if ("res" in g) return g.res;
  try {
    return NextResponse.json(await brevoGet<SmsCampaign>(`/smsCampaigns/${g.id}`));
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(ctx);
  if ("res" in g) return g.res;
  const parsed = validateSmsDraft(((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>, true);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: "Fix these first", errors: parsed.errors }, { status: 400 });
  try {
    const current = await brevoGet<SmsCampaign>(`/smsCampaigns/${g.id}`);
    if (!["draft", "suspended"].includes(current.status)) return NextResponse.json({ ok: false, error: `Can't edit a "${current.status}" SMS campaign.` }, { status: 409 });
    await brevo("PUT", `/smsCampaigns/${g.id}`, parsed.draft);
    await recordAudit({ action: "brevo.sms_campaign_update", entityType: "brevo_sms_campaign", entityId: g.id, summary: Object.keys(parsed.draft).join(", "), actor: g.gate.user, request: req });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(ctx);
  if ("res" in g) return g.res;
  try {
    const current = await brevoGet<SmsCampaign>(`/smsCampaigns/${g.id}`);
    if (current.status !== "draft") return NextResponse.json({ ok: false, error: "Only drafts can be deleted." }, { status: 409 });
    await brevo("DELETE", `/smsCampaigns/${g.id}`);
    await recordAudit({ action: "brevo.sms_campaign_delete", entityType: "brevo_sms_campaign", entityId: g.id, summary: current.name, actor: g.gate.user, request: req });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
