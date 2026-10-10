// deno-lint-ignore-file no-explicit-any -- DB rows are untyped
// AI visibility tracker (weekly cron + admin "Run now").
// Spec: docs/plans/2026-10-10-ai-visibility-phase2/AI_VISIBILITY_TRACKER.md.
//
// Asks an AI assistant the shopping questions in ai_visibility_prompts (OpenAI
// Responses API with the built-in web_search tool, user location India) and
// records, per answer, whether PROMUNCH is named, at what position, which
// other brands are named and which pages were cited. Brand matching is
// deterministic string matching (_shared/ai-visibility.ts), not a model.
//
//   POST {"trigger":"cron"|"manual","by":"<email>"}
//       → take the run lock (one ai_visibility_runs row with status
//         'running'; a unique partial index makes a second one fail) and
//         answer 200 at once; the prompts run in the background.
//       → 409 {busy:true} when a run is already going.
//   POST {"run_id":"…","_continue":true,"hop":n}
//       → self-chain: carry on with the prompts this run has not answered.
//
// Budget: at most AI_VISIBILITY_MAX_PROMPTS prompts per run (default 25, hard
// max 50), each one OpenAI call with a 55 s timeout, AI_VISIBILITY_CONCURRENCY
// at a time (default 3). An invocation stops starting new prompts after 75 s
// (edge wall clock) and chains itself, at most MAX_HOPS times. A run whose
// heartbeat is older than 10 minutes is treated as dead and closed.
//
// A failed answer (HTTP error, web search error, timeout) is stored on its
// row with the error and the run carries on. Nothing here messages anyone.
//
// Auth: requireInternal (pg_cron sends the Vault service_role_key bearer; the
// Next.js route sends SUPABASE_SERVICE_ROLE_KEY).
// Schedule: migrations/20261010130100_ai_visibility_tick_cron.sql.

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { errStr, logConnector } from "../_shared/connector-log.ts";
import {
  buildResponsesRequest,
  countRun,
  estimateCostUsd,
  findBrands,
  parseResponsesOutput,
} from "../_shared/ai-visibility.ts";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const CALL_TIMEOUT_MS = 55_000;
const START_BUDGET_MS = 75_000;
const STALE_MS = 10 * 60_000;
const MAX_HOPS = 8;

const intEnv = (k: string, def: number, min: number, max: number) => {
  const n = Number(Deno.env.get(k));
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, Math.floor(n))) : def;
};
const model = () => Deno.env.get("AI_VISIBILITY_MODEL")?.trim() || "gpt-4.1-mini";
const maxPrompts = () => intEnv("AI_VISIBILITY_MAX_PROMPTS", 25, 1, 50);
const concurrency = () => intEnv("AI_VISIBILITY_CONCURRENCY", 3, 1, 6);

type Run = { id: string; prompt_ids: string[]; planned: number; hops: number; started_at: string };
type Prompt = { id: string; prompt: string; kind: string; topic: string };

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return j({ ok: false, error: "POST only" }, 405);
  const body: any = await req.json().catch(() => ({}));

  try {
    let run: Run | null;
    let hop = 0;
    if (typeof body?.run_id === "string" && body._continue === true) {
      hop = Math.max(0, Math.floor(Number(body.hop) || 0));
      run = await resumeRun(body.run_id);
      if (!run) return j({ ok: true, skipped: "not_running", run_id: body.run_id });
    } else {
      if (!Deno.env.get("OPENAI_API_KEY")) {
        await log("error", "ai_visibility_no_key", "AI visibility run skipped: OPENAI_API_KEY is not set");
        return j({ ok: false, error: "OPENAI_API_KEY is not set on the edge functions" }, 500);
      }
      const trigger = body?.trigger === "manual" ? "manual" : "cron";
      const by = typeof body?.by === "string" ? body.by.slice(0, 200) : null;
      const started = await startRun(trigger, by);
      if ("skipped" in started) return j({ ok: true, skipped: started.skipped });
      if ("busy" in started) return j({ ok: false, busy: true, ...started.busy }, 409);
      run = started.run;
    }

    const work = processRun(run, hop).catch(async (e) => {
      console.error("[ai-visibility-tick] run failed", run!.id, errStr(e));
      await finalizeRun(run!, { forceError: errStr(e) }).catch(() => {});
    });
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) {
      rt.waitUntil(work);
    } else {
      await work; // local / non-edge runtime: run inline
    }
    return j({ ok: true, run_id: run.id, status: "running", planned: run.planned, hop });
  } catch (e) {
    await log("error", "ai_visibility_failed", `ai-visibility-tick: ${errStr(e)}`);
    return j({ ok: false, error: errStr(e) }, 500);
  }
});

