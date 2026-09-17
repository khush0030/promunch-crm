import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";
import { brevo, BrevoError, listAll } from "@/lib/brevo";
import { getBrevoSettings } from "@/lib/brevo-settings";
import { copyProblems, visibleText } from "@/lib/brevo-send-guard";

// Brevo email templates (used by transactional sends and automations).
//   GET  -> all templates
//   POST {action: "create"|"update"|"test"|"delete", ...} (admin)
// Tests go only to brevo_settings.test_emails.
export const dynamic = "force-dynamic";

export type BrevoTemplate = {
  id: number;
  name: string;
  subject: string;
  isActive: boolean;
  testSent: boolean;
  sender: { name?: string; email?: string; id?: string | number };
  replyTo: string;
  tag: string;
  htmlContent: string;
  createdAt: string;
  modifiedAt: string;
};

export async function GET() {
  try {
    const templates = await listAll<BrevoTemplate>("/smtp/templates?sort=desc", "templates", 50);
    return NextResponse.json({ templates });
  } catch (e) {
    console.error("[brevo/templates]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "templates failed" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const id = Number.isInteger(b.id) ? (b.id as number) : null;
  const audit = (action: string, summary: string) =>
    recordAudit({ action: `brevo.template_${action}`, entityType: "brevo_template", entityId: id ? String(id) : undefined, summary, actor: gate.user, request: req });

  try {
    switch (b.action) {
      case "create":
      case "update": {
        const name = typeof b.name === "string" ? b.name.trim() : "";
        const subject = typeof b.subject === "string" ? b.subject.trim() : "";
        const htmlContent = typeof b.htmlContent === "string" ? b.htmlContent : "";
        const errors: string[] = [];
        if (b.action === "update" && !id) errors.push("id is required");
        if (!name) errors.push("name is required");
        if (!subject) errors.push("subject is required");
        if (htmlContent.trim().length < 10) errors.push("HTML content is required");
        if (!Number.isInteger(b.senderId)) errors.push("pick a sender");
        for (const p of copyProblems(visibleText(subject))) errors.push(`subject ${p}`);
        for (const p of copyProblems(visibleText(htmlContent))) errors.push(`body ${p}`);
        if (errors.length) return NextResponse.json({ ok: false, error: "Fix these first", errors }, { status: 400 });
        const payload = {
          templateName: name,
          subject,
          htmlContent,
          sender: { id: b.senderId },
          ...(typeof b.replyTo === "string" && b.replyTo.trim() ? { replyTo: b.replyTo.trim() } : {}),
          ...(typeof b.tag === "string" && b.tag.trim() ? { tag: b.tag.trim() } : {}),
          isActive: b.isActive !== false,
        };
        if (b.action === "create") {
          const r = await brevo<{ id: number }>("POST", "/smtp/templates", payload);
          await audit("create", name);
          return NextResponse.json({ ok: true, id: r.id });
        }
        await brevo("PUT", `/smtp/templates/${id}`, payload);
        await audit("update", name);
        return NextResponse.json({ ok: true, id });
      }
      case "test": {
        if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
        const s = await getBrevoSettings();
        await brevo("POST", `/smtp/templates/${id}/sendTest`, { emailTo: s.test_emails });
        await audit("test", s.test_emails.join(", "));
        return NextResponse.json({ ok: true, sentTo: s.test_emails });
      }
      case "delete": {
        if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
        await brevo("DELETE", `/smtp/templates/${id}`);
        await audit("delete", String(id));
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ ok: false, error: "action must be create, update, test or delete" }, { status: 400 });
    }
  } catch (e) {
    console.error("[brevo/templates] action", b.action, e);
    const msg = e instanceof BrevoError ? `Brevo: ${e.message}` : e instanceof Error ? e.message : "failed";
    return NextResponse.json({ ok: false, error: msg }, { status: e instanceof BrevoError && e.status < 500 ? 422 : 502 });
  }
}
