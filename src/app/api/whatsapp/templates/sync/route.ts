import { NextResponse } from "next/server";
import { callTemplateFn } from "@/lib/whatsapp/template-edge";

// Pull every template from Meta and mirror its real status, category,
// quality rating and rejection reason into wa_templates (also re-hosts header
// media for templates created in WhatsApp Manager). pg_cron runs the same
// sync every 15 minutes while anything is in review (wa-template-sync).

export async function POST() {
  const { status, data } = await callTemplateFn({ action: "sync" });
  return NextResponse.json(data, { status });
}
