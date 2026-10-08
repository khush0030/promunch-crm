// deno-lint-ignore-file no-explicit-any -- DB rows are untyped
// Cron (every 15 min): the Reputation (ORM) engine.
// Contract: docs/plans/2026-10-08-orm-build-spec.md.
//
//   1. COLLECT  every enabled orm_sources row with next_run_at <= now:
//               adapter (_shared/orm-sources.ts) → relevance pre-filter →
//               upsert orm_mentions on (source, external_id) ignoreDuplicates
//               → update the source row (cursor, last_*, next_run_at).
//   2. ENRICH   up to 40 un-enriched mentions (enrich_attempts < 3), batches
//               of 20 per OpenAI call (_shared/orm-enrich.ts).
//   3. ALERT    orm_settings.alerts_enabled: newly enriched relevant mentions
//               that match a rule → claim orm_alert_log → one internal
//               WhatsApp per mention per recipient (_shared/orm-alerts.ts).
//
// POST {"source":"<key>"} runs COLLECT for that one source now (ignoring
// next_run_at) + ENRICH; ALERT is left to the cron tick.
//
// Each step and each source is isolated: one failing never stops the rest.
// A source without credentials is 'not_connected' and is skipped, never an
// error alert. Nothing here messages a customer.
//
// Auth: requireInternal (pg_cron sends the Vault service_role_key bearer).
// Schedule: 20261008200100_orm_tick_cron.sql.

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { errStr, logConnector } from "../_shared/connector-log.ts";
import {
  applyRelevance,
  collect,
  type MentionInput,
  type OrmSettingsRow,
  type OrmSourceRow,
} from "../_shared/orm-sources.ts";
import {
  applyHardRules,
  callEnrichModel,
  ENRICH_BATCH,
  type EnrichItemInput,
  matchCustomer,
  MAX_ENRICH_ATTEMPTS,
} from "../_shared/orm-enrich.ts";
import { runAlerts } from "../_shared/orm-alerts.ts";

