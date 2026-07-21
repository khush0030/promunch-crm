// Instagram influencer discovery — starts Apify actor runs and returns
// immediately. ig-discovery-tick (pg_cron */5) polls run status and imports
// finished datasets into ig_prospects.
//
// POST body (one of):
//   { action: 'start',  kind: 'search' | 'hashtag', query: string, max_items?: number }
//   { action: 'enrich', handles: string[], parent_run_id?: string }   // profile scrape
//   { action: 'reels',  prospect_id: string }                        // avg views, shortlist-only
//
// Cost controls: per-day USD budget (ig_settings.discovery_daily_budget_usd,
// summed from finished runs' usage) and a per-run profile cap
// (ig_settings.discovery_max_profiles_per_run).
//
// Scraped data feeds search + scoring ONLY. No automated send ever uses it —
// Instagram forbids cold DMs via the API; first contact is always a human.
//
// Auth: requires service-role bearer (verify_jwt = false; called by the Next.js
// dashboard route and by ig-discovery-tick).

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { logConnector, errStr } from "../_shared/connector-log.ts";
import { apifyStart, cleanHandle } from "../_shared/apify.ts";

const ACTORS = {
  search: "apify/instagram-search-scraper",
  hashtag: "apify/instagram-hashtag-scraper",
  profiles: "apify/instagram-profile-scraper",
  reels: "apify/instagram-reel-scraper",
} as const;

const ENRICH_CHUNK = 50;

interface Body {
  action: "start" | "enrich" | "reels";
  kind?: "search" | "hashtag";
  query?: string;
  max_items?: number;
  handles?: string[];
  parent_run_id?: string;
  prospect_id?: string;
  started_by?: string;
}

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return new Response("method", { status: 405 });

  let body: Body;
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }

  const sb = db();
  const { data: settings } = await sb
    .from("ig_settings")
    .select("discovery_daily_budget_usd, discovery_max_profiles_per_run")
    .eq("id", 1)
    .maybeSingle();
  const budget = Number(settings?.discovery_daily_budget_usd ?? 5);
  const maxProfiles = Number(settings?.discovery_max_profiles_per_run ?? 100);

  // ---- daily budget guard (spent = usage of runs that finished today) ----
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data: todays } = await sb
    .from("ig_discovery_runs")
    .select("usage_usd")
    .gte("created_at", dayStart.toISOString());
  const spent = (todays ?? []).reduce((n, r) => n + (Number(r.usage_usd) || 0), 0);
  if (spent >= budget) {
    return j({ error: `Daily discovery budget reached ($${spent.toFixed(2)}/$${budget}). Raise it in Settings or try tomorrow.` }, 429);
  }

  try {
    if (body.action === "start") {
      if (body.kind !== "search" && body.kind !== "hashtag") return j({ error: "kind must be search|hashtag" }, 400);
      const query = (body.query ?? "").trim();
      if (!query) return j({ error: "query required" }, 400);
      const maxItems = Math.min(Math.max(1, Number(body.max_items) || 30), maxProfiles);

      const actor = ACTORS[body.kind];
      const input = body.kind === "search"
        ? { search: query, searchType: "user", searchLimit: maxItems, resultsLimit: maxItems }
        : { hashtags: [query.replace(/^#/, "")], resultsLimit: maxItems, resultsType: "posts" };

      const run = await apifyStart(actor, input);
      const { data: row, error } = await sb.from("ig_discovery_runs").insert({
        kind: body.kind,
        query,
        actor,
        apify_run_id: run.runId,
        status: "running",
        input,
        started_by: body.started_by ?? null,
      }).select("id").single();
      if (error) throw error;
      return j({ ok: true, run_id: row.id, apify_run_id: run.runId });
    }

    if (body.action === "enrich") {
      const handles = (body.handles ?? []).map(cleanHandle).filter((h): h is string => !!h);
      if (!handles.length) return j({ error: "handles required" }, 400);
      const capped = handles.slice(0, maxProfiles);
      const runIds: string[] = [];
      for (let i = 0; i < capped.length; i += ENRICH_CHUNK) {
        const chunk = capped.slice(i, i + ENRICH_CHUNK);
        const input = { usernames: chunk };
        const run = await apifyStart(ACTORS.profiles, input);
        const { data: row, error } = await sb.from("ig_discovery_runs").insert({
          kind: "profiles",
          actor: ACTORS.profiles,
          apify_run_id: run.runId,
          parent_run_id: body.parent_run_id ?? null,
          status: "running",
          input,
          started_by: body.started_by ?? null,
        }).select("id").single();
        if (error) throw error;
        runIds.push(row.id);
      }
      // seed prospect rows now so the dashboard shows them as pending-enrich
      // (existing rows untouched — ignoreDuplicates)
      await sb.from("ig_prospects").upsert(
        capped.map((handle) => ({ handle, source: body.parent_run_id ? null : "manual" })),
        { onConflict: "handle", ignoreDuplicates: true },
      );
      return j({ ok: true, run_ids: runIds, queued: capped.length, dropped: handles.length - capped.length });
    }

    if (body.action === "reels") {
      if (!body.prospect_id) return j({ error: "prospect_id required" }, 400);
      const { data: p } = await sb.from("ig_prospects").select("id, handle").eq("id", body.prospect_id).maybeSingle();
      if (!p) return j({ error: "prospect not found" }, 404);
      const input = { username: [p.handle], resultsLimit: 6 };
      const run = await apifyStart(ACTORS.reels, input);
      const { data: row, error } = await sb.from("ig_discovery_runs").insert({
        kind: "reels",
        query: p.handle,
        actor: ACTORS.reels,
        apify_run_id: run.runId,
        status: "running",
        input,
        started_by: body.started_by ?? null,
      }).select("id").single();
      if (error) throw error;
      return j({ ok: true, run_id: row.id });
    }

    return j({ error: "unknown action" }, 400);
  } catch (e) {
    const msg = errStr(e);
    await logConnector({
      connector: "instagram",
      level: "error",
      event: "discovery_start_failed",
      message: `Discovery ${body.action} failed: ${msg}`.slice(0, 300),
      detail: { action: body.action, kind: body.kind ?? null, query: body.query ?? null },
      throttleMinutes: 5,
    }).catch(() => {});
    return j({ error: msg }, 500);
  }
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
