import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { etaDays, normalizeAudienceFilter } from "@/lib/wa-campaigns";
import { warmAudienceError } from "@/lib/wa-warm-guard";
import { GET as quotaGet } from "../../quota/route";

export const dynamic = "force-dynamic";

// POST /api/whatsapp/campaigns/audience-preview
//   { audience_filter, campaign_id? }
//   -> { counts: { total_matched, excluded_suppressed, already_reached,
//                  excluded_ticket, excluded_cart, excluded_governor,
//                  excluded_daily_claim, eligible_total, eligible },
//        budget: { limit, used24h, remaining_today, non_campaign_24h },
//        eta_days }
//
// Counts come from wa_campaign_audience_counts(), the SAME SQL definition the
// engine sends to (wa_campaign_audience), so the preview can't drift from what
// actually goes out. `eligible` = sendable right now; `eligible_total` also
// includes people temporarily held (open ticket, live cart, marketing
// frequency limit, already messaged by another campaign today), who are sent
// to later, not dropped. The ETA uses eligible_total against the real daily
// budget left after utility/journey traffic.
export async function POST(req: NextRequest) {
  const body = await parseBody<{ audience_filter?: unknown; campaign_id?: string | null }>(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  const aud = normalizeAudienceFilter(body.audience_filter ?? {});
  if (!aud.ok) return NextResponse.json({ error: aud.error }, { status: 400 });
  const warmErr = await warmAudienceError(aud.filter);
  if (warmErr) return NextResponse.json({ error: warmErr }, { status: 409 });

  const { data: counts, error } = await supabaseAdmin.rpc("wa_campaign_audience_counts", {
    p_filter: aud.filter,
    p_campaign_id: body.campaign_id ?? null,
  });
  if (error) {
    const pending = /wa_campaign_audience_counts|function .* does not exist/i.test(error.message);
    return NextResponse.json(
      { error: pending ? "Audience preview needs migration 20260929120100_wa_campaign_engine_v2.sql" : error.message },
      { status: 500 },
    );
  }

  // Daily budget (Meta tier / operator limit) + today's usage.
  let limit: number | null = null;
  let used24h = 0;
  try {
    const q = await (await quotaGet()).json();
    limit = typeof q?.limit === "number" ? q.limit : null;
    used24h = typeof q?.used24h === "number" ? q.used24h : 0;
  } catch { /* budget unknown → no ETA */ }

  // Unique contacts reached in the last 24h by NON-campaign templates
  // (order confirmations, shipping, journeys) — that share of the budget is
  // not available to campaigns tomorrow either.
  const sinceIso = new Date(Date.now() - 24 * 3600_000).toISOString();
  const nonCampaign = new Set<string>();
  const campaignTouched = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await supabaseAdmin
      .from("wa_messages")
      .select("contact_id,campaign_id")
      .eq("direction", "outbound")
      .not("template_name", "is", null)
      .in("status", ["queued", "sent", "delivered", "read"])
      .gte("created_at", sinceIso)
      .range(from, from + 999);
    if (e || !data?.length) break;
    for (const r of data as { contact_id: string | null; campaign_id: string | null }[]) {
      if (!r.contact_id) continue;
      if (r.campaign_id) campaignTouched.add(r.contact_id);
      else nonCampaign.add(r.contact_id);
    }
    if (data.length < 1000) break;
  }
  for (const id of campaignTouched) nonCampaign.delete(id);

  const c = counts as Record<string, number>;
  return NextResponse.json({
    filter: aud.filter,
    counts: c,
    budget: {
      limit,
      used24h,
      remaining_today: limit != null ? Math.max(0, limit - used24h) : null,
      non_campaign_24h: nonCampaign.size,
    },
    eta_days: etaDays(c.eligible_total ?? 0, limit, used24h, nonCampaign.size),
  });
}
