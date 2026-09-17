import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { requireSecretsOwner } from "@/lib/secrets";
import { recordAudit } from "@/lib/audit";
import { brevo, brevoGet, BrevoError, section, type Section } from "@/lib/brevo";
import { getBrevoSettings } from "@/lib/brevo-settings";
import { validateSmsDraft } from "@/lib/brevo-sms";

// Brevo SMS.
//   GET  -> SMS campaigns + whether SMS is enabled
//   POST {action: "create", ...draft}          (admin) new SMS campaign draft, never sends
//   POST {action: "test_transactional", phoneNumber, sender, content} (owner, needs sms_enabled)
// Sending SMS campaigns goes through /api/brevo/sms/[id]/actions (same guard as email).
export const dynamic = "force-dynamic";

export type SmsCampaign = {
  id: number;
  name: string;
  status: string;
  content: string;
  sender: string;
  scheduledAt?: string;
  createdAt: string;
  modifiedAt: string;
  sentDate?: string;
  recipients?: { lists?: number[]; exclusionLists?: number[] };
  statistics?: { delivered?: number; sent?: number; processing?: number; softBounces?: number; hardBounces?: number; unsubscriptions?: number; answered?: number };
};

export type SmsResponse = { enabled: boolean; campaigns: Section<SmsCampaign[]> };

export async function GET() {
  const [settings, campaigns] = await Promise.all([
    getBrevoSettings(),
    section(brevoGet<{ campaigns?: SmsCampaign[] }>("/smsCampaigns?limit=100&sort=desc").then((r) => r.campaigns ?? [])),
  ]);
  const body: SmsResponse = { enabled: settings.sms_enabled, campaigns };
  return NextResponse.json(body);
}

export async function POST(req: NextRequest) {
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    if (b.action === "create") {
      const gate = await requireAdmin();
      if (!gate.ok) return gate.response;
      const parsed = validateSmsDraft(b);
      if (!parsed.ok) return NextResponse.json({ ok: false, error: "Fix these first", errors: parsed.errors }, { status: 400 });
      const r = await brevo<{ id: number }>("POST", "/smsCampaigns", parsed.draft);
      await recordAudit({ action: "brevo.sms_campaign_create", entityType: "brevo_sms_campaign", entityId: String(r.id), summary: parsed.draft.name, actor: gate.user, request: req });
      return NextResponse.json({ ok: true, id: r.id });
    }
    if (b.action === "test_transactional") {
      const gate = await requireSecretsOwner();
      if (!gate.ok) return gate.response;
      const settings = await getBrevoSettings();
      if (!settings.sms_enabled) return NextResponse.json({ ok: false, error: "SMS is switched off. Turn it on in the SMS tab once DLT registration is done." }, { status: 409 });
      const phone = String(b.phoneNumber ?? "").replace(/\D/g, "");
      if (!/^91\d{10}$/.test(phone)) return NextResponse.json({ ok: false, error: "phoneNumber must be 91XXXXXXXXXX" }, { status: 400 });
      const parsed = validateSmsDraft({ name: "test", sender: b.sender, content: b.content, unsubscribeInstruction: "Reply STOP to opt out" });
      if (!parsed.ok) return NextResponse.json({ ok: false, error: "Fix these first", errors: parsed.errors }, { status: 400 });
      const r = await brevo<{ messageId: number }>("POST", "/transactionalSMS/send", {
        sender: parsed.draft.sender,
        recipient: phone,
        content: parsed.draft.content,
        type: "transactional",
        tag: "crm-test",
      });
      await recordAudit({ action: "brevo.sms_test_transactional", entityType: "brevo_sms", summary: `test to ${phone}`, actor: gate.user, request: req });
      return NextResponse.json({ ok: true, messageId: r.messageId });
    }
    return NextResponse.json({ ok: false, error: "action must be create or test_transactional" }, { status: 400 });
  } catch (e) {
    console.error("[brevo/sms]", b.action, e);
    const msg = e instanceof BrevoError ? `Brevo: ${e.message}` : e instanceof Error ? e.message : "failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
