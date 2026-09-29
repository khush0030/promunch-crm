import { NextRequest, NextResponse } from "next/server";
import { parseBody } from "@/lib/api-helpers";
import { basicInputErrors } from "@/lib/wa-campaigns";

export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// POST /api/whatsapp/campaigns/test-send
//   { to: "9198…", campaign_id }                       test a saved campaign
//   { to, draft: { template_id, template_vars, header_media_url?, name? } }
//   optional test_name: the name used for {name} / AI personalisation
// -> 200 { ok:true, message_id, components, ... } | 4xx/502 { ok:false, error, error_class, explanation }
//
// Built by wa-campaign-send with the exact component builder the real send
// uses (header media override, header text, dynamic buttons, UTM, AI). It does
// NOT create or opt in a WhatsApp contact, writes no campaign ledger row and no
// claims, so a test can never block or pre-empt the real campaign.
export async function POST(req: NextRequest) {
  const body = await parseBody<{
    to?: string;
    campaign_id?: string;
    test_name?: string;
    draft?: { template_id?: string; template_vars?: Record<string, unknown>; header_media_url?: string | null; name?: string };
  }>(req);
  if (!body) return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  const to = String(body.to ?? "").replace(/\D/g, "");
  if (to.length < 10) return NextResponse.json({ ok: false, error: "Enter a full phone number with country code." }, { status: 400 });
  if (!body.campaign_id && !body.draft?.template_id) {
    return NextResponse.json({ ok: false, error: "campaign_id or draft.template_id required" }, { status: 400 });
  }
  if (body.draft) {
    const errs = basicInputErrors({ template_vars: body.draft.template_vars ?? {}, header_media_url: body.draft.header_media_url ?? null });
    if (errs.length) return NextResponse.json({ ok: false, error: errs.join("; "), errors: errs }, { status: 400 });
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-campaign-send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        test_to: to,
        campaign_id: body.campaign_id ?? undefined,
        draft: body.campaign_id ? undefined : body.draft,
        test_name: body.test_name ?? undefined,
      }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: `engine HTTP ${res.status}` }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
