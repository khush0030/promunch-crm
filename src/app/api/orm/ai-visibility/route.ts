import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, requireUser } from "@/lib/orm/db";
import {
  buildAiVisibilitySummary,
  finishedRuns,
  isLive,
  PROMPT_COLUMNS,
  RESULT_COLUMNS,
  RUN_COLUMNS,
  type AiVisPromptRow,
  type AiVisResultRow,
  type AiVisRunRow,
} from "@/lib/orm/ai-visibility";

export const dynamic = "force-dynamic";

const RUNS_READ = 40; // enough for 12 finished runs plus failed ones and a live one

/** Missing table (migration not applied yet): 42P01 from Postgres, PGRST205 from PostgREST. */
const missingTable = (e: { code?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205");
const NOT_SET_UP = "AI visibility is not set up yet. Apply migration 20261010130000_ai_visibility.sql first.";

// GET /api/orm/ai-visibility: latest finished run (share of shopping answers
// naming PROMUNCH, per-question results, brands named), the live run's
// progress, and the trend across the last 12 finished runs.
// Spec: docs/plans/2026-10-10-ai-visibility-phase2/AI_VISIBILITY_TRACKER.md.
export async function GET() {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  try {
    const now = Date.now();
    const [runsQ, promptsQ] = await Promise.all([
      supabaseAdmin.from("ai_visibility_runs").select(RUN_COLUMNS).order("started_at", { ascending: false }).limit(RUNS_READ),
      supabaseAdmin.from("ai_visibility_prompts").select(PROMPT_COLUMNS).order("sort", { ascending: true }),
    ]);
    if (missingTable(runsQ.error) || missingTable(promptsQ.error)) return jsonError(NOT_SET_UP, 503);
    if (runsQ.error) return jsonError(runsQ.error.message, 500);
    if (promptsQ.error) return jsonError(promptsQ.error.message, 500);
    const runs = (runsQ.data ?? []) as unknown as AiVisRunRow[];

    const last = finishedRuns(runs)[0];
    const live = runs.find((r) => isLive(r, now));
    const [resultsQ, liveQ] = await Promise.all([
      last
        ? supabaseAdmin.from("ai_visibility_results").select(RESULT_COLUMNS).eq("run_id", last.id).limit(200)
        : Promise.resolve({ data: [], error: null }),
      live
        ? supabaseAdmin.from("ai_visibility_results").select("id", { count: "exact", head: true }).eq("run_id", live.id)
        : Promise.resolve({ count: 0, error: null }),
    ]);
    if (resultsQ.error) return jsonError(resultsQ.error.message, 500);

    return NextResponse.json(
      buildAiVisibilitySummary({
        runs,
        results: (resultsQ.data ?? []) as unknown as AiVisResultRow[],
        prompts: (promptsQ.data ?? []) as unknown as AiVisPromptRow[],
        running_done: "count" in liveQ ? (liveQ.count ?? 0) : 0,
        now,
      }),
    );
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e), 500);
  }
}
