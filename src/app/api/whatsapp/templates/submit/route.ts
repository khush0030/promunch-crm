import { NextRequest, NextResponse } from "next/server";
import { tagUrlForWhatsApp } from "@/lib/utm";

// Submit a template to Meta for approval (via the wa-template-create edge
// function). Meta — not this dashboard — owns the template's real status;
// the function mirrors that status back into wa_templates.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type Btn = { type?: string; url?: string } & Record<string, unknown>;

export async function POST(req: NextRequest) {
  const template = await req.json();
  // Tag our-store button URLs with utm_source=whatsapp before the template is
  // frozen at Meta — static buttons can't be changed per send, so this is the
  // only point where campaign-driven orders can pick up WhatsApp attribution.
  if (Array.isArray(template?.buttons)) {
    template.buttons = (template.buttons as Btn[]).map((b) =>
      (b?.type ?? "").toUpperCase() === "URL" && typeof b.url === "string"
        ? { ...b, url: tagUrlForWhatsApp(b.url, { medium: "template_button", campaign: template.name }) }
        : b,
    );
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-template-create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ template }),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
