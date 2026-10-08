import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, listSources, requireUser } from "@/lib/orm/db";
import { buildSummary, parseDays, windowStart, type SummaryRow } from "@/lib/orm/summary";

export const dynamic = "force-dynamic";

// GET /api/orm/summary?days=7|30|90 (default 30). Relevant mentions only.
export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const days = parseDays(req.nextUrl.searchParams.get("days"));
  const now = Date.now();
  const since = windowStart(days, now).toISOString();
  try {
    const [rows, sources] = await Promise.all([
      supabaseAdmin
        .from("orm_mentions")
        .select("source, rating, sentiment, topics, status, posted_at, collected_at")
        .not("relevant", "is", false)
        .or(`posted_at.gte.${since},and(posted_at.is.null,collected_at.gte.${since})`)
        .limit(10000),
      listSources(),
    ]);
    if (rows.error) return jsonError(rows.error.message, 500);
    return NextResponse.json(buildSummary((rows.data ?? []) as SummaryRow[], sources, days, now));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e), 500);
  }
}
