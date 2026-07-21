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

import OpenAI from "npm:openai@4.78.0";
import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { logConnector, errStr } from "../_shared/connector-log.ts";
import { apifyRunStatus, apifyDatasetItems, extractHandle, normalizeProfileItem, normalizeReelViews } from "../_shared/apify.ts";
import { compositeFit, clamp } from "../_shared/ig-scoring.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("IG_AI_MODEL") ?? "gpt-4o-mini";
const RUN_BATCH = 10;
const NICHE_CHUNK = 15;

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
async function importProfiles(run: any, items: any[]) {
  const sb = db();
  const { data: settings } = await sb
    .from("ig_settings")
    .select("min_followers, max_followers")
    .eq("id", 1)
    .maybeSingle();
  const min = settings?.min_followers ?? 20000;
  const max = settings?.max_followers ?? 100000;

  const profiles = items.map(normalizeProfileItem).filter((p) => p.handle);

  // one batched niche call per chunk — bio + captions in, {handle, niche, score} out
  const nicheByHandle = new Map<string, { niche: string | null; score: number; reason: string | null }>();
  for (let i = 0; i < profiles.length; i += NICHE_CHUNK) {
    const chunk = profiles.slice(i, i + NICHE_CHUNK);
    const scored = await nicheScoreBatch(chunk).catch((e) => {
      console.error("[ig-discovery-tick] niche scoring failed", errStr(e));
      return [];
    });
    for (const s of scored) nicheByHandle.set(s.handle, s);
  }

  for (const p of profiles) {
    const niche = nicheByHandle.get(p.handle!) ?? { niche: null, score: 0, reason: null };
    const fit = compositeFit(p.followers, p.engagement_rate, niche.score, min, max);
    const reasonBits = [
      niche.reason ? `Niche: ${niche.reason}` : null,
      `Followers: ${p.followers ?? "unknown"}`,
      p.engagement_rate != null ? `ER (last 3): ${(p.engagement_rate * 100).toFixed(1)}%` : "ER: unknown",
    ].filter(Boolean);

    await sb.from("ig_prospects").update({
      full_name: p.full_name,
      profile_pic: p.profile_pic,
      biography: p.biography,
      external_url: p.external_url,
      followers: p.followers,
      media_count: p.media_count,
      avg_likes: p.avg_likes,
      avg_comments: p.avg_comments,
      engagement_rate: p.engagement_rate,
      last3: p.last3,
      bio_email: p.bio_email,
      niche: niche.niche,
      niche_score: clamp(niche.score, 0, 25),
      fit_score: fit,
      fit_reason: reasonBits.join(" · "),
      scraped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("handle", p.handle!);
  }

  // link prospects to threads that already exist for the same handle (the
  // creator has DM'd us before) so the pipeline owns the relationship.
  const handles = profiles.map((p) => p.handle!) as string[];
  if (handles.length) {
    const { data: threads } = await sb
      .from("ig_threads")
      .select("id, handle")
      .in("handle", handles);
    for (const t of threads ?? []) {
      await sb.from("ig_prospects")
        .update({ thread_id: t.id, status: "in_convo", updated_at: new Date().toISOString() })
        .eq("handle", t.handle)
        .is("thread_id", null);
    }
  }
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

// ---- batched AI niche scoring ----------------------------------------------
async function nicheScoreBatch(
  profiles: { handle: string | null; biography: string | null; captions: string[] }[],
): Promise<{ handle: string; niche: string | null; score: number; reason: string | null }[]> {
  if (!OPENAI_API_KEY || !profiles.length) return [];
  const sys =
    `You evaluate Instagram creators for PROMUNCH (Indian healthy-snack brand — protein munchies, ` +
    `edamame, soya crunchies; "Your Munchy Pal"). Food, fitness, health, lifestyle, student and ` +
    `mom-focused creators fit well; unrelated or spammy accounts do not.`;
  const user = [
    `For each creator below, return a niche label and a 0-25 brand-fit score.`,
    ``,
    ...profiles.map((p, i) => [
      `--- CREATOR ${i + 1}: @${p.handle}`,
      `BIO: ${(p.biography ?? "").slice(0, 300) || "(none)"}`,
      `CAPTIONS: ${p.captions.slice(0, 4).map((c) => c.slice(0, 120)).join(" | ") || "(none)"}`,
    ].join("\n")),
    ``,
    `Return JSON ONLY: {"creators":[{"handle":"...","niche":"<2-4 word label>","score":<0-25>,"reason":"<one short line>"}]}`,
  ].join("\n");

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const resp = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 120 * profiles.length + 200,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
  });
  let parsed: any = null;
  try { parsed = JSON.parse(resp.choices?.[0]?.message?.content ?? ""); } catch { return []; }
  const list = Array.isArray(parsed?.creators) ? parsed.creators : [];
  return list
    .filter((c: any) => typeof c?.handle === "string")
    .map((c: any) => ({
      handle: c.handle.replace(/^@/, "").toLowerCase(),
      niche: (c.niche ?? null) ? String(c.niche).slice(0, 60) : null,
      score: Number(c.score) || 0,
      reason: (c.reason ?? null) ? String(c.reason).slice(0, 200) : null,
    }));
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
