// deno-lint-ignore-file no-explicit-any -- DB rows are untyped
// ORM (Reputation) WhatsApp alerts to the INTERNAL team. Contract:
// docs/plans/2026-10-08-orm-build-spec.md §4.
//
// Recipients are team numbers only (orm_settings.alert_wa_ids, else the
// SUPPORT_ALERT_WA_IDS support alert list). Never a customer.
//
// §0 never twice, per mention:
//   1. insert-first claim on orm_alert_log (mention_id, kind). 23505 = another
//      run already owns it → do nothing. The first matching kind (critical →
//      low_rating → negative) is the one that sends; the other matching kinds
//      are logged 'skipped', so a mention sends at most one alert batch ever.
//   2. per recipient, ledger check: wa_messages.sent_by =
//      `orm_alert:<mention_id>:<wa_id>` already sent/delivered/read → no send.
//   3. one wa-send call per recipient, no inline retry. The claim is terminal
//      (sent/failed); a missed alert is recoverable, a duplicate is not.

import { db } from "./supabase.ts";
import { errStr } from "./connector-log.ts";
import { callWaSend } from "./influencer-send.ts";
import { cleanParam, siteAppUrl } from "./influencers.ts";
import { supportAlertWaIds } from "./support-alert.ts";

export type AlertKind = "critical" | "low_rating" | "negative";
export const ALERT_ORDER: AlertKind[] = ["critical", "low_rating", "negative"];
export const ALERT_WINDOW_MS = 7 * 86_400_000;
export const NEGATIVE_MIN_FOLLOWERS = 5000;
export const MAX_ALERTS_PER_TICK = 10;

export const SOURCE_LABELS: Record<string, string> = {
  judgeme: "Website review",
  youtube: "YouTube",
  reddit: "Reddit",
  rss: "News and web",
  amazon: "Amazon review",
  instagram: "Instagram",
};

export interface AlertMention {
  id: string;
  source: string;
  relevant: boolean | null;
  urgency: string | null;
  rating: number | string | null;
  sentiment: number | null;
  is_owned: boolean;
  author_followers: number | null;
  author_name: string | null;
  author_handle: string | null;
  summary: string | null;
  title: string | null;
  body: string;
  posted_at: string | null;
  collected_at: string | null;
}

