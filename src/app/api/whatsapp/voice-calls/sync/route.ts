import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { clampOutcome, fetchTranscript, listAttempts, sarvamVoiceConfigured, type TranscriptTurn } from "@/lib/sarvam-voice";

export const dynamic = "force-dynamic";

// Backfills voice_calls from Sarvam's analytics API. This exists because
// Sarvam's post-call webhook is not currently being delivered to us (six live
// test calls, zero webhooks) — every row otherwise sits on 'dialing' forever
// with no outcome, duration, transcript or disposition even though the call
// really happened. This is a read-only reconciliation (see src/lib/sarvam-voice.ts
// for why calling Sarvam directly from Next.js is the intended exception here).
//
// Session-gated by middleware like every other /api/* route (no extra gate).
const MAX_HOURS = 168;
const DEFAULT_HOURS = 24;
const FETCH_LIMIT = 500;

type SyncResult = { scanned: number; matched: number; updated: number; dndFlagged: number; unmatched: number };

type CallRow = {
  id: string;
  attempt_id: string | null;
  wa_id: string;
  status: string;
  interaction_id: string | null;
  transcript: TranscriptTurn[] | null;
};

export async function POST(req: NextRequest) {
  if (!sarvamVoiceConfigured()) {
    return NextResponse.json(
      { error: "Sarvam voice analytics not configured (need SARVAM_ORG_ID, SARVAM_WORKSPACE_ID, SARVAM_APP_ID and SARVAM_VOICE_API_KEY/SARVAM_API_KEY)" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { hours?: number };
  const hours = Math.min(MAX_HOURS, Math.max(1, Number(body?.hours) || DEFAULT_HOURS));
  const until = new Date();
  const since = new Date(until.getTime() - hours * 3600_000);

  const attempts = await listAttempts(since.toISOString(), until.toISOString(), FETCH_LIMIT);

  const result: SyncResult = { scanned: attempts.length, matched: 0, updated: 0, dndFlagged: 0, unmatched: 0 };
  if (attempts.length === 0) return NextResponse.json(result);

  const attemptIds = attempts.map((a) => a.attemptId).filter(Boolean);
  const { data: rows, error } = await supabaseAdmin
    .from("voice_calls")
    .select("id, attempt_id, wa_id, status, interaction_id, transcript")
    .in("attempt_id", attemptIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byAttempt = new Map<string, CallRow>();
  for (const r of (rows ?? []) as CallRow[]) {
    if (r.attempt_id) byAttempt.set(r.attempt_id, r);
  }

  const now = new Date().toISOString();
  const dndWaIds = new Set<string>();

  for (const a of attempts) {
    const row = byAttempt.get(a.attemptId);
    if (!row) {
      result.unmatched++;
      continue;
    }
    result.matched++;

    // The safety-critical guard: a row the real webhook already finalised
    // (or a previous sync already finalised) must never be overwritten. Only
    // a row still sitting on 'dialing' or 'unknown' is fair game.
    if (row.status !== "dialing" && row.status !== "unknown") continue;

    const outcome = clampOutcome(a.agentVariables?.call_disposition);

    let transcript = row.transcript;
    if (!transcript && a.interactionId) {
      const fetched = await fetchTranscript(a.interactionId);
      if (fetched.length) transcript = fetched;
    }

    // Compare-and-swap on status again at write time (not just at read time
    // above): if the real webhook lands in the gap between our SELECT and
    // this UPDATE, the WHERE clause makes this a no-op instead of a
    // last-write-wins clobber of the true verdict.
    const { data: updated } = await supabaseAdmin
      .from("voice_calls")
      .update({
        status: a.status,
        duration_s: a.durationSeconds != null ? Math.round(a.durationSeconds) : null,
        interaction_id: a.interactionId,
        failure_reason: a.failureReason,
        agent_vars: a.agentVariables,
        outcome,
        transcript,
        updated_at: now,
      })
      .eq("id", row.id)
      .in("status", ["dialing", "unknown"])
      .select("id");

    if (updated?.length) {
      result.updated++;
      // With webhooks down, this sync is currently the ONLY path a
      // do-not-call request can reach us through — never skip this.
      if (outcome === "do_not_call") dndWaIds.add(row.wa_id);
    }
  }

  if (dndWaIds.size) {
    await supabaseAdmin
      .from("wa_contacts")
      .update({ voice_dnd: true, updated_at: now })
      .in("wa_id", Array.from(dndWaIds));
    result.dndFlagged = dndWaIds.size;
  }

  return NextResponse.json(result);
}
