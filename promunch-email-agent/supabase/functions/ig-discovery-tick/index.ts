// Cron (every 5 min): advance running Apify discovery runs.
//
// For each ig_discovery_runs row in status='running':
//   - still RUNNING at Apify → leave it
//   - FAILED/ABORTED       → mark failed + Slack
//   - SUCCEEDED            → import the dataset:
//       search/hashtag → upsert candidate handles into ig_prospects, then
//                        self-invoke ig-discovery {action:'enrich'} for the
//                        unscraped ones (profile metrics)
//       profiles       → write followers / last-3 metrics / ER / bio email,
//                        score with the SHARED ig-analyze formula (band 0–40 +
//                        ER 0–35 + AI niche 0–25, one batched gpt-4o-mini
//                        call), link to an existing ig_thread by handle
//       reels          → write avg_views on the prospect
//
// Schedule: pg_cron 'ig-discovery-tick' */5 (see 20260721131000).

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { logConnector, errStr } from "../_shared/connector-log.ts";
import { apifyRunStatus, apifyDatasetItems, extractHandle, normalizeProfileItem, normalizeReelViews } from "../_shared/apify.ts";
import { scoreAndSaveProfiles } from "../_shared/ig-prospect-score.ts";

const RUN_BATCH = 10;

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const result = await tick().catch((e) => ({ error: errStr(e) }));
  return j({ ok: true, ...result });
});

async function tick() {
  const sb = db();
  const { data: running } = await sb
    .from("ig_discovery_runs")
    .select("*")
    .eq("status", "running")
    .order("created_at", { ascending: true })
    .limit(RUN_BATCH);

  let advanced = 0, imported = 0, failed = 0;
  for (const run of running ?? []) {
    try {
      const st = await apifyRunStatus(run.apify_run_id);
      if (st.status === "READY" || st.status === "RUNNING") continue;

      if (st.status !== "SUCCEEDED") {
        await sb.from("ig_discovery_runs").update({
          status: "failed",
          error: `Apify run ${st.status}`,
          usage_usd: st.usageUsd,
          finished_at: new Date().toISOString(),
        }).eq("id", run.id);
        failed++;
        await logConnector({
          connector: "instagram",
          level: "warn",
          event: "discovery_run_failed",
          message: `Discovery run ${run.kind}${run.query ? ` '${run.query}'` : ""} ended ${st.status}.`,
          detail: { run_id: run.id, actor: run.actor },
          throttleMinutes: 10,
        }).catch(() => {});
        continue;
      }

      if (!st.datasetId) throw new Error("succeeded run has no dataset");
      const items = await apifyDatasetItems(st.datasetId);

      if (run.kind === "search" || run.kind === "hashtag") {
        await importCandidates(run, items);
      } else if (run.kind === "profiles") {
        await importProfiles(run, items);
      } else if (run.kind === "reels") {
        await importReels(run, items);
      }

      await sb.from("ig_discovery_runs").update({
        status: "imported",
        items_count: items.length,
        usage_usd: st.usageUsd,
        finished_at: new Date().toISOString(),
      }).eq("id", run.id);
      imported++;
    } catch (e) {
      const msg = errStr(e);
      await sb.from("ig_discovery_runs").update({
        status: "failed",
        error: msg.slice(0, 500),
        finished_at: new Date().toISOString(),
      }).eq("id", run.id);
      failed++;
      await logConnector({
        connector: "instagram",
        level: "error",
        event: "discovery_import_failed",
        message: `Discovery import failed (${run.kind}): ${msg}`.slice(0, 300),
        detail: { run_id: run.id },
        throttleMinutes: 10,
      }).catch(() => {});
    }
    advanced++;
  }
  return { checked: running?.length ?? 0, advanced, imported, failed };
}

// ---- search/hashtag → candidate handles → enrich ---------------------------
async function importCandidates(run: any, items: any[]) {
  const sb = db();
  const handles = [...new Set(items.map(extractHandle).filter((h): h is string => !!h))];
  if (!handles.length) return;

  const source = `${run.kind}:${run.query ?? ""}`;
  await sb.from("ig_prospects").upsert(
    handles.map((handle) => ({ handle, source, discovery_run_id: run.id })),
    { onConflict: "handle", ignoreDuplicates: true },
  );

  // enrich only the ones we haven't profiled yet
  const { data: unscraped } = await sb
    .from("ig_prospects")
    .select("handle")
    .in("handle", handles)
    .is("scraped_at", null);
  const need = (unscraped ?? []).map((r) => r.handle);
  if (!need.length) return;

  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ig-discovery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "enrich", handles: need, parent_run_id: run.id }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(`enrich chain failed: ${d?.error ?? `HTTP ${res.status}`}`);
  }
}

// ---- profiles → metrics + score + thread link ------------------------------
async function importProfiles(_run: any, items: any[]) {
  await scoreAndSaveProfiles(items.map(normalizeProfileItem));
}

async function importReels(run: any, items: any[]) {
  const sb = db();
  const handle = (run.query ?? "").toLowerCase();
  if (!handle) return;
  const avg = normalizeReelViews(items);
  await sb.from("ig_prospects").update({
    avg_views: avg,
    updated_at: new Date().toISOString(),
  }).eq("handle", handle);
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
