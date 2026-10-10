import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { invokeAiVisibilityTick, jsonError } from "@/lib/orm/db";
import { isLive, type AiVisRunRow } from "@/lib/orm/ai-visibility";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/orm/ai-visibility/run (admin only): start an AI visibility run now
// (edge ai-visibility-tick {trigger:'manual'}). Refuses with 409 while a run
// is going; the edge lock (one 'running' row, unique index) is the real guard,
// this check just gives a friendly answer without a round trip. Costs about
// $0.30 to $0.60 of OpenAI usage per run; it never messages anyone.
export async function POST() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { data, error } = await supabaseAdmin
    .from("ai_visibility_runs")
    .select("id, status, started_at, heartbeat_at")
    .eq("status", "running")
    .limit(1);
  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205";
    return jsonError(missing ? "AI visibility is not set up yet. Apply migration 20261010130000_ai_visibility.sql first." : error.message, missing ? 503 : 500);
  }
  const running = (data ?? [])[0] as Pick<AiVisRunRow, "id" | "status" | "started_at" | "heartbeat_at"> | undefined;
  if (running && isLive(running)) {
    return NextResponse.json(
      { ok: false, busy: true, run_id: running.id, started_at: running.started_at, error: "A run is already going. Wait for it to finish." },
      { status: 409 },
    );
  }

  const r = await invokeAiVisibilityTick(gate.user.email ?? null);
  console.info("ai_visibility_run", { by: gate.user.email, status: r.status, ok: r.ok });
  if (r.status === 409 || r.data.busy) {
    return NextResponse.json({ ok: false, busy: true, ...r.data, error: "A run is already going. Wait for it to finish." }, { status: 409 });
  }
  if (r.ok && r.data.skipped === "no_active_prompts") {
    return jsonError("There are no active questions to ask.", 409);
  }
  return NextResponse.json({ ok: r.ok, ...r.data }, { status: r.ok ? 200 : r.status >= 400 ? r.status : 502 });
}
