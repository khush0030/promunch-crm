// deno-lint-ignore-file no-explicit-any -- DB rows are untyped
// ORM (Reputation) weekly WhatsApp digest (A) and spike alerts (B) to the
// INTERNAL team. Contract: docs/plans/2026-10-09-orm-v2-spec.md §5.
//
// Recipients = the ORM alert recipients (orm_settings.alert_wa_ids, else
// SUPPORT_ALERT_WA_IDS). Never a customer. Both ship dark: the settings
// default to OFF, and a missing column (migration not applied) reads as OFF.
//
// §0 never twice:
//   DIGEST  insert-first claim on orm_digest_log(week). 23505 → only a row
//           left 'failed' with attempts < 3 may be re-claimed, by CAS on
//           (status, attempts). Per recipient a wa_messages ledger check on
//           `orm_digest:<week>:<wa_id>` before the single send. Any unknown
//           outcome (network) burns the remaining attempts: in doubt, no send.
//   SPIKE   insert-first claim on orm_spike_log(key), key =
//           '<product>|<topic>|<window start>'. Terminal (sent/failed), no
//           retry. Per recipient ledger check on `orm_spike:<key>:<wa_id>`.
//
// The pure helpers (IST week key, periods, var builders, spike grouping) are
// unit-tested in orm-reports_test.ts.

import { db } from "./supabase.ts";
import { errStr } from "./connector-log.ts";
import { callWaSend } from "./influencer-send.ts";
import { cleanParam, siteAppUrl } from "./influencers.ts";
import { supportAlertWaIds } from "./support-alert.ts";
import { alertRecipients } from "./orm-alerts.ts";
import { computeScore, type ScoreMention, scoreBand } from "./orm-score.ts";

const DAY = 86_400_000;
const IST_OFFSET = 330 * 60_000;
const OK_LEDGER = ["sent", "delivered", "read"];
export const DIGEST_MAX_ATTEMPTS = 3;
export const MAX_SPIKES_PER_TICK = 5;
export const NO_PRODUCT_LABEL = "Not sure which product";

export interface ReportSettings {
  alert_wa_ids: string[] | null;
  weekly_digest_enabled?: boolean | null;
  weekly_digest_dow?: number | null;
  weekly_digest_hour_ist?: number | null;
  spike_alerts_enabled?: boolean | null;
  spike_threshold?: number | null;
  spike_window_days?: number | null;
}

// ---------------------------------------------------------------------------
// IST time helpers (pure)
// ---------------------------------------------------------------------------

/** Epoch ms of 00:00 IST on the IST day containing t. */
export function istDayStart(t: number): number {
  return Math.floor((t + IST_OFFSET) / DAY) * DAY - IST_OFFSET;
}

/** 0 = Sunday .. 6 = Saturday, in IST (matches orm_settings.weekly_digest_dow). */
export function istDow(t: number): number {
  return new Date(t + IST_OFFSET).getUTCDay();
}

export function istHourOf(t: number): number {
  return new Date(t + IST_OFFSET).getUTCHours();
}

