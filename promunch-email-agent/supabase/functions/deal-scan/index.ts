// deal-scan: sweeps hello@promunch.in, classifies commercial conversations
// with OpenAI, and maintains the deals / deal_emails tables that power
// /dashboard/deals.
//
// READ-ONLY on Gmail — this function never sends mail, so the §0
// no-duplicate-message invariant is not in play. Idempotency: every scanned
// message lands in deal_emails (unique gmail_message_id); rescans are no-ops.
//
// Modes (driven by deal_scan_state, one row):
//   backfill    — first runs page through the last DEAL_SCAN_BACKFILL_DAYS of
//                 threads, one small page per invocation (cron chews through it)
//   incremental — after backfill, each run picks up threads newer than the
//                 watermark (with a 6h overlap for safety)

import { requireInternal } from "../_shared/require-internal.ts";
import { db } from "../_shared/supabase.ts";
import { errStr, logConnector } from "../_shared/connector-log.ts";
import { getThreadParsed, listThreads, type ThreadMessage } from "../_shared/gmail.ts";
import { type DealExtraction, extractDeal, insightsOf } from "../_shared/deal-extract.ts";
import { DEAL_KIND_LABEL, LEAD_DEAL_KINDS, pingLeadDesk } from "../_shared/lead-alert.ts";
import {
  buildTranscript,
  companyDomainOf,
  computeFollowUp,
  type DealStage,
  extractAddress,
  isNoiseSender,
  mergeStage,
  shouldGoDormant,
} from "../_shared/deal-pipeline.ts";

const MAILBOX = Deno.env.get("MAILBOX_EMAIL") ?? "hello@promunch.in";
const BASE_Q = "-category:promotions -category:social -in:chats";
const BACKFILL_DAYS = Number(Deno.env.get("DEAL_SCAN_BACKFILL_DAYS") ?? "365");
const MAX_THREADS_PER_RUN = Number(Deno.env.get("DEAL_SCAN_MAX_THREADS") ?? "12");
// A lead older than this is history, not news — scan it, never ping about it.
const LEAD_ALERT_MAX_AGE_MS = Number(Deno.env.get("LEAD_ALERT_MAX_AGE_DAYS") ?? "14") * 86_400_000;

interface ScanState {
  backfill_done: boolean;
  backfill_page_token: string | null;
  watermark_ms: number | null;
  threads_scanned: number;
}

interface DealRow {
  id: string;
  company_name: string;
  company_domain: string | null;
  kind: string;
  contact_name: string | null;
  contact_email: string | null;
  stage: DealStage;
  samples_sent_at: string | null;
  first_email_at: string | null;
  manual_stage_override: boolean;
  manual_kind_override: boolean;
}

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;

  let body: { mode?: string; max?: number; afterId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  // Soft lock (3-min lease): webhook nudges + cron + dashboard can all fire
  // this; only one run may process threads at a time or dedup breaks.
  const cutoff = new Date(Date.now() - 3 * 60_000).toISOString();
  const { data: claimed, error: claimErr } = await db()
    .from("deal_scan_state")
    .update({ running_since: new Date().toISOString() })
    .eq("id", 1)
    .or(`running_since.is.null,running_since.lt.${cutoff}`)
    .select("id");
  if (claimErr) return json({ ok: false, error: claimErr.message }, 500);
  if (!claimed?.length) return json({ ok: true, locked: true });

  try {
    // mode=insights re-reads threads of deals that predate sentiment analysis;
    // mode=reclassify re-judges `kind` for deals a human has not pinned
    const stats = body.mode === "insights"
      ? await refreshInsights(Math.min(50, body.max ?? 15))
      : body.mode === "reclassify"
      ? await reclassifyKinds(Math.min(25, body.max ?? 10), body.afterId ?? null)
      : body.mode === "split"
      ? await splitFrankenDeals(Math.min(8, body.max ?? 3), body.afterId ?? null)
      : await run();
    return json({ ok: true, ...stats });
  } catch (e) {
    const msg = errStr(e);
    await db().from("deal_scan_state").update({
      last_error: msg,
      last_run_at: new Date().toISOString(),
    })
      .eq("id", 1);
    await logConnector({
      connector: "deal_scan",
      level: "error",
      event: "scan_failed",
      message: msg,
      throttleMinutes: 60,
    });
    return json({ ok: false, error: msg }, 500);
  } finally {
    await db().from("deal_scan_state").update({ running_since: null }).eq("id", 1);
  }
});

