import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { orderJourney, TERMINAL_STATUSES, type JourneyRow } from "@/lib/wa-campaigns";
import { descendants, journeyRoot, TEMPLATE_JOIN } from "@/lib/wa-campaign-journeys";
import { loadCampaignAttribution } from "@/lib/whatsapp/campaign-attribution";

export const dynamic = "force-dynamic";

// GET /api/whatsapp/campaigns/[id]/journey
//   -> { root_id, steps: [ { ...campaign row (all columns incl. counters
//        sent/delivered/read/replied/clicked_count, followup_*), template: {...},
//        depth, parent_id, eligible_now, waiting_for_time, next_eligible_at,
//        ordered_count } ] }
// The whole journey containing [id] (root + every follow-up), parent first,
// siblings oldest first. For the root, eligible_now / next_eligible_at are
// null and waiting_for_time 0 (it has no per-person timing). For a finished
// (completed / cancelled / failed) follow-up the same. ordered_count = orders
// the step earned under the shared 7-day last-touch rule, the exact number the
// campaign report's Orders tile shows (src/lib/whatsapp/campaign-attribution).
// The "Thank people who ordered" follow-up audience still uses the engine's
// own SQL rule (wa_campaign_ordered_count); that is targeting, not reporting.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const root = await journeyRoot(id);
    if (!root) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    const ids = [root.id, ...(await descendants(root.id, "id")).map((d) => d.id)];
    const { data, error } = await supabaseAdmin.from("wa_campaigns").select(TEMPLATE_JOIN).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const ordered = orderJourney((data ?? []) as unknown as JourneyRow[], root.id);
    const earliest = (data ?? [])
      .map((r) => String((r as { created_at?: string }).created_at ?? ""))
      .filter(Boolean)
      .sort()[0];
    const earned = earliest ? await loadCampaignAttribution(earliest) : new Map();

    const steps = await Promise.all(ordered.map(async (s) => {
      const row = s.row as JourneyRow & { status: string; audience_filter?: unknown };
      const isLiveFollowup = !!row.followup_of && !TERMINAL_STATUSES.includes(row.status);
      let eligible_now: number | null = null;
      let waiting_for_time = 0;
      let next_eligible_at: string | null = null;
      if (isLiveFollowup) {
        const { data: c } = await supabaseAdmin.rpc("wa_campaign_audience_counts", {
          p_filter: row.audience_filter ?? {},
          p_campaign_id: row.id,
        });
        const counts = (c ?? {}) as Record<string, unknown>;
        eligible_now = typeof counts.eligible === "number" ? counts.eligible : null;
        waiting_for_time = typeof counts.waiting_for_time === "number" ? counts.waiting_for_time : 0;
        next_eligible_at = typeof counts.next_eligible_at === "string" ? counts.next_eligible_at : null;
      }
      return {
        ...row,
        depth: s.depth,
        parent_id: s.parent_id,
        eligible_now,
        waiting_for_time,
        next_eligible_at,
        ordered_count: earned.get(row.id)?.orders ?? 0,
      };
    }));
    return NextResponse.json({ root_id: root.id, steps });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