const ENRICH_LIMIT = 40;
const UPSERT_CHUNK = 200;
const PENDING_RECHECK_MIN = 15; // Amazon run still going → look again next tick
const SOURCE_KEYS = new Set(["judgeme", "youtube", "reddit", "rss", "amazon", "instagram"]);

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  let body: any = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  const only = typeof body?.source === "string" ? body.source.trim() : null;
  if (only && !SOURCE_KEYS.has(only)) return j({ ok: false, error: "unknown source" }, 400);
  const result = await tick(only).catch((e) => ({ error: errStr(e) }));
  return j({ ok: true, ...result });
});

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[orm-tick] ${name} failed`, errStr(e));
    await logConnector({
      connector: "reputation",
      level: "error",
      event: `orm_tick_${name}_failed`,
      message: `orm-tick ${name}: ${errStr(e)}`.slice(0, 300),
      throttleMinutes: 60,
    }).catch(() => {});
    return { error: errStr(e) };
  }
}

async function loadSettings(): Promise<OrmSettingsRow> {
  const { data, error } = await db().from("orm_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("orm_settings row missing (migration 20261008200000_orm.sql not applied?)");
  return data as OrmSettingsRow;
}

async function tick(only: string | null) {
  const settings = await loadSettings();
  const now = Date.now();
  const collected = await step("collect", () => collectAll(settings, now, only));
  const enriched = await step("enrich", () => enrich());
  const alerts = only ? { skipped: "manual_run" } : await step("alert", () => runAlerts(settings, Date.now()));
  return { source: only, collected, enriched, alerts };
}

// ---- 1. COLLECT -------------------------------------------------------------
async function collectAll(settings: OrmSettingsRow, now: number, only: string | null) {
  const sb = db();
  let q = sb.from("orm_sources").select("*").eq("enabled", true);
  if (only) q = q.eq("key", only);
  else q = q.lte("next_run_at", new Date(now).toISOString());
  const { data, error } = await q;
  if (error) throw error;
  if (only && !data?.length) return { [only]: { skipped: "disabled" } };

  const out: Record<string, unknown> = {};
  for (const src of (data ?? []) as OrmSourceRow[]) {
    out[src.key] = await step(`collect_${src.key}`, () => collectOne(src, settings, now));
  }
  return out;
}

async function collectOne(src: OrmSourceRow, settings: OrmSettingsRow, now: number) {
  const sb = db();
  const nextRun = (min: number) => new Date(now + min * 60_000).toISOString();
  let res;
  try {
    res = await collect(src, settings, now);
  } catch (e) {
    await sb.from("orm_sources").update({
      last_run_at: new Date(now).toISOString(),
      last_status: "error",
      last_error: errStr(e).slice(0, 500),
      last_count: 0,
      next_run_at: nextRun(src.every_minutes),
      updated_at: new Date().toISOString(),
    }).eq("key", src.key);
    throw e; // step() logs it (throttled)
  }

  if (res.settingsPatch) {
    await sb.from("orm_settings").update({ ...res.settingsPatch, updated_at: new Date().toISOString() }).eq("id", 1);
  }

  let inserted = 0;
  let kept: MentionInput[] = [];
  if (res.status === "ok" && res.mentions.length) {
    kept = applyRelevance(res.mentions, settings.keywords, settings.exclude_keywords);
    // de-dup within the batch (same id twice in one fetch breaks the upsert)
    const uniq = new Map<string, MentionInput>();
    for (const m of kept) uniq.set(`${m.source}|${m.external_id}`, m);
    const rows = [...uniq.values()].map((m) => ({
      source: m.source,
      external_id: m.external_id,
      url: m.url,
      author_name: m.author_name,
      author_handle: m.author_handle,
      author_followers: m.author_followers,
      title: m.title,
      body: m.body,
      rating: m.rating,
      posted_at: m.posted_at,
      is_owned: m.is_owned,
      product_ref: m.product_ref,
      parent_external_id: m.parent_external_id,
      raw: m.raw,
      ...(m.relevant === false ? { relevant: false } : {}),
    }));
    // rows with and without `relevant` must not share one upsert payload
    // (PostgREST would null the column for the rows that omit it)
    const groups = [rows.filter((r) => "relevant" in r), rows.filter((r) => !("relevant" in r))];
    for (const g of groups) {
      for (let i = 0; i < g.length; i += UPSERT_CHUNK) {
        const { data, error } = await sb.from("orm_mentions")
          .upsert(g.slice(i, i + UPSERT_CHUNK), { onConflict: "source,external_id", ignoreDuplicates: true })
          .select("id");
        if (error) throw error;
        inserted += data?.length ?? 0;
      }
    }
  }

  const pending = !!res.cursor?.pending_run;
  await sb.from("orm_sources").update({
    cursor: res.cursor ?? {},
    last_run_at: new Date(now).toISOString(),
    last_status: res.status,
    last_error: res.note ?? null,
    last_count: inserted,
    next_run_at: nextRun(pending ? PENDING_RECHECK_MIN : src.every_minutes),
    updated_at: new Date().toISOString(),
  }).eq("key", src.key);

  return { status: res.status, fetched: res.mentions.length, kept: kept.length, inserted, note: res.note ?? null };
}

// ---- 2. ENRICH --------------------------------------------------------------
async function enrich() {
  const sb = db();
  const { data, error } = await sb.from("orm_mentions")
    .select("id, source, rating, title, body, author_followers, is_owned, enrich_attempts")
    .is("enriched_at", null)
    .lt("enrich_attempts", MAX_ENRICH_ATTEMPTS)
    .or("relevant.is.null,relevant.eq.true") // pre-filter exclusions are never scored
    .order("collected_at", { ascending: true })
    .limit(ENRICH_LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as any[];
  if (!rows.length) return { pending: 0 };

  let done = 0, failed = 0, matched = 0;
  for (let i = 0; i < rows.length; i += ENRICH_BATCH) {
    const batch = rows.slice(i, i + ENRICH_BATCH);
    const items: EnrichItemInput[] = batch.map((r) => ({
      id: r.id,
      source: r.source,
      rating: r.rating == null ? null : Number(r.rating),
      title: r.title,
      body: r.body ?? "",
      author_followers: r.author_followers,
    }));
    let results: Map<string, any>;
    let batchErr: string | null = null;
    try {
      results = await callEnrichModel(items);
    } catch (e) {
      results = new Map();
      batchErr = errStr(e);
    }
    for (const r of batch) {
      const e = results.get(r.id);
      if (!e) {
        failed++;
        await sb.from("orm_mentions").update({
          enrich_attempts: (r.enrich_attempts ?? 0) + 1,
          enrich_error: (batchErr ?? "missing from model output").slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq("id", r.id).is("enriched_at", null);
        continue;
      }
      const fin = applyHardRules(e, { title: r.title, body: r.body ?? "", is_owned: r.is_owned });
      let contactId: string | null = null;
      if (fin.order_ref) {
        contactId = await matchCustomer(fin.order_ref).catch(() => null);
        if (contactId) matched++;
      }
      const { error: uErr } = await sb.from("orm_mentions").update({
        enriched_at: new Date().toISOString(),
        relevant: fin.relevant,
        sentiment: fin.sentiment,
        summary: fin.summary || null,
        topics: fin.topics,
        intent: fin.intent,
        urgency: fin.urgency,
        product: fin.product,
        language: fin.language,
        order_ref: fin.order_ref,
        ...(contactId ? { contact_id: contactId } : {}),
        enrich_error: null,
        enrich_attempts: (r.enrich_attempts ?? 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq("id", r.id).is("enriched_at", null);
      if (uErr) { failed++; console.error("[orm-tick] enrich write", r.id, errStr(uErr)); }
      else done++;
    }
    if (batchErr) {
      await logConnector({
        connector: "reputation",
        level: "warn",
        event: "orm_enrich_failed",
        message: `ORM enrichment batch failed: ${batchErr}`.slice(0, 300),
        throttleMinutes: 120,
      }).catch(() => {});
    }
  }
  return { pending: rows.length, enriched: done, failed, customer_matched: matched };
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
