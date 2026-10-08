import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, listSources, requireUser } from "@/lib/orm/db";
import { buildSummary, fetchSince, parseDays, SUMMARY_COLUMNS, type SnapshotRow, type SummaryRow } from "@/lib/orm/summary";

export const dynamic = "force-dynamic";

const PAGE = 1000; // PostgREST caps a response at 1000 rows
const MAX_PAGES = 20;

async function readMentions(since: string): Promise<{ data: SummaryRow[]; error: string | null }> {
  const out: SummaryRow[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await supabaseAdmin
      .from("orm_mentions")
      .select(SUMMARY_COLUMNS)
      .not("relevant", "is", false)
      .or(`posted_at.gte.${since},and(posted_at.is.null,collected_at.gte.${since})`)
      .order("id", { ascending: true })
      .range(p * PAGE, p * PAGE + PAGE - 1);
    if (error) return { data: out, error: error.message };
    out.push(...((data ?? []) as unknown as SummaryRow[]));
    if (!data || data.length < PAGE) break;
  }
  return { data: out, error: null };
}

// GET /api/orm/summary?days=7|30|90 (default 30). Relevant mentions only.
// Reads back far enough for the previous period (score_prev, product trend)
// and the last 12 IST weeks (score_weekly, channel weekly ratings).
export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const days = parseDays(req.nextUrl.searchParams.get("days"));
  const now = Date.now();
  const since = fetchSince(days, now).toISOString();
  try {
    const [rows, sources, snaps] = await Promise.all([
      readMentions(since),
      listSources(),
      supabaseAdmin
        .from("orm_competitor_snapshots")
        .select("asin, brand, label, is_ours, rating, review_count, price_inr, taken_on")
        .gte("taken_on", new Date(now - 120 * 86_400_000).toISOString().slice(0, 10))
        .order("taken_on", { ascending: false })
        .limit(500),
    ]);
    if (rows.error) return jsonError(rows.error, 500);
    // Competitor snapshots are optional: a read error leaves the block out.
    if (snaps.error) console.warn("orm_summary_snapshots_failed", snaps.error.message);
    return NextResponse.json(
      buildSummary(
        rows.data,
        sources,
        days,
        now,
        (snaps.error ? [] : (snaps.data ?? [])) as SnapshotRow[],
      ),
    );
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e), 500);
  }
}