async function run() {
  const state = await loadState();
  const mode = state.backfill_done ? "incremental" : "backfill";

  let threadIds: string[] = [];
  let nextPageToken: string | undefined;

  if (mode === "backfill") {
    // page size == batch size so the saved pageToken is an exact cursor
    const page = await listThreads(
      `${BASE_Q} newer_than:${BACKFILL_DAYS}d`,
      MAX_THREADS_PER_RUN,
      state.backfill_page_token ?? undefined,
    );
    threadIds = page.threads.map((t) => t.id);
    nextPageToken = page.nextPageToken;
  } else {
    const fallbackMs = Date.now() - 86_400_000;
    const afterSec = Math.floor(((state.watermark_ms ?? fallbackMs) - 6 * 3_600_000) / 1000);
    let token: string | undefined;
    for (let i = 0; i < 3; i++) {
      const page = await listThreads(`${BASE_Q} after:${afterSec}`, 100, token);
      threadIds.push(...page.threads.map((t) => t.id));
      token = page.nextPageToken;
      if (!token) break;
    }
    threadIds = [...new Set(threadIds)];
  }

  const counts = {
    threads_seen: threadIds.length,
    processed: 0,
    skipped: 0,
    noise: 0,
    non_deal: 0,
    created: 0,
    updated: 0,
  };
  let maxInternalMs = state.watermark_ms ?? 0;

  // Only the incremental lane pings the lead desk. The 365-day backfill walks
  // historic threads — alerting on those would blast months of old leads.
  const notifyLeads = mode === "incremental";

  for (const tid of threadIds) {
    const r = await processThread(tid, notifyLeads);
    counts[r.outcome]++;
    if (r.outcome !== "skipped") counts.processed++;
    if (r.maxMs > maxInternalMs) maxInternalMs = r.maxMs;
  }

  await sweepFollowUps();

  const patch: Record<string, unknown> = {
    last_run_at: new Date().toISOString(),
    last_error: null,
    threads_scanned: state.threads_scanned + counts.processed,
    watermark_ms: maxInternalMs || null,
  };
  if (mode === "backfill") {
    patch.backfill_page_token = nextPageToken ?? null;
    if (!nextPageToken) patch.backfill_done = true;
  }
  await db().from("deal_scan_state").update(patch).eq("id", 1);

  return { mode, ...counts, backfill_done: mode === "incremental" || !nextPageToken };
}

async function loadState(): Promise<ScanState> {
  const { data, error } = await db()
    .from("deal_scan_state")
    .select("backfill_done, backfill_page_token, watermark_ms, threads_scanned")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`deal_scan_state read failed: ${error.message}`);
  if (data) return data as ScanState;
  const { error: insErr } = await db().from("deal_scan_state").insert({ id: 1 });
  if (insErr) throw new Error(`deal_scan_state init failed: ${insErr.message}`);
  return {
    backfill_done: false,
    backfill_page_token: null,
    watermark_ms: null,
    threads_scanned: 0,
  };
}

type Outcome = "skipped" | "noise" | "non_deal" | "created" | "updated";

