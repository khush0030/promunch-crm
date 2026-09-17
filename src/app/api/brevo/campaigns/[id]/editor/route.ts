import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";
import { brevo, brevoGet, BrevoError } from "@/lib/brevo";
import { validateEmailDraft } from "@/lib/brevo-send-guard";

// Email campaign editor backend (admin).
//   GET    -> editable fields incl. htmlContent
//   PUT    -> update (drafts and suspended campaigns only)
//   DELETE -> delete (drafts only)
export const dynamic = "force-dynamic";

type Raw = {
  id: number;
  name: string;
  subject?: string;
  previewText?: string;
  status: string;
  sender?: { id?: number; name?: string; email?: string };
  replyTo?: string;
  htmlContent?: string;
  tag?: string;
  utmCampaign?: string;
  modifiedAt?: string;
  scheduledAt?: string;
  recipients?: { lists?: number[]; exclusionLists?: number[]; segments?: number[] };
};

export type EditorCampaign = {
  id: number;
  name: string;
  subject: string;
  previewText: string;
  status: string;
  senderId: number | null;
  senderEmail: string;
  replyTo: string;
  htmlContent: string;
  tag: string;
  utmCampaign: string;
  modifiedAt: string | null;
  scheduledAt: string | null;
  listIds: number[];
  exclusionListIds: number[];
  segmentIds: number[];
};

const EDITABLE = new Set(["draft", "suspended"]);

async function load(id: string): Promise<EditorCampaign> {
  const c = await brevoGet<Raw>(`/emailCampaigns/${id}`);
  return {
    id: c.id,
    name: c.name,
    subject: c.subject ?? "",
    previewText: c.previewText ?? "",
    status: c.status,
    senderId: typeof c.sender?.id === "number" ? c.sender.id : c.sender?.id != null ? Number(c.sender.id) : null,
    senderEmail: c.sender?.email ?? "",
    replyTo: c.replyTo ?? "",
    htmlContent: c.htmlContent ?? "",
    tag: c.tag ?? "",
    utmCampaign: c.utmCampaign ?? "",
    modifiedAt: c.modifiedAt ?? null,
    scheduledAt: c.scheduledAt || null,
    listIds: c.recipients?.lists ?? [],
    exclusionListIds: c.recipients?.exclusionLists ?? [],
    segmentIds: c.recipients?.segments ?? [],
  };
}

function fail(e: unknown) {
  if (e instanceof BrevoError) return NextResponse.json({ ok: false, error: `Brevo: ${e.message}` }, { status: e.notFound ? 404 : 502 });
  console.error("[brevo/campaigns/:id/editor]", e);
  return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  try {
    return NextResponse.json(await load(id));
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  const parsed = validateEmailDraft((await req.json().catch(() => ({}))) ?? {}, true);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: "Fix these first", errors: parsed.errors }, { status: 400 });
  try {
    const current = await load(id);
    if (!EDITABLE.has(current.status)) return NextResponse.json({ ok: false, error: `Can't edit a "${current.status}" campaign. Suspend it first.` }, { status: 409 });
    await brevo("PUT", `/emailCampaigns/${id}`, parsed.draft);
    await recordAudit({ action: "brevo.email_campaign_update", entityType: "brevo_email_campaign", entityId: id, summary: Object.keys(parsed.draft).join(", "), actor: gate.user, request: req });
    return NextResponse.json({ ok: true, campaign: await load(id) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  try {
    const current = await load(id);
    if (current.status !== "draft") return NextResponse.json({ ok: false, error: "Only drafts can be deleted. Archive sent campaigns instead." }, { status: 409 });
    await brevo("DELETE", `/emailCampaigns/${id}`);
    await recordAudit({ action: "brevo.email_campaign_delete", entityType: "brevo_email_campaign", entityId: id, summary: current.name, actor: gate.user, request: req });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