// ---- lock -----------------------------------------------------------------------

/** Closes runs whose heartbeat stopped (instance killed mid-run). */
async function reapStale() {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const { data } = await db().from("ai_visibility_runs")
    .select("id, prompt_ids, planned, hops, started_at")
    .eq("status", "running")
    .lt("heartbeat_at", cutoff);
  for (const r of (data ?? []) as Run[]) {
    await finalizeRun(r, { forceError: "Stopped before finishing (no heartbeat for 10 minutes)" });
  }
}

async function startRun(
  trigger: string,
  by: string | null,
): Promise<{ run: Run } | { busy: Record<string, unknown> } | { skipped: string }> {
  const sb = db();
  await reapStale();
  const { data: prompts, error: pErr } = await sb.from("ai_visibility_prompts")
    .select("id")
    .eq("active", true)
    .order("sort", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(maxPrompts());
  if (pErr) throw pErr;
  const ids = (prompts ?? []).map((p: any) => p.id as string);
  if (!ids.length) return { skipped: "no_active_prompts" };

  const now = new Date().toISOString();
  const { data, error } = await sb.from("ai_visibility_runs").insert({
    trigger,
    triggered_by: by,
    status: "running",
    model: model(),
    prompt_ids: ids,
    planned: ids.length,
    started_at: now,
    heartbeat_at: now,
  }).select("id, prompt_ids, planned, hops, started_at").single();
  if (error) {
    if ((error as any).code === "23505") {
      const { data: cur } = await sb.from("ai_visibility_runs")
        .select("id, started_at, trigger").eq("status", "running").limit(1).maybeSingle();
      return { busy: { run_id: cur?.id ?? null, started_at: cur?.started_at ?? null, error: "A run is already going" } };
    }
    throw error;
  }
  return { run: data as Run };
}

async function resumeRun(id: string): Promise<Run | null> {
  // guarded heartbeat: only a run that is still 'running' continues
  const { data, error } = await db().from("ai_visibility_runs")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("id", id).eq("status", "running")
    .select("id, prompt_ids, planned, hops, started_at");
  if (error) throw error;
  return (data?.[0] as Run) ?? null;
}

async function heartbeat(id: string, patch: Record<string, unknown> = {}) {
  await db().from("ai_visibility_runs")
    .update({ heartbeat_at: new Date().toISOString(), ...patch })
    .eq("id", id).eq("status", "running");
}

// ---- work -----------------------------------------------------------------------

async function processRun(run: Run, hop: number) {
  const t0 = Date.now();
  const sb = db();
  const { data: doneRows, error: dErr } = await sb.from("ai_visibility_results")
    .select("prompt_id").eq("run_id", run.id);
  if (dErr) throw dErr;
  const done = new Set((doneRows ?? []).map((r: any) => r.prompt_id));
  const pendingIds = (run.prompt_ids ?? []).filter((id) => !done.has(id));

  let prompts: Prompt[] = [];
  if (pendingIds.length) {
    const { data, error } = await sb.from("ai_visibility_prompts")
      .select("id, prompt, kind, topic").in("id", pendingIds);
    if (error) throw error;
    const byId = new Map((data ?? []).map((p: any) => [p.id, p as Prompt]));
    // keep the planned order; a prompt deleted since the run started is dropped
    prompts = pendingIds.map((id) => byId.get(id)).filter((p): p is Prompt => !!p);
  }

  const queue = [...prompts];
  const worker = async () => {
    while (queue.length && Date.now() - t0 < START_BUDGET_MS) {
      const p = queue.shift()!;
      const row = await askOne(p);
      const { error } = await sb.from("ai_visibility_results").insert({ run_id: run.id, ...row });
      // 23505: this prompt already has a row for this run (overlapping hop)
      if (error && (error as any).code !== "23505") {
        console.error("[ai-visibility-tick] result write", p.id, errStr(error));
      }
      await heartbeat(run.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency(), Math.max(1, queue.length)) }, worker));

  if (queue.length) {
    if (hop >= MAX_HOPS) {
      await finalizeRun(run, { forceError: `Stopped after ${MAX_HOPS + 1} rounds with ${queue.length} questions left` });
      return;
    }
    await heartbeat(run.id, { hops: hop + 1 });
    // The next invocation answers at once (its work runs in the background).
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-visibility-tick`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ run_id: run.id, _continue: true, hop: hop + 1 }),
      signal: AbortSignal.timeout(20_000),
    }).catch((e) => {
      // a timeout may still have started the next hop: leave the run to it
      // (or to the 10-minute reaper), never close it under a live hop
      console.error("[ai-visibility-tick] chain failed", errStr(e));
      return null;
    });
    if (res && !res.ok) {
      // the next hop was refused outright (401/5xx): close the run now
      await finalizeRun(run, { forceError: `Could not continue the run (HTTP ${res.status})` });
    }
    return;
  }
  await finalizeRun(run, {});
}

async function askOne(p: Prompt): Promise<Record<string, unknown>> {
  const m = model();
  const base = { prompt_id: p.id, prompt_text: p.prompt, kind: p.kind, topic: p.topic, provider: "openai", model: m };
  const t = Date.now();
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY") ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildResponsesRequest(m, p.prompt)),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ...base,
        web_search: false,
        error: `OpenAI HTTP ${res.status}: ${json?.error?.message ?? "unknown error"}`.slice(0, 500),
        latency_ms: Date.now() - t,
      };
    }
    const out = parseResponsesOutput(json);
    const match = findBrands(out.answer);
    const error = out.answer
      ? null
      : out.status === "incomplete"
      ? `No answer text (cut off: ${out.incomplete_reason ?? "unknown"})`
      : "No answer text";
    return {
      ...base,
      model: out.model ?? m,
      web_search: out.search_calls > 0,
      answer: out.answer || null,
      promunch_named: match.promunch_named,
      promunch_rank: match.promunch_rank,
      brands_named: match.brands,
      citations: out.citations,
      error,
      input_tokens: out.input_tokens,
      output_tokens: out.output_tokens,
      search_calls: out.search_calls,
      cost_usd: estimateCostUsd(out.model ?? m, out.input_tokens, out.output_tokens, out.search_calls),
      latency_ms: Date.now() - t,
    };
  } catch (e) {
    const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      ...base,
      web_search: false,
      error: (timedOut ? `No reply from OpenAI within ${CALL_TIMEOUT_MS / 1000} s` : errStr(e)).slice(0, 500),
      latency_ms: Date.now() - t,
    };
  }
}

/** Writes the counts and closes the run (guarded: only a 'running' run). */
async function finalizeRun(run: Run, opts: { forceError?: string }) {
  const sb = db();
  const { data, error } = await sb.from("ai_visibility_results")
    .select("kind, error, answer, promunch_named, cost_usd").eq("run_id", run.id);
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const c = countRun(rows);
  const cost = rows.reduce((a, r) => a + (Number(r.cost_usd) || 0), 0);
  const status = c.answered === 0 ? "failed" : opts.forceError || rows.length < (run.planned ?? 0) ? "partial" : "done";
  const firstErr = rows.find((r) => r.error)?.error ?? null;
  const { data: closed } = await sb.from("ai_visibility_runs").update({
    status,
    finished_at: new Date().toISOString(),
    answered: c.answered,
    errors: c.errors,
    category_answered: c.category_answered,
    named: c.named,
    cost_usd: Math.round(cost * 10_000) / 10_000,
    error: opts.forceError ?? (status === "failed" ? firstErr : null),
  }).eq("id", run.id).eq("status", "running").select("id");
  if (closed?.length && status !== "done") {
    await log(
      status === "failed" ? "error" : "warn",
      `ai_visibility_run_${status}`,
      `AI visibility run ${status}: ${c.answered} of ${run.planned} answered. ${opts.forceError ?? firstErr ?? ""}`,
    );
  }
}

async function log(level: "warn" | "error", event: string, message: string) {
  await logConnector({
    connector: "reputation",
    level,
    event,
    message: message.slice(0, 300),
    throttleMinutes: 60,
  }).catch(() => {});
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