async function processThread(
  tid: string,
  notifyLeads = false,
): Promise<{ outcome: Outcome; maxMs: number }> {
  const msgs = await getThreadParsed(tid);
  if (!msgs.length) return { outcome: "skipped", maxMs: 0 };
  const maxMs = Math.max(...msgs.map((m) => m.internalDateMs));

  const ids = msgs.map((m) => m.email.gmail_message_id);
  const { data: knownRows, error: knownErr } = await db()
    .from("deal_emails")
    .select("gmail_message_id, deal_id")
    .in("gmail_message_id", ids);
  if (knownErr) throw new Error(`deal_emails lookup failed: ${knownErr.message}`);

  const known = new Set((knownRows ?? []).map((r) => r.gmail_message_id));
  const newMsgs = msgs.filter((m) => !known.has(m.email.gmail_message_id));
  if (!newMsgs.length) return { outcome: "skipped", maxMs };

  const existingDealId = (knownRows ?? []).find((r) => r.deal_id)?.deal_id ?? null;

  // Cheap noise gate: purely-inbound machine mail never reaches OpenAI.
  const hasOutbound = msgs.some((m) => (m.email.from_email ?? "").toLowerCase().includes(MAILBOX));
  const inboundFroms = msgs
    .filter((m) => !(m.email.from_email ?? "").toLowerCase().includes(MAILBOX))
    .map((m) => m.email.from_email ?? "");
  if (
    !existingDealId && !hasOutbound && inboundFroms.length > 0 && inboundFroms.every(isNoiseSender)
  ) {
    await insertLedger(newMsgs, null);
    return { outcome: "noise", maxMs };
  }

  let existing: DealRow | null = null;
  if (existingDealId) {
    const { data } = await db().from("deals").select(
      "id, company_name, company_domain, kind, contact_name, contact_email, stage, samples_sent_at, first_email_at, manual_stage_override, manual_kind_override",
    ).eq("id", existingDealId).maybeSingle();
    existing = (data as DealRow | null) ?? null;
  }

  const transcript = buildTranscript(
    msgs.map((m) => ({
      from: m.email.from_email ?? "",
      to: m.email.to_email ?? "",
      subject: m.email.subject ?? "",
      dateIso: m.internalDateMs ? new Date(m.internalDateMs).toISOString().slice(0, 10) : "",
      body: m.email.body_plain || m.email.snippet || "",
    })),
    MAILBOX,
  );

  const ex = await extractDeal(
    transcript,
    existing
      ? { company_name: existing.company_name, stage: existing.stage, kind: existing.kind }
      : null,
  );

  if (!ex.is_deal && !existing) {
    await insertLedger(newMsgs, null);
    return { outcome: "non_deal", maxMs };
  }

  if (!existing) existing = await matchDeal(ex, msgs);

  const timesMs = msgs.map((m) => m.internalDateMs).filter((t) => t > 0);
  const firstMs = timesMs.length ? Math.min(...timesMs) : Date.now();
  const lastMs = timesMs.length ? Math.max(...timesMs) : Date.now();
  const lastMsg = msgs[msgs.length - 1];
  const lastDir = (lastMsg.email.from_email ?? "").toLowerCase().includes(MAILBOX)
    ? "outbound"
    : "inbound";

  let dealId: string;
  let outcome: Outcome;

  if (!existing) {
    const fu = computeFollowUp({
      stage: ex.stage,
      lastEmailAtMs: lastMs,
      lastDirection: lastDir,
      samplesSentAtMs: ex.samples_sent ? lastMs : null,
      aiFollowUp: ex.follow_up_needed,
      aiReason: ex.follow_up_reason,
    }, Date.now());
    const { data, error } = await db().from("deals").insert({
      company_name: ex.company_name ?? fallbackCompanyName(msgs),
      company_domain: ex.company_domain ?? threadCompanyDomain(msgs),
      kind: ex.kind,
      contact_name: ex.contact_name,
      contact_email: ex.contact_email ?? threadContactEmail(msgs),
      stage: ex.stage,
      samples_sent_at: ex.samples_sent ? new Date(lastMs).toISOString() : null,
      next_step: ex.next_step,
      next_step_owner: ex.next_step_owner,
      follow_up_needed: fu.needed,
      follow_up_reason: fu.reason,
      commercials: ex.commercials,
      summary: ex.summary,
      last_email_at: new Date(lastMs).toISOString(),
      last_email_direction: lastDir,
      first_email_at: new Date(firstMs).toISOString(),
      ai_confidence: ex.confidence,
      interest_temp: ex.temperature,
      insights: insightsOf(ex),
    }).select("id").single();
    if (error) throw new Error(`deals insert failed: ${error.message}`);
    dealId = (data as { id: string }).id;
    outcome = "created";

    // Fresh wholesale / partnership lead → WhatsApp the lead desk once.
    // Claim-guarded on the deal id, so a rescan can never re-ping. Recency
    // guard keeps an old thread that only just got scanned from firing.
    if (
      notifyLeads && LEAD_DEAL_KINDS.has(ex.kind) &&
      Date.now() - lastMs < LEAD_ALERT_MAX_AGE_MS
    ) {
      await pingLeadDesk({
        claimKey: `lead_alert:deal:${dealId}`,
        label: DEAL_KIND_LABEL[ex.kind] ?? "New lead",
        ref: "—",
        name: ex.company_name ?? fallbackCompanyName(msgs),
        contact: ex.contact_email ?? threadContactEmail(msgs),
        details: ex.summary || ex.next_step || "New inbound lead on hello@ — see /dashboard/deals",
      }).catch((e) => console.error("[deal-scan] lead desk ping failed", e));
    }
  } else {
    const stage = mergeStage(existing.stage, ex.stage, existing.manual_stage_override);
    const samplesSentAt = existing.samples_sent_at ??
      (ex.samples_sent ? new Date(lastMs).toISOString() : null);
    const fu = computeFollowUp({
      stage,
      lastEmailAtMs: lastMs,
      lastDirection: lastDir,
      samplesSentAtMs: samplesSentAt ? new Date(samplesSentAt).getTime() : null,
      aiFollowUp: ex.follow_up_needed,
      aiReason: ex.follow_up_reason,
    }, Date.now());
    const patch: Record<string, unknown> = {
      stage,
      // The scanner may correct a misclassified kind (e.g. an influencer
      // collab filed under HoReCa) unless a human set it from the dashboard.
      kind: existing.manual_kind_override || !ex.is_deal || ex.kind === "other"
        ? existing.kind
        : ex.kind,
      contact_name: existing.contact_name ?? ex.contact_name,
      contact_email: existing.contact_email ?? ex.contact_email,
      samples_sent_at: samplesSentAt,
      next_step: ex.next_step,
      next_step_owner: ex.next_step_owner,
      follow_up_needed: fu.needed,
      follow_up_reason: fu.reason,
      commercials: ex.commercials ?? undefined,
      summary: ex.summary ?? undefined,
      last_email_at: new Date(lastMs).toISOString(),
      last_email_direction: lastDir,
      first_email_at:
        existing.first_email_at && new Date(existing.first_email_at).getTime() < firstMs
          ? existing.first_email_at
          : new Date(firstMs).toISOString(),
      ai_confidence: ex.confidence,
      interest_temp: ex.temperature,
      insights: insightsOf(ex),
    };
    if (stage !== existing.stage) patch.stage_updated_at = new Date().toISOString();
    const { error } = await db().from("deals").update(patch).eq("id", existing.id);
    if (error) throw new Error(`deals update failed: ${error.message}`);
    dealId = existing.id;
    outcome = "updated";
  }

  await insertLedger(newMsgs, dealId);

  // keep email_count exact from the ledger
  const { count } = await db()
    .from("deal_emails")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);
  await db().from("deals").update({ email_count: count ?? 0 }).eq("id", dealId);

  return { outcome, maxMs };
}

