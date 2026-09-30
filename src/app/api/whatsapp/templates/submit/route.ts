import { NextRequest, NextResponse } from "next/server";
import { tagUrlForWhatsApp } from "@/lib/utm";
import { parseBody } from "@/lib/api-helpers";
import { validateTemplate } from "@/lib/whatsapp/template-rules";
import { callTemplateFn } from "@/lib/whatsapp/template-edge";
import { templateChangeRefusal } from "@/lib/whatsapp/template-access";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getCaller } from "@/lib/rbac-server";
import { isAdminUser } from "@/lib/rbac";

// Submit a template to Meta for approval (via the wa-template-create edge
// function). Meta — not this dashboard — owns the template's real status;
// the function mirrors that status back into wa_templates.
//
// Body: the builder's template payload. `mode: "edit"` resubmits an existing
// template (rejected, paused or approved) through Meta's edit endpoint
// instead of creating a new one (which Meta refuses as a duplicate name).
//
// Validated here with the builder's rules AND again in the edge function
// (_shared/template-rules.ts). Failures: 400 { ok:false, error, issues }.

type Btn = { type?: string; url?: string } & Record<string, unknown>;

export async function POST(req: NextRequest) {
  const template = await parseBody<{ name?: string; buttons?: unknown; mode?: string } & Record<string, unknown>>(req);
  if (!template) return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  const mode = template.mode === "edit" ? "edit" : "create";
  delete template.mode;

  // Editing a live template: automatic (utility) messages go to every
  // customer, so only the Owner/Admin may resubmit them; team alerts are
  // never changed from here. Classified by the STORED row and the incoming
  // body, strictest wins (a body can't relabel itself as marketing).
  if (mode === "edit") {
    const name = String(template.name ?? "");
    const language = String(template.language ?? "en");
    const { data: row, error: rowErr } = await supabaseAdmin
      .from("wa_templates").select("name, category").eq("name", name).eq("language", language).maybeSingle();
    if (rowErr) return NextResponse.json({ ok: false, error: rowErr.message }, { status: 500 });
    const refusal = templateChangeRefusal(
      [row, { name, category: template.category as string | null }],
      isAdminUser(await getCaller()),
    );
    if (refusal) return NextResponse.json({ ok: false, error: refusal }, { status: 403 });
  }

  const { errors } = validateTemplate({
    name: template.name,
    language: template.language as string,
    category: template.category as string,
    header_type: (template.header_format as string) ?? (template.header_text ? "TEXT" : null),
    header_text: template.header_text as string,
    header_media_url: template.header_media_url as string,
    body: template.body as string,
    footer: template.footer as string,
    buttons: Array.isArray(template.buttons) ? (template.buttons as Btn[]) : [],
    body_samples: Array.isArray(template.body_samples) ? (template.body_samples as string[]) : [],
    header_samples: Array.isArray(template.header_samples) ? (template.header_samples as string[]) : [],
  });
  if (errors.length) {
    return NextResponse.json({ ok: false, error: errors[0].message, issues: errors }, { status: 400 });
  }

  // Tag our-store button URLs with utm_source=whatsapp before the template is
  // frozen at Meta — static buttons can't be changed per send, so this is the
  // only point where campaign-driven orders can pick up WhatsApp attribution.
  if (Array.isArray(template.buttons)) {
    template.buttons = (template.buttons as Btn[]).map((b) =>
      (b?.type ?? "").toUpperCase() === "URL" && typeof b.url === "string"
        ? { ...b, url: tagUrlForWhatsApp(b.url, { medium: "template_button", campaign: template.name }) }
        : b,
    );
  }
  const { status, data } = await callTemplateFn(
    mode === "edit" ? { action: "edit", template } : { action: "create", template },
  );
  return NextResponse.json(data, { status });
}