/** Which rules a mention matches, in priority order (pure). */
export function alertKinds(m: AlertMention, now: number): AlertKind[] {
  if (m.relevant !== true) return [];
  const at = Date.parse(m.posted_at ?? m.collected_at ?? "");
  if (!Number.isFinite(at) || now - at > ALERT_WINDOW_MS) return [];
  const kinds: AlertKind[] = [];
  if (m.urgency === "critical") kinds.push("critical");
  const rating = m.rating == null ? null : Number(m.rating);
  if (rating != null && Number.isFinite(rating) && rating <= 2) kinds.push("low_rating");
  if (m.sentiment === -2 && !m.is_owned && (m.author_followers ?? 0) >= NEGATIVE_MIN_FOLLOWERS) {
    kinds.push("negative");
  }
  return kinds;
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** settings.alert_wa_ids if non-empty, else the SUPPORT_ALERT_WA_IDS list. */
export function alertRecipients(settingsIds: string[] | null | undefined, fallback: string[]): string[] {
  const own = [...new Set((settingsIds ?? []).map(digits).filter((d) => d.length >= 10))];
  return own.length ? own : [...new Set(fallback.map(digits).filter((d) => d.length >= 10))];
}

export const alertMarker = (mentionId: string, waId: string) => `orm_alert:${mentionId}:${waId}`;

function ratingLine(m: AlertMention, kind: AlertKind): string {
  const parts: string[] = [];
  const rating = m.rating == null ? null : Number(m.rating);
  if (rating != null && Number.isFinite(rating)) parts.push(`${rating} of 5 stars`);
  if (m.sentiment != null) {
    parts.push(["very negative", "negative", "neutral", "positive", "very positive"][m.sentiment + 2] ?? "");
  }
  if (kind === "critical") parts.unshift("CRITICAL");
  return parts.filter(Boolean).join(", ") || "-";
}

/** ops_ticket_alert {{1}}..{{5}} (pure). No em dashes, ≤300 chars on {{5}}. */
export function buildAlertVars(m: AlertMention, kind: AlertKind, appUrl: string): Record<string, string> {
  const link = `${appUrl.replace(/\/+$/, "")}/dashboard/reputation?m=${m.id}`;
  const author = [m.author_name, m.author_followers ? `${m.author_followers.toLocaleString("en-IN")} followers` : null]
    .filter(Boolean).join(", ");
  const text = m.summary || m.title || m.body || "";
  const room = Math.max(20, 300 - link.length - 1);
  return {
    "1": "Reputation alert",
    "2": cleanParam(SOURCE_LABELS[m.source] ?? m.source, 60),
    "3": cleanParam(ratingLine(m, kind), 80),
    "4": cleanParam(author || m.author_handle || "unknown", 80),
    "5": `${cleanParam(text, room)} ${link}`.slice(0, 300),
  };
}

const OK_LEDGER = ["sent", "delivered", "read"];
const ALERT_COLS =
  "id, source, relevant, urgency, rating, sentiment, is_owned, author_followers, author_name, author_handle, summary, title, body, posted_at, collected_at";

/**
 * ALERT step. Candidates: enriched, relevant, posted in the last 7 days, and
 * matching at least one rule; minus those already in orm_alert_log.
 */
export async function runAlerts(
  settings: { alerts_enabled: boolean; alert_wa_ids: string[] | null },
  now: number,
): Promise<Record<string, unknown>> {
  if (!settings.alerts_enabled) return { skipped: "alerts_disabled" };
  const to = alertRecipients(settings.alert_wa_ids, supportAlertWaIds());
  if (!to.length) return { skipped: "no_recipients" };

  const sb = db();
  const since = new Date(now - ALERT_WINDOW_MS).toISOString();
  const { data, error } = await sb.from("orm_mentions").select(ALERT_COLS)
    .not("enriched_at", "is", null)
    .eq("relevant", true)
    // posted in the window (no post date → collected in the window)
    .or(`posted_at.gte.${since},and(posted_at.is.null,collected_at.gte.${since})`)
    .or("urgency.eq.critical,rating.lte.2,sentiment.eq.-2")
    .order("posted_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  const cands = ((data ?? []) as AlertMention[]).filter((m) => alertKinds(m, now).length > 0);
  if (!cands.length) return { candidates: 0, alerted: 0 };

  const { data: logged, error: lErr } = await sb.from("orm_alert_log").select("mention_id")
    .in("mention_id", cands.map((m) => m.id));
  if (lErr) throw lErr; // can't tell what was handled → send nothing
  const handled = new Set((logged ?? []).map((r: any) => r.mention_id));
  const todo = cands.filter((m) => !handled.has(m.id)).slice(0, MAX_ALERTS_PER_TICK);

  const appUrl = siteAppUrl();
  let alerted = 0, failed = 0, lost = 0;
  for (const m of todo) {
    const [kind, ...rest] = alertKinds(m, now);
    // 1. claim (insert-first)
    const { error: cErr } = await sb.from("orm_alert_log")
      .insert({ mention_id: m.id, kind, status: "claimed", detail: { recipients: to.length } });
    if (cErr) {
      if (cErr.code === "23505") { lost++; continue; }
      throw cErr;
    }
    for (const k of rest) {
      await sb.from("orm_alert_log").insert({ mention_id: m.id, kind: k, status: "skipped", detail: { reason: `covered by ${kind}` } });
    }

    const vars = buildAlertVars(m, kind, appUrl);
    const results: Array<{ to: string; ok: boolean; message_id?: string | null; error?: string | null; ledger?: boolean }> = [];
    for (const wa of to) {
      const marker = alertMarker(m.id, wa);
      // 2. ledger check
      const { data: prior, error: pErr } = await sb.from("wa_messages").select("wa_message_id, status")
        .eq("sent_by", marker).in("status", OK_LEDGER).limit(1);
      if (pErr) { results.push({ to: wa, ok: false, error: `ledger: ${errStr(pErr)}` }); continue; } // in doubt: no send
      if (prior?.length) { results.push({ to: wa, ok: true, message_id: prior[0].wa_message_id ?? null, ledger: true }); continue; }
      // 3. one send
      const res = await callWaSend({
        to: wa,
        kind: "template",
        sent_by: marker,
        template: { name: Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert", language: "en", vars },
      });
      results.push({ to: wa, ok: res.ok, message_id: res.message_id ?? null, error: res.error ?? null });
    }
    const anyOk = results.some((r) => r.ok);
    if (anyOk) alerted++;
    else failed++;
    await sb.from("orm_alert_log").update({
      status: anyOk ? "sent" : "failed",
      sent_at: anyOk ? new Date().toISOString() : null,
      error: anyOk ? null : (results.find((r) => r.error)?.error ?? "send failed").slice(0, 500),
      detail: { recipients: to.length, results: results.map((r) => ({ ...r, to: `…${r.to.slice(-4)}` })) },
    }).eq("mention_id", m.id).eq("kind", kind).eq("status", "claimed");
  }
  return { candidates: cands.length, pending: todo.length, alerted, failed, lost_claim: lost };
}