// Attach a fresh thread to an existing deal by domain, then by name. A name
// match alone is NOT enough: two different people (an SEO pitcher and an
// influencer, say) can both get extracted under the same company label, and
// gluing their threads into one deal makes kind/stage meaningless. So a name
// match must be corroborated by the same contact email, or the candidate must
// have no contact identity at all to contradict.
async function matchDeal(ex: DealExtraction, msgs: ThreadMessage[]): Promise<DealRow | null> {
  const sel =
    "id, company_name, company_domain, kind, contact_name, contact_email, stage, samples_sent_at, first_email_at, manual_stage_override, manual_kind_override";
  const domain = ex.company_domain ?? threadCompanyDomain(msgs);
  if (domain) {
    const { data } = await db().from("deals").select(sel).ilike("company_domain", domain)
      .order("created_at", { ascending: false }).limit(1);
    if (data?.length) return data[0] as DealRow;
  }
  if (ex.company_name) {
    const { data } = await db().from("deals").select(sel).ilike("company_name", ex.company_name)
      .order("created_at", { ascending: false }).limit(1);
    if (data?.length) {
      const cand = data[0] as DealRow;
      const email = (ex.contact_email ?? threadContactEmail(msgs))?.toLowerCase() ?? null;
      const sameContact = !!email && !!cand.contact_email &&
        cand.contact_email.toLowerCase() === email;
      const nothingToContradict = !cand.contact_email && !cand.company_domain;
      if (sameContact || nothingToContradict) return cand;
    }
  }
  return null;
}