/** ISO week of the IST date, 'YYYY-Www' (orm_digest_log.week). */
export function istIsoWeek(t: number): string {
  const d = new Date(t + IST_OFFSET);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = date.getUTCDay() || 7; // Mon=1..Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dow); // Thursday of this ISO week
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "5 Oct" for the IST date of t. */
export function istShortDate(t: number): string {
  const d = new Date(t + IST_OFFSET);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** 'YYYY-MM-DD' of the IST date of t. */
export function istDateStr(t: number): string {
  return new Date(t + IST_OFFSET).toISOString().slice(0, 10);
}

/**
 * Digest periods: the 7 full IST days before today (cur) and the 7 before
 * that (prev). Half-open [from, to).
 */
export function digestPeriods(now: number): { cur: { from: number; to: number }; prev: { from: number; to: number } } {
  const to = istDayStart(now);
  return { cur: { from: to - 7 * DAY, to }, prev: { from: to - 14 * DAY, to: to - 7 * DAY } };
}

/** posted_at, else collected_at (same rule as the alert window). */
export function mentionTime(m: { posted_at?: string | null; collected_at?: string | null }): number {
  const t = Date.parse(m.posted_at ?? m.collected_at ?? "");
  return Number.isFinite(t) ? t : NaN;
}

/** Digest is due: enabled, IST weekday matches, IST hour reached. */
export function digestDue(s: ReportSettings, now: number): boolean {
  if (s.weekly_digest_enabled !== true) return false;
  const dow = s.weekly_digest_dow ?? 1;
  const hour = s.weekly_digest_hour_ist ?? 9;
  return istDow(now) === dow && istHourOf(now) >= hour;
}

// ---------------------------------------------------------------------------
// digest content (pure)
// ---------------------------------------------------------------------------

export interface DigestMention extends ScoreMention {
  id?: string;
  product?: string | null;
  topics?: string[] | null;
  posted_at?: string | null;
  collected_at?: string | null;
}

export const topicLabel = (t: string) => String(t ?? "").replace(/_/g, " ").trim();

function ratingOf(m: DigestMention): number | null {
  const r = m.rating == null || m.rating === "" ? NaN : Number(m.rating);
  return Number.isFinite(r) && r >= 1 && r <= 5 ? r : null;
}

/** Worst named product: % negative desc, then avg rating asc (null last). */
export function worstProduct(ms: DigestMention[]): { product: string; avg_rating: number | null; pct_negative: number } | null {
  const by = new Map<string, { product: string; n: number; neg: number; scored: number; rs: number[] }>();
  for (const m of ms) {
    const p = String(m.product ?? "").trim();
    if (!p) continue;
    const k = p.toLowerCase();
    const g = by.get(k) ?? { product: p, n: 0, neg: 0, scored: 0, rs: [] };
    g.n++;
    if (m.sentiment != null) {
      g.scored++;
      if (m.sentiment < 0) g.neg++;
    }
    const r = ratingOf(m);
    if (r != null) g.rs.push(r);
    by.set(k, g);
  }
  const rows = [...by.values()].map((g) => ({
    product: g.product,
    avg_rating: g.rs.length ? Math.round((g.rs.reduce((a, b) => a + b, 0) / g.rs.length) * 10) / 10 : null,
    pct_negative: g.scored ? Math.round((g.neg / g.scored) * 100) : 0,
  }));
  rows.sort((a, b) =>
    b.pct_negative - a.pct_negative ||
    (a.avg_rating ?? 99) - (b.avg_rating ?? 99) ||
    a.product.localeCompare(b.product)
  );
  return rows[0] ?? null;
}

/** Most frequent topic among negative mentions ('other' last resort). */
export function topComplaintTopic(ms: DigestMention[]): string | null {
  const c = new Map<string, number>();
  for (const m of ms) {
    if (m.sentiment == null || m.sentiment >= 0) continue;
    for (const t of m.topics ?? []) if (t) c.set(t, (c.get(t) ?? 0) + 1);
  }
  const rows = [...c.entries()].sort((a, b) =>
    (a[0] === "other" ? 1 : 0) - (b[0] === "other" ? 1 : 0) || b[1] - a[1] || a[0].localeCompare(b[0])
  );
  return rows[0]?.[0] ?? null;
}

export interface DigestSummary {
  week_start: number;
  mentions: number;
  score: number | null;
  score_prev: number | null;
  avg_rating: number | null;
  pct_negative: number | null;
  worst: { product: string; avg_rating: number | null } | null;
  top_complaint: string | null;
  open_cases: number;
}

/** Split the fetched rows into cur/prev periods and summarise (pure). */
export function summariseDigest(rows: DigestMention[], now: number, openCases: number): DigestSummary {
  const { cur, prev } = digestPeriods(now);
  const inP = (p: { from: number; to: number }) => rows.filter((m) => {
    const t = mentionTime(m);
    return t >= p.from && t < p.to;
  });
  const c = inP(cur).filter((m) => m.relevant !== false && m.enriched_at !== null);
  const p = inP(prev);
  const s = computeScore(c);
  const sp = computeScore(p);
  const w = worstProduct(c);
  return {
    week_start: cur.from,
    mentions: s.counts.mentions,
    score: s.score,
    score_prev: sp.score,
    avg_rating: s.avg_rating,
    pct_negative: s.counts.scored ? Math.round((s.counts.negative / s.counts.scored) * 100) : null,
    worst: w ? { product: w.product, avg_rating: w.avg_rating } : null,
    top_complaint: topComplaintTopic(c),
    open_cases: openCases,
  };
}

const stars = (n: number) => `${n.toFixed(1)}★`;

/** ops_ticket_alert {{1}}..{{5}} for the digest. ≤300 chars each, no em dashes. */
export function buildDigestVars(d: DigestSummary, appUrl: string): Record<string, string> {
  const link = `${appUrl.replace(/\/+$/, "")}/dashboard/reputation?tab=overview`;
  const band = scoreBand(d.score);
  let v2 = d.score == null ? "No score this week" : `Score ${d.score}${band ? ` (${band})` : ""}`;
  if (d.score != null) {
    if (d.score_prev == null) v2 += ", no score last week";
    else {
      const delta = d.score - d.score_prev;
      v2 += delta === 0 ? ", same as last week" : `, ${delta > 0 ? "+" : ""}${delta} vs last week`;
    }
  }
  const v3 = [
    `${d.mentions} ${d.mentions === 1 ? "mention" : "mentions"}`,
    d.avg_rating == null ? "no ratings" : stars(d.avg_rating),
    d.pct_negative == null ? "no sentiment yet" : `${d.pct_negative}% negative`,
  ].join(" · ");
  const v4 = d.worst
    ? `Worst: ${d.worst.product} ${d.worst.avg_rating == null ? "(no ratings)" : stars(d.worst.avg_rating)}`
    : "Worst: no product data yet";
  const head = `Top complaint: ${d.top_complaint ? topicLabel(d.top_complaint) : "none"}. Open cases: ${d.open_cases}.`;
  const room = Math.max(20, 300 - link.length - 1);
  return {
    "1": cleanParam(`PROMUNCH reputation, week of ${istShortDate(d.week_start)}`, 300),
    "2": cleanParam(v2, 300),
    "3": cleanParam(v3, 300),
    "4": cleanParam(v4, 300),
    "5": `${cleanParam(head, room)} ${link}`.slice(0, 300),
  };
}

export const digestMarker = (week: string, waId: string) => `orm_digest:${week}:${waId}`;

// ---------------------------------------------------------------------------
// spikes (pure)
// ---------------------------------------------------------------------------

export interface SpikeMention {
  id: string;
  product: string | null;
  topics: string[] | null;
  sentiment: number | null;
  relevant?: boolean | null;
  posted_at?: string | null;
  collected_at?: string | null;
}

export interface SpikeGroup {
  key: string;
  product: string | null;
  topic: string;
  count: number;
  mention_ids: string[];
}

/** IST date of the window bucket containing now (floor to windowDays). */
export function spikeWindowStart(now: number, windowDays: number): string {
  const w = Math.max(1, Math.floor(windowDays));
  const idx = Math.floor((now + IST_OFFSET) / DAY);
  return new Date(Math.floor(idx / w) * w * DAY).toISOString().slice(0, 10);
}

const productKey = (p: string | null | undefined) => String(p ?? "").trim().toLowerCase() || "-";

export function spikeKey(product: string | null, topic: string, windowStart: string): string {
  return `${productKey(product)}|${topic}|${windowStart}`;
}

/**
 * Groups relevant negative mentions of the last windowDays by (product,
 * topic). A group alerts when count ≥ threshold, its key is not logged yet,
 * and it holds at least one mention not covered by an earlier spike for the
 * same product+topic (so a rolling window does not re-alert the same set).
 * Largest first. Topic 'other' never spikes.
 */
export function spikeGroups(
  ms: SpikeMention[],
  o: { now: number; windowDays: number; threshold: number },
  prior: Array<{ key: string; product: string | null; topic: string | null; mention_ids: string[] | null }> = [],
): SpikeGroup[] {
  const since = o.now - Math.max(1, o.windowDays) * DAY;
  const ws = spikeWindowStart(o.now, o.windowDays);
  const priorKeys = new Set(prior.map((p) => p.key));
  const priorIds = new Map<string, Set<string>>();
  for (const p of prior) {
    const k = `${productKey(p.product)}|${p.topic ?? ""}`;
    const set = priorIds.get(k) ?? new Set<string>();
    for (const id of p.mention_ids ?? []) set.add(id);
    priorIds.set(k, set);
  }
  const groups = new Map<string, SpikeGroup>();
  for (const m of ms) {
    if (m.relevant === false || m.sentiment == null || m.sentiment >= 0) continue;
    const t = mentionTime(m);
    if (!(t >= since && t <= o.now)) continue;
    for (const topic of new Set(m.topics ?? [])) {
      if (!topic || topic === "other") continue;
      const key = spikeKey(m.product, topic, ws);
      const g = groups.get(key) ?? { key, product: String(m.product ?? "").trim() || null, topic, count: 0, mention_ids: [] };
      if (!g.mention_ids.includes(m.id)) {
        g.mention_ids.push(m.id);
        g.count++;
      }
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .filter((g) => g.count >= o.threshold && !priorKeys.has(g.key))
    .filter((g) => {
      const seen = priorIds.get(`${productKey(g.product)}|${g.topic}`);
      return !seen || g.mention_ids.some((id) => !seen.has(id));
    })
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function spikeLine(g: Pick<SpikeGroup, "product" | "topic" | "count">, days: number): string {
  const what = `${g.count} complaints about ${topicLabel(g.topic)}`;
  const where = g.product ? ` on ${g.product}` : " (product not clear)";
  return `Possible batch issue: ${what}${where} in ${days} ${days === 1 ? "day" : "days"}`;
}

/** ops_ticket_alert {{1}}..{{5}} for a spike. ≤300 chars each, no em dashes. */
export function buildSpikeVars(g: SpikeGroup, days: number, appUrl: string): Record<string, string> {
  const link = `${appUrl.replace(/\/+$/, "")}/dashboard/reputation`;
  const room = Math.max(20, 300 - link.length - 1);
  return {
    "1": "Reputation spike",
    "2": cleanParam(g.product ?? NO_PRODUCT_LABEL, 80),
    "3": cleanParam(topicLabel(g.topic), 80),
    "4": cleanParam(`${g.count} complaints in ${days} ${days === 1 ? "day" : "days"}`, 80),
    "5": `${cleanParam(spikeLine(g, days) + ".", room)} ${link}`.slice(0, 300),
  };
}

export const spikeMarker = (key: string, waId: string) => `orm_spike:${key}:${waId}`;

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

type SendResult = { to: string; ok: boolean; message_id?: string | null; error?: string | null; ledger?: boolean; unknown?: boolean };

/** Ledger check then ONE send per recipient (no inline retry). */
async function sendToAll(to: string[], marker: (wa: string) => string, vars: Record<string, string>): Promise<SendResult[]> {
  const sb = db();
  const out: SendResult[] = [];
  for (const wa of to) {
    const mk = marker(wa);
    const { data: prior, error: pErr } = await sb.from("wa_messages").select("wa_message_id, status")
      .eq("sent_by", mk).in("status", OK_LEDGER).limit(1);
    if (pErr) { out.push({ to: wa, ok: false, error: `ledger: ${errStr(pErr)}`, unknown: true }); continue; } // in doubt: no send
    if (prior?.length) { out.push({ to: wa, ok: true, message_id: prior[0].wa_message_id ?? null, ledger: true }); continue; }
    const res = await callWaSend({
      to: wa,
      kind: "template",
      sent_by: mk,
      template: { name: Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert", language: "en", vars },
    });
    out.push({ to: wa, ok: res.ok, message_id: res.message_id ?? null, error: res.error ?? null, unknown: res.unknown });
  }
  return out;
}

const maskResults = (rs: SendResult[]) => rs.map((r) => ({ ...r, to: `…${r.to.slice(-4)}` }));

const DIGEST_COLS = "id, rating, sentiment, status, case_status, urgency, relevant, enriched_at, product, topics, posted_at, collected_at";

/** DIGEST step: once per IST week. */
export async function runDigest(settings: ReportSettings, now: number): Promise<Record<string, unknown>> {
  if (settings.weekly_digest_enabled !== true) return { skipped: "disabled" };
  if (!digestDue(settings, now)) return { skipped: "not_due" };
  const to = alertRecipients(settings.alert_wa_ids, supportAlertWaIds());
  if (!to.length) return { skipped: "no_recipients" };

  const sb = db();
  const week = istIsoWeek(now);
  const { error: insErr } = await sb.from("orm_digest_log").insert({ week, status: "claimed", attempts: 1 });
  let attempts = 1;
  if (insErr) {
    if (insErr.code !== "23505") throw insErr;
    const { data: cur, error: rErr } = await sb.from("orm_digest_log").select("status, attempts").eq("week", week).maybeSingle();
    if (rErr) throw rErr;
    if (!cur || cur.status !== "failed" || cur.attempts >= DIGEST_MAX_ATTEMPTS) return { skipped: "already_handled", week };
    const { data: won } = await sb.from("orm_digest_log")
      .update({ status: "claimed", attempts: cur.attempts + 1, updated_at: new Date().toISOString() })
      .eq("week", week).eq("status", "failed").eq("attempts", cur.attempts).select("week");
    if (!won?.length) return { skipped: "already_handled", week };
    attempts = cur.attempts + 1;
  }
  const finish = (patch: Record<string, unknown>) =>
    sb.from("orm_digest_log").update({ ...patch, updated_at: new Date().toISOString() }).eq("week", week);

  let summary: DigestSummary;
  try {
    const { prev } = digestPeriods(now);
    const since = new Date(prev.from).toISOString();
    const { data, error } = await sb.from("orm_mentions").select(DIGEST_COLS)
      .not("enriched_at", "is", null)
      .or("relevant.is.null,relevant.eq.true")
      .or(`posted_at.gte.${since},and(posted_at.is.null,collected_at.gte.${since})`)
      .limit(5000);
    if (error) throw error;
    const { count, error: cErr } = await sb.from("orm_mentions").select("id", { count: "exact", head: true })
      .in("case_status", ["open", "in_progress"]);
    if (cErr) throw cErr;
    summary = summariseDigest((data ?? []) as DigestMention[], now, count ?? 0);
  } catch (e) {
    await finish({ status: "failed", error: errStr(e).slice(0, 500) });
    throw e;
  }

  if (summary.mentions === 0) {
    await finish({ status: "skipped_empty", detail: summary, error: null });
    return { skipped: "empty_week", week };
  }

  const vars = buildDigestVars(summary, siteAppUrl());
  const results = await sendToAll(to, (wa) => digestMarker(week, wa), vars);
  const anyOk = results.some((r) => r.ok);
  const anyUnknown = results.some((r) => !r.ok && r.unknown);
  await finish({
    status: anyOk ? "sent" : "failed",
    // unknown outcome → never retried automatically (§0: in doubt, no send)
    ...(anyOk ? {} : anyUnknown ? { attempts: DIGEST_MAX_ATTEMPTS } : {}),
    error: anyOk ? null : (results.find((r) => r.error)?.error ?? "send failed").slice(0, 500),
    detail: { ...summary, vars, recipients: to.length, results: maskResults(results) },
  });
  return { week, sent: anyOk, attempts, recipients: to.length };
}

/** SPIKE step: one alert per (product, topic) per window. */
export async function runSpikes(settings: ReportSettings, now: number): Promise<Record<string, unknown>> {
  if (settings.spike_alerts_enabled !== true) return { skipped: "disabled" };
  const to = alertRecipients(settings.alert_wa_ids, supportAlertWaIds());
  if (!to.length) return { skipped: "no_recipients" };
  const days = Math.max(1, Math.min(30, Number(settings.spike_window_days ?? 7) || 7));
  const threshold = Math.max(2, Number(settings.spike_threshold ?? 3) || 3);

  const sb = db();
  const since = new Date(now - days * DAY).toISOString();
  const { data, error } = await sb.from("orm_mentions").select("id, product, topics, sentiment, relevant, posted_at, collected_at")
    .not("enriched_at", "is", null)
    .eq("relevant", true)
    .lt("sentiment", 0)
    .or(`posted_at.gte.${since},and(posted_at.is.null,collected_at.gte.${since})`)
    .limit(2000);
  if (error) throw error;
  const { data: prior, error: pErr } = await sb.from("orm_spike_log").select("key, product, topic, mention_ids")
    .gte("created_at", new Date(now - 2 * days * DAY).toISOString()).limit(1000);
  if (pErr) throw pErr; // can't tell what was alerted → send nothing

  const groups = spikeGroups((data ?? []) as SpikeMention[], { now, windowDays: days, threshold }, (prior ?? []) as any[]);
  const todo = groups.slice(0, MAX_SPIKES_PER_TICK);
  const appUrl = siteAppUrl();
  let sent = 0, failed = 0, lost = 0;
  for (const g of todo) {
    const { error: cErr } = await sb.from("orm_spike_log").insert({
      key: g.key, product: g.product, topic: g.topic, count: g.count, mention_ids: g.mention_ids, status: "claimed",
    });
    if (cErr) {
      if (cErr.code === "23505") { lost++; continue; }
      throw cErr;
    }
    const results = await sendToAll(to, (wa) => spikeMarker(g.key, wa), buildSpikeVars(g, days, appUrl));
    const anyOk = results.some((r) => r.ok);
    if (anyOk) sent++;
    else failed++;
    await sb.from("orm_spike_log").update({
      status: anyOk ? "sent" : "failed",
      sent_at: anyOk ? new Date().toISOString() : null,
      error: anyOk ? null : (results.find((r) => r.error)?.error ?? "send failed").slice(0, 500),
    }).eq("key", g.key).eq("status", "claimed");
    console.log("[orm-spike]", g.key, JSON.stringify(maskResults(results)));
  }
  return { groups: groups.length, pending: todo.length, sent, failed, lost_claim: lost };
}
