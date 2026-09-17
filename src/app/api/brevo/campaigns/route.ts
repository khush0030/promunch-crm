import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";
import { validateEmailDraft } from "@/lib/brevo-send-guard";
import { brevo, BrevoError, listEmailCampaigns } from "@/lib/brevo";
import { summarize, sortRows, toRow, type CampaignsResponse } from "@/lib/brevo-campaigns";

// Brevo email campaign stats for Marketing > Email (Brevo). Read-only proxy so
// the API key never reaches the browser. Middleware gates /api/*, so no auth
// code here.
//
// GET  /api/brevo/campaigns[?fresh=1]
// POST /api/brevo/campaigns  (admin) create a draft; never sends
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5 * 60_000;
let cache: { at: number; body: CampaignsResponse } | null = null;

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.body, { headers: { "x-cache": "hit" } });
  }
  try {
    const campaigns = await listEmailCampaigns();
    const now = new Date();
    const body: CampaignsResponse = {
      summary: summarize(campaigns, now),
      campaigns: sortRows(campaigns.map(toRow)),
      fetchedAt: now.toISOString(),
    };
    cache = { at: Date.now(), body };
    return NextResponse.json(body, { headers: { "x-cache": "miss" } });
  } catch (e) {
    console.error("[brevo/campaigns]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "brevo campaigns failed" },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const parsed = validateEmailDraft((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.ok) return NextResponse.json({ ok: false, error: "Fix these first", errors: parsed.errors }, { status: 400 });
  try {
    // No scheduledAt here on purpose: a new campaign is always a draft.
    const r = await brevo<{ id: number }>("POST", "/emailCampaigns", parsed.draft);
    cache = null;
    await recordAudit({ action: "brevo.email_campaign_create", entityType: "brevo_email_campaign", entityId: String(r.id), summary: parsed.draft.name, actor: gate.user, request: req });
    return NextResponse.json({ ok: true, id: r.id });
  } catch (e) {
    console.error("[brevo/campaigns] create", e);
    const msg = e instanceof BrevoError ? `Brevo: ${e.message}` : e instanceof Error ? e.message : "create failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