async function insertLedger(msgs: ThreadMessage[], dealId: string | null) {
  if (!msgs.length) return;
  const rows = msgs.map((m) => ({
    deal_id: dealId,
    gmail_message_id: m.email.gmail_message_id,
    gmail_thread_id: m.email.gmail_thread_id,
    direction: (m.email.from_email ?? "").toLowerCase().includes(MAILBOX) ? "outbound" : "inbound",
    from_email: m.email.from_email ? extractAddress(m.email.from_email).slice(0, 300) : null,
    to_email: m.email.to_email ? extractAddress(m.email.to_email).slice(0, 300) : null,
    subject: m.email.subject?.slice(0, 500) ?? null,
    snippet: m.email.snippet?.slice(0, 300) ?? null,
    sent_at: m.internalDateMs ? new Date(m.internalDateMs).toISOString() : null,
  }));
  const { error } = await db().from("deal_emails").upsert(rows, {
    onConflict: "gmail_message_id",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`deal_emails insert failed: ${error.message}`);
}

// Refresh follow-up flags + auto-dormancy across the live pipeline, so flags
// age correctly even when no new mail arrives.
async function sweepFollowUps() {
  const { data } = await db()
    .from("deals")
    .select(
      "id, stage, last_email_at, last_email_direction, samples_sent_at, manual_stage_override, follow_up_needed, follow_up_reason",
    )
    .not("stage", "in", "(won,lost)");
  const now = Date.now();
  for (const d of data ?? []) {
    const lastMs = d.last_email_at ? new Date(d.last_email_at).getTime() : null;
    let stage = d.stage as DealStage;
    if (shouldGoDormant(stage, lastMs, d.manual_stage_override, now)) stage = "dormant";
    const fu = computeFollowUp({
      stage,
      lastEmailAtMs: lastMs,
      lastDirection: (d.last_email_direction as "inbound" | "outbound" | null) ?? null,
      samplesSentAtMs: d.samples_sent_at ? new Date(d.samples_sent_at).getTime() : null,
    }, now);
    if (stage !== d.stage || fu.needed !== d.follow_up_needed || fu.reason !== d.follow_up_reason) {
      await db().from("deals").update({
        stage,
        ...(stage !== d.stage ? { stage_updated_at: new Date().toISOString() } : {}),
        follow_up_needed: fu.needed,
        follow_up_reason: fu.reason,
      }).eq("id", d.id);
    }
  }
}

// Backfill sentiment/willingness for deals created before insights existed:
// re-read one thread per deal and store the relationship read. No ledger or
// stage changes beyond the normal merge rules.
async function refreshInsights(max: number) {
  const { data: pending, error } = await db()
    .from("deals")
    .select("id, company_name, stage, kind")
    .is("insights", null)
    .limit(max);
  if (error) throw new Error(`insights query failed: ${error.message}`);

  let refreshed = 0;
  const errors: string[] = [];
  for (const d of pending ?? []) {
    try {
      const { data: em } = await db()
        .from("deal_emails")
        .select("gmail_thread_id")
        .eq("deal_id", d.id)
        .order("sent_at", { ascending: false })
        .limit(1);
      const tid = em?.[0]?.gmail_thread_id;
      if (!tid) continue;
      const msgs = await getThreadParsed(tid);
      if (!msgs.length) continue;
      const transcript = buildTranscript(
        msgs.map((m) => ({
          from: m.email.from_email ?? "",
          to: m.email.to_email ?? "",
          subject: m.email.subject ?? "",
          dateIso: m.internalDateMs ? new Date(m.internalDateMs).toISOString().slice(0, 10) : "",
          body: m.email.body_plain || m.email.snippet || "",
        })),
        MAILBOX,
      );
      const ex = await extractDeal(transcript, {
        company_name: d.company_name,
        stage: d.stage,
        kind: d.kind,
      });
      await db().from("deals").update({
        interest_temp: ex.temperature,
        insights: insightsOf(ex),
        summary: ex.summary ?? undefined,
        commercials: ex.commercials ?? undefined,
      }).eq("id", d.id);
      refreshed++;
    } catch (e) {
      errors.push(`${d.company_name}: ${errStr(e).slice(0, 120)}`);
    }
  }
  await db().from("deal_scan_state").update({
    last_run_at: new Date().toISOString(),
    last_error: errors.length ? errors.join(" | ").slice(0, 500) : null,
  }).eq("id", 1);
  return { mode: "insights", pending: pending?.length ?? 0, refreshed, errors: errors.length };
}

// One-off repair pass after the classification prompt was tightened: re-read
// each deal's latest thread and re-judge kind (plus refresh the insight read,
// since the extraction is already paid for). Never touches deals whose kind a
// human pinned, never touches stage. Page through with afterId until done.
async function reclassifyKinds(max: number, afterId: string | null) {
  let q = db()
    .from("deals")
    .select("id, company_name, stage, kind")
    .eq("manual_kind_override", false)
    .order("id", { ascending: true })
    .limit(max);
  if (afterId) q = q.gt("id", afterId);
  const { data: pending, error } = await q;
  if (error) throw new Error(`reclassify query failed: ${error.message}`);

  let scanned = 0;
  let changed = 0;
  const changes: { company: string; from: string; to: string }[] = [];
  const errors: string[] = [];
  let lastId: string | null = afterId;

  for (const d of pending ?? []) {
    lastId = d.id;
    try {
      const { data: em } = await db()
        .from("deal_emails")
        .select("gmail_thread_id")
        .eq("deal_id", d.id)
        .order("sent_at", { ascending: false })
        .limit(1);
      const tid = em?.[0]?.gmail_thread_id;
      if (!tid) continue;
      const msgs = await getThreadParsed(tid);
      if (!msgs.length) continue;
      const transcript = buildTranscript(
        msgs.map((m) => ({
          from: m.email.from_email ?? "",
          to: m.email.to_email ?? "",
          subject: m.email.subject ?? "",
          dateIso: m.internalDateMs ? new Date(m.internalDateMs).toISOString().slice(0, 10) : "",
          body: m.email.body_plain || m.email.snippet || "",
        })),
        MAILBOX,
      );
      const ex = await extractDeal(transcript, {
        company_name: d.company_name,
        stage: d.stage,
        kind: d.kind,
      });
      scanned++;
      const patch: Record<string, unknown> = {
        interest_temp: ex.temperature,
        insights: insightsOf(ex),
      };
      if (ex.is_deal && ex.kind !== "other" && ex.kind !== d.kind) {
        patch.kind = ex.kind;
        changed++;
        changes.push({ company: d.company_name, from: d.kind, to: ex.kind });
      }
      await db().from("deals").update(patch).eq("id", d.id);
    } catch (e) {
      errors.push(`${d.company_name}: ${errStr(e).slice(0, 120)}`);
    }
  }

  return {
    mode: "reclassify",
    scanned,
    changed,
    changes,
    errors,
    lastId,
    done: (pending?.length ?? 0) < max,
  };
}

// Repair pass for "franken-deals": deals whose ledger holds threads from more
// than one real counterparty (a name-only match used to glue them together).
// Each gmail thread is re-judged on its own; threads that belong to a
// different counterparty are moved to their own (or a matching) deal, spam
// threads are detached, and every touched deal's counters are recomputed.
async function splitFrankenDeals(max: number, afterId: string | null) {
  const { data: emailRows, error: emErr } = await db()
    .from("deal_emails")
    .select("deal_id, from_email, direction")
    .not("deal_id", "is", null)
    .limit(10000);
  if (emErr) throw new Error(`split query failed: ${emErr.message}`);

  const sendersByDeal = new Map<string, Set<string>>();
  for (const r of emailRows ?? []) {
    if (r.direction !== "inbound" || !r.from_email) continue;
    const addr = extractAddress(r.from_email).toLowerCase();
    if (isNoiseSender(addr)) continue;
    const set = sendersByDeal.get(r.deal_id as string) ?? new Set<string>();
    set.add(addr);
    sendersByDeal.set(r.deal_id as string, set);
  }
  const candidateIds = [...sendersByDeal.entries()]
    .filter(([, s]) => s.size > 1)
    .map(([id]) => id)
    .sort()
    .filter((id) => !afterId || id > afterId)
    .slice(0, max);

  let processed = 0;
  let created = 0;
  let detached = 0;
  const changes: string[] = [];
  const errors: string[] = [];
  let lastId: string | null = afterId;

  for (const dealId of candidateIds) {
    lastId = dealId;
    try {
      const { data: deal } = await db().from("deals").select("*").eq("id", dealId).maybeSingle();
      if (!deal) continue;
      const { data: rows } = await db()
        .from("deal_emails")
        .select("id, gmail_thread_id, sent_at")
        .eq("deal_id", dealId)
        .order("sent_at", { ascending: true });
      const threadOrder: string[] = [];
      for (const r of rows ?? []) {
        if (!threadOrder.includes(r.gmail_thread_id)) threadOrder.push(r.gmail_thread_id);
      }
      if (threadOrder.length < 2) {
        processed++;
        continue;
      }

      const touched = new Set<string>([dealId]);
      for (let i = 0; i < threadOrder.length; i++) {
        const tid = threadOrder[i];
        const msgs = await getThreadParsed(tid);
        if (!msgs.length) continue;
        const transcript = buildTranscript(
          msgs.map((m) => ({
            from: m.email.from_email ?? "",
            to: m.email.to_email ?? "",
            subject: m.email.subject ?? "",
            dateIso: m.internalDateMs ? new Date(m.internalDateMs).toISOString().slice(0, 10) : "",
            body: m.email.body_plain || m.email.snippet || "",
          })),
          MAILBOX,
        );
        const ex = await extractDeal(transcript, null); // fresh judgement, no anchor

        if (i === 0) {
          // Primary thread re-describes the original deal.
          await db().from("deals").update({
            company_name: ex.company_name ?? deal.company_name,
            company_domain: ex.company_domain ?? deal.company_domain,
            kind: deal.manual_kind_override || !ex.is_deal || ex.kind === "other"
              ? deal.kind
              : ex.kind,
            stage: deal.manual_stage_override ? deal.stage : ex.stage,
            contact_name: ex.contact_name ?? deal.contact_name,
            contact_email: ex.contact_email ?? deal.contact_email,
            next_step: ex.next_step,
            next_step_owner: ex.next_step_owner,
            commercials: ex.commercials,
            summary: ex.summary,
            ai_confidence: ex.confidence,
            interest_temp: ex.temperature,
            insights: insightsOf(ex),
          }).eq("id", dealId);
          continue;
        }

        // Does this thread belong to the (re-described) primary counterparty?
        const primaryDomain = (ex.company_domain ?? null) &&
          deal.company_domain &&
          ex.company_domain!.toLowerCase() === (deal.company_domain as string).toLowerCase();
        const primaryName = ex.company_name && deal.company_name &&
          ex.company_name.toLowerCase() === (deal.company_name as string).toLowerCase();
        const threadEmail = msgs
          .map((m) => m.email.from_email ?? "")
          .filter((f) => f && !f.toLowerCase().includes(MAILBOX))
          .map((f) => extractAddress(f).toLowerCase())[0] ?? null;
        const primaryContact = threadEmail && deal.contact_email &&
          threadEmail === (deal.contact_email as string).toLowerCase();
        if (primaryDomain || primaryName || primaryContact) continue;

        const threadRowIds = (rows ?? []).filter((r) => r.gmail_thread_id === tid).map((r) => r.id);

        if (!ex.is_deal) {
          await db().from("deal_emails").update({ deal_id: null }).in("id", threadRowIds);
          detached++;
          changes.push(`${deal.company_name}: detached non-deal thread`);
          continue;
        }

        const times = msgs.map((m) => m.internalDateMs).filter((t) => t > 0);
        const tFirst = times.length ? Math.min(...times) : Date.now();
        const tLast = times.length ? Math.max(...times) : Date.now();
        const lastDir = (msgs[msgs.length - 1].email.from_email ?? "").toLowerCase()
            .includes(MAILBOX)
          ? "outbound"
          : "inbound";
        const fu = computeFollowUp({
          stage: ex.stage,
          lastEmailAtMs: tLast,
          lastDirection: lastDir,
          samplesSentAtMs: ex.samples_sent ? tLast : null,
          aiFollowUp: ex.follow_up_needed,
          aiReason: ex.follow_up_reason,
        }, Date.now());
        const { data: newDeal, error: insErr } = await db().from("deals").insert({
          company_name: ex.company_name ?? fallbackCompanyName(msgs),
          company_domain: ex.company_domain ?? threadCompanyDomain(msgs),
          kind: ex.kind,
          contact_name: ex.contact_name,
          contact_email: ex.contact_email ?? threadContactEmail(msgs),
          stage: ex.stage,
          samples_sent_at: ex.samples_sent ? new Date(tLast).toISOString() : null,
          next_step: ex.next_step,
          next_step_owner: ex.next_step_owner,
          follow_up_needed: fu.needed,
          follow_up_reason: fu.reason,
          commercials: ex.commercials,
          summary: ex.summary,
          last_email_at: new Date(tLast).toISOString(),
          last_email_direction: lastDir,
          first_email_at: new Date(tFirst).toISOString(),
          ai_confidence: ex.confidence,
          interest_temp: ex.temperature,
          insights: insightsOf(ex),
        }).select("id").single();
        if (insErr || !newDeal) throw new Error(`split insert failed: ${insErr?.message}`);
        await db().from("deal_emails").update({ deal_id: newDeal.id }).in("id", threadRowIds);
        touched.add(newDeal.id as string);
        created++;
        changes.push(
          `${deal.company_name}: split out "${ex.company_name ?? "?"}" as ${ex.kind}`,
        );
      }

      for (const id of touched) await recountDeal(id);
      processed++;
    } catch (e) {
      errors.push(`${dealId}: ${errStr(e).slice(0, 140)}`);
    }
  }

  return {
    mode: "split",
    candidates: candidateIds.length,
    processed,
    created,
    detached,
    changes,
    errors,
    lastId,
    done: candidateIds.length < max,
  };
}

// Recompute a deal's ledger-derived counters; delete the deal if the split
// left it with no emails at all.
async function recountDeal(dealId: string) {
  const { data } = await db()
    .from("deal_emails")
    .select("direction, sent_at")
    .eq("deal_id", dealId)
    .order("sent_at", { ascending: true });
  if (!data?.length) {
    await db().from("deals").delete().eq("id", dealId);
    return;
  }
  await db().from("deals").update({
    email_count: data.length,
    first_email_at: data[0].sent_at,
    last_email_at: data[data.length - 1].sent_at,
    last_email_direction: data[data.length - 1].direction,
  }).eq("id", dealId);
}

function fallbackCompanyName(msgs: ThreadMessage[]): string {
  const firstInbound = msgs.find((m) =>
    !(m.email.from_email ?? "").toLowerCase().includes(MAILBOX)
  );
  return firstInbound?.email.from_name || firstInbound?.email.from_email || "Unknown counterparty";
}

function threadCompanyDomain(msgs: ThreadMessage[]): string | null {
  for (const m of msgs) {
    const from = m.email.from_email ?? "";
    if (from.toLowerCase().includes(MAILBOX)) continue;
    const d = companyDomainOf(from);
    if (d) return d;
  }
  return null;
}

function threadContactEmail(msgs: ThreadMessage[]): string | null {
  const firstInbound = msgs.find((m) =>
    !(m.email.from_email ?? "").toLowerCase().includes(MAILBOX)
  );
  return firstInbound?.email.from_email
    ? extractAddress(firstInbound.email.from_email).toLowerCase()
    : null;
}

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json" },
  });
}
