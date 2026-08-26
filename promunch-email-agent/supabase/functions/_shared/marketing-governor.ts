// Per-customer WhatsApp MARKETING frequency governor.
//
// WHY THIS EXISTS
// ---------------
// Meta error #131049 ("This message was not delivered to maintain healthy
// ecosystem engagement") is NOT a transient failure and NOT an account-health
// problem. Measured on production traffic over 60 days:
//
//   marketing-category templates   6,802 attempts   5,728 failed  (84%)
//   utility-category templates     2,025 attempts      34 failed  (1.7%)
//   free-form inside the 24h window  195 sent          2 failed  (1%)
//
// Utility and in-window free text are fine, so the number is healthy. #131049 is
// Meta's PER-RECIPIENT marketing fatigue cap: a terminal verdict for THAT person
// for a while. We used to treat it as transient and retry into it, which is the
// one thing that makes it permanently worse. In August a single customer took 80
// marketing template attempts, none of which could ever have landed.
//
// This module is the throttle. Every marketing TEMPLATE send path asks it first.
//
// WHAT IT GOVERNS (and what it must never touch)
// ----------------------------------------------
// GOVERNED: marketing-category templates only (abandoned cart, review request,
//   replenishment, campaign broadcasts).
// NEVER GOVERNED: utility templates (order confirmation, shipping update, order
//   verify, ops alerts) and free-form messages inside the open 24h service
//   window. Those sit at 98-99% delivery and are the business's lifeline. In
//   particular, an active suppression row must NEVER block them.
//
// SAFETY DIRECTION
// ----------------
// Two different "fail safe" directions apply here, deliberately:
//   • Template CLASSIFICATION fails CLOSED — unsure whether a template is
//     marketing? Treat it as marketing. Governing something wrongly only ever
//     REDUCES sends, which cannot hurt a customer.
//   • The COUNTING query fails OPEN — if the lookup itself errors we return
//     allowed:true. A governor bug must never become the reason the business
//     cannot send anything at all. (If the query SUCCEEDS and the count is over
//     the limit, we deny — that is the whole point.)

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  isMarketingTemplate as classifyTemplate,
  marketingTemplateNames as classifyMarketingNames,
} from "./template-category.ts";

// ---------------------------------------------------------------------------
// Limits. Deliberately tight: Meta's own per-recipient marketing tolerance is
// roughly "one marketing message per day, a handful per week" and we were
// running 10-80x that. Both are overridable as Supabase function secrets so the
// limits can be loosened/tightened without a redeploy of five functions:
//   WA_MARKETING_PER_24H   (default 1)  max marketing template ATTEMPTS / 24h
//   WA_MARKETING_PER_7D    (default 3)  max marketing template ATTEMPTS / 7d
// ---------------------------------------------------------------------------
export const MARKETING_PER_24H = envInt("WA_MARKETING_PER_24H", 1);
export const MARKETING_PER_7D = envInt("WA_MARKETING_PER_7D", 3);

// Consecutive #131049 verdicts before we stop marketing to this number entirely.
export const CAP_STRIKES_TO_SUPPRESS = envInt("WA_MARKETING_CAP_STRIKES", 3);
// How long that suppression lasts. Long, because a fatigued recipient stays
// fatigued; a single delivered marketing message clears it early (see
// recordMarketingDelivered).
export const SUPPRESSION_DAYS = envInt("WA_MARKETING_SUPPRESS_DAYS", 30);

const DAY_MS = 24 * 60 * 60 * 1000;

// We count ATTEMPTS, not deliveries. Meta's fatigue signal is driven by what we
// TRY to send, so a failed attempt costs us exactly as much as a delivered one.
// 'queued' is included because the campaign sender claims a row before calling
// Meta, and that claim is a real in-flight attempt.
const ATTEMPT_STATUSES = ["queued", "sent", "delivered", "read", "failed"] as const;

// Last-resort classification when wa_templates is unreachable. Every one of
// these is marketing-category at Meta today.
const FALLBACK_MARKETING = new Set([
  "abandoned_cart_recovery",
  "abandoned_cart_reminder",
  "abandoned_checkout",
  "replenishment_reminder",
  "review_request",
  "edamame_launch",
]);

// The transactional lifelines. Hardcoded so that even a total wa_templates
// outage can never cause an order confirmation, a shipping update, a COD
// verify or an ops alert to be throttled as if it were marketing.
const FALLBACK_UTILITY = new Set([
  "order_confirmation",
  "order_confirmation_v2",
  "order_confirmation_repeat_v1",
  "order_verify_v1",
  "order_verify_reminder_v1",
  "shipping_update",
  "order_cancel_ops",
  "ops_ticket_alert",
  "hello_world",
]);

// The per-recipient marketing cap arrives in two different shapes:
//   • synchronous send errors carry Meta's NUMERIC error.code,
//   • the async delivery-status webhook carries a human title string.
//
// #131049 ONLY. Verified against Meta's error-code reference (Aug 2026):
//   131049 "This message was not delivered to maintain healthy ecosystem
//          engagement." → the adaptive per-user marketing limit. RECOVERABLE:
//          Meta's own guidance is "wait at least 24 hours before resending".
//   131050 "This recipient has chosen to stop receiving marketing messages on
//          WhatsApp from your business." → a user-level marketing OPT-OUT, and
//          Meta says "do not retry sending messages to this user as they will
//          not be received". That is permanent, not a cap.
// They must not be conflated: everywhere in this codebase a "cap" verdict means
// "retry this person later", which for a 131050 opt-out would mean messaging
// someone who explicitly opted out, forever. 131050 falls through to the
// permanent-failure path instead, which is the correct home for it.
//   https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
//   https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits
const CAP_CODES = new Set<number>([131049]);

// Text matching is the LAST resort. Meta owns this string: it has been reworded
// before, and it is localised for some accounts, so any code path that has the
// numeric code in hand must pass it. The regex only has to catch the async
// webhook and re-reads of a stored wa_messages.error row, neither of which
// carries a code.
const CAP_RE = /healthy ecosystem|131049/i;

// Prefers the exact numeric code; falls back to the English text only when no
// code is available. `code` accepts a string because some callers read it back
// out of JSON (wa-send's response, ai_meta.code) where numbers may arrive as
// strings.
export function isCapError(code?: number | string | null, text?: string | null): boolean {
  if (code !== null && code !== undefined && code !== "") {
    const n = typeof code === "number" ? code : Number(code);
    // A parseable code is authoritative in BOTH directions: Meta told us exactly
    // what went wrong, so a non-cap code means "not a cap error" even if the
    // accompanying prose happens to mention a number. Only an unparseable /
    // absent code falls through to the text regex.
    if (Number.isFinite(n)) return CAP_CODES.has(n);
  }
  return CAP_RE.test(String(text ?? ""));
}

// #131050 — the recipient has switched OFF marketing messages from us at the
// WhatsApp level. Not a cap and not retryable: Meta's guidance is "do not retry
// sending messages to this user as they will not be received".
//
// Exposed here so every send path classifies it the same way. Today it is
// correctly handled by falling through to each caller's permanent-failure
// branch (the campaign sender's permanentFail set), which is why nothing calls
// this yet. Wire it in wherever a path needs to say "opted out" rather than
// "unknown permanent failure" — and treat it as a real unsubscribe, i.e. the
// same standing as a bare STOP, never as a retry-tomorrow.
export function isMarketingOptOutError(code?: number | string | null, text?: string | null): boolean {
  if (code !== null && code !== undefined && code !== "") {
    const n = typeof code === "number" ? code : Number(code);
    if (Number.isFinite(n)) return n === 131050;
  }
  return /131050|stop receiving marketing messages/i.test(String(text ?? ""));
}

// #131026 "Message undeliverable" — Meta could not hand the message to this
// number AT ALL: not on WhatsApp, never accepted the terms, or the number is
// wrong. This is a property of the NUMBER, not of our marketing standing, and
// no amount of waiting fixes it.
//
// It is deliberately NOT a cap:
//   #131049 = "this person has no marketing slot right now"  -> throttle, retry later
//   #131026 = "this person cannot receive WhatsApp at all"   -> stop, retry never
//
// Conflating them is how a dead number ended up on a 6h retry loop and absorbed
// 13 sends in 24h (wa_id 919925024668, Aug 25-26 2026). wa-campaign-send has
// always classified this correctly via its permanentFail set; journeys did not.
export function isUndeliverableError(code?: number | string | null, text?: string | null): boolean {
  if (code !== null && code !== undefined && code !== "") {
    const n = typeof code === "number" ? code : Number(code);
    if (Number.isFinite(n)) return n === 131026;
  }
  return /131026|message undeliverable/i.test(String(text ?? ""));
}

function envInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// ---------------------------------------------------------------------------
// Template classification
// ---------------------------------------------------------------------------
// The lookup + its cache live in _shared/template-category.ts, which is shared
// with the MM Lite router in _shared/whatsapp.ts. This module supplies the
// GOVERNOR's safety direction to that shared helper and nothing more:
//
//   fallback: true          → unknown template is treated as MARKETING (fail
//                             CLOSED). A wrong "marketing" guess only ever
//                             throttles, which cannot hurt a customer.
//   utilityAllowlist        → the transactional lifelines, checked BEFORE the
//                             fallback, so a total wa_templates outage can never
//                             throttle an order confirmation / shipping update /
//                             COD verify / ops alert.
//   marketingAllowlist      → today's known marketing templates, so an outage
//                             still classifies them correctly rather than by
//                             luck of the fallback.
//
// MM Lite passes the opposite fallback (false = stay on the proven Cloud API
// path). Both are correct for their caller; see template-category.ts.

// Is this template marketing-category (i.e. subject to Meta's per-recipient cap)?
export function isMarketingTemplate(name: string, language?: string): Promise<boolean> {
  return classifyTemplate({
    name,
    language,
    fallback: true,
    utilityAllowlist: FALLBACK_UTILITY,
    marketingAllowlist: FALLBACK_MARKETING,
  });
}

// The set of marketing template names, for bulk callers that classify many rows
// at once (the campaign sender). Always includes the hardcoded list.
export function marketingTemplateNames(): Promise<Set<string>> {
  return classifyMarketingNames(FALLBACK_MARKETING);
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------
export interface MarketingVerdict {
  allowed: boolean;
  reason?: string;
  // How long the caller should wait before asking again. Callers use this to
  // pick a deferral instead of re-querying every tick.
  retryAfterMs?: number;
}

// May we send `templateName` (a marketing template) to `waId` right now?
//
// Denies if ANY of:
//   a) an active suppression row (suppressed_until > now)
//   b) >= MARKETING_PER_24H marketing template attempts in the last rolling 24h
//   c) >= MARKETING_PER_7D marketing template attempts in the last rolling 7d
//
// NOTE the fail-open contract: any error reading the ledger returns allowed:true.
export async function marketingAllowed(
  sb: SupabaseClient,
  waId: string,
  _templateName?: string,
): Promise<MarketingVerdict> {
  const id = (waId ?? "").trim();
  if (!id) return { allowed: true };

  // (a) suppression. A missing table (migration not applied yet) or any other
  // error is treated as "not suppressed" so this module is safe to deploy
  // BEFORE the migration is pasted into the SQL editor.
  try {
    const { data: sup } = await sb
      .from("wa_marketing_suppression")
      .select("suppressed_until, consecutive_caps, reason")
      .eq("wa_id", id)
      .maybeSingle();
    const until = sup?.suppressed_until ? Date.parse(sup.suppressed_until) : NaN;
    if (Number.isFinite(until) && until > Date.now()) {
      return {
        allowed: false,
        reason: `suppressed until ${new Date(until).toISOString()} after ${sup?.consecutive_caps ?? "?"} consecutive #131049 verdicts`,
        retryAfterMs: until - Date.now(),
      };
    }
  } catch { /* fail open */ }

  // (b)+(c) rolling attempt counts. wa_messages has no wa_id column — it keys on
  // thread_id/contact_id — so resolve wa_id -> wa_threads.id first. (There is
  // normally exactly one thread per wa_id; wa_threads upserts on contact_id, so
  // handle the list case rather than assuming.)
  let threadIds: string[] = [];
  try {
    const { data: threads, error } = await sb.from("wa_threads").select("id").eq("wa_id", id);
    if (error) return { allowed: true }; // fail open
    threadIds = (threads ?? []).map((t: { id: string }) => t.id);
  } catch {
    return { allowed: true };
  }
  if (threadIds.length === 0) return { allowed: true }; // never messaged — nothing to throttle

  const since7d = new Date(Date.now() - 7 * DAY_MS).toISOString();
  let rows: { template_name: string | null; created_at: string }[] = [];
  try {
    const { data, error } = await sb
      .from("wa_messages")
      .select("template_name, created_at")
      .in("thread_id", threadIds)
      .eq("direction", "outbound")
      .eq("type", "template")
      .in("status", ATTEMPT_STATUSES as unknown as string[])
      .gte("created_at", since7d)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return { allowed: true }; // fail open — never let a governor bug mute the business
    rows = (data ?? []) as typeof rows;
  } catch {
    return { allowed: true };
  }

  const marketingNames = await marketingTemplateNames();
  // Newest first (the query ordered that way), so index 0 is the most recent.
  const stamps = rows
    .filter((r) => r.template_name && marketingNames.has(r.template_name))
    .map((r) => Date.parse(r.created_at))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a);

  const now = Date.now();
  const in24h = stamps.filter((t) => now - t < DAY_MS);
  if (in24h.length >= MARKETING_PER_24H) {
    return {
      allowed: false,
      reason: `${in24h.length} marketing template attempt(s) in the last 24h (limit ${MARKETING_PER_24H})`,
      retryAfterMs: ageOutMs(in24h, MARKETING_PER_24H, DAY_MS, now),
    };
  }
  if (stamps.length >= MARKETING_PER_7D) {
    return {
      allowed: false,
      reason: `${stamps.length} marketing template attempt(s) in the last 7d (limit ${MARKETING_PER_7D})`,
      retryAfterMs: ageOutMs(stamps, MARKETING_PER_7D, 7 * DAY_MS, now),
    };
  }
  return { allowed: true };
}

// How long until enough of these attempts age out of `windowMs` that the count
// drops back below `limit`. `stampsDesc` is newest-first. A limit of 0 is a
// deliberate "no marketing at all" kill switch (set WA_MARKETING_PER_24H=0) —
// it never ages out, so report the full window.
function ageOutMs(stampsDesc: number[], limit: number, windowMs: number, now: number): number {
  if (limit <= 0 || stampsDesc.length === 0) return windowMs;
  const t = stampsDesc[Math.min(limit, stampsDesc.length) - 1];
  if (!Number.isFinite(t)) return windowMs;
  return Math.max(60_000, t + windowMs - now);
}

// ---------------------------------------------------------------------------
// Bulk variant for the campaign sender
// ---------------------------------------------------------------------------
// Same rules as marketingAllowed(), evaluated for a whole audience in two
// queries instead of two per contact (a 2,700-recipient broadcast was 5,400
// round trips otherwise). Returns the set of CONTACT ids to hold out of the
// batch. Fails open: on any error the set is empty and nobody is held.
export async function marketingHoldSet(
  sb: SupabaseClient,
  contacts: { id: string; wa_id: string }[],
): Promise<Set<string>> {
  const held = new Set<string>();
  if (!contacts.length) return held;

  const byWaId = new Map<string, string[]>();
  for (const c of contacts) {
    if (!c.wa_id) continue;
    const list = byWaId.get(c.wa_id) ?? [];
    list.push(c.id);
    byWaId.set(c.wa_id, list);
  }

  // (a) active suppressions
  try {
    const nowIso = new Date().toISOString();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from("wa_marketing_suppression")
        .select("wa_id")
        .gt("suppressed_until", nowIso)
        .range(from, from + 999);
      if (error) break; // table missing / unreachable → fail open
      if (!data || data.length === 0) break;
      for (const r of data as { wa_id: string }[]) {
        for (const cid of byWaId.get(r.wa_id) ?? []) held.add(cid);
      }
      if (data.length < 1000) break;
    }
  } catch { /* fail open */ }

  // (b)+(c) rolling attempt counts, keyed on contact_id (which wa_messages
  // carries directly, so no thread join is needed for the bulk path).
  try {
    const marketingNames = await marketingTemplateNames();
    const since7d = new Date(Date.now() - 7 * DAY_MS).toISOString();
    const perContact = new Map<string, number[]>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from("wa_messages")
        .select("contact_id, template_name, created_at")
        .eq("direction", "outbound")
        .eq("type", "template")
        .in("status", ATTEMPT_STATUSES as unknown as string[])
        .gte("created_at", since7d)
        .range(from, from + 999);
      if (error) return held; // fail open — keep whatever suppression holds we have
      if (!data || data.length === 0) break;
      for (const r of data as { contact_id: string | null; template_name: string | null; created_at: string }[]) {
        if (!r.contact_id || !r.template_name) continue;
        if (!marketingNames.has(r.template_name)) continue;
        const t = Date.parse(r.created_at);
        if (!Number.isFinite(t)) continue;
        const list = perContact.get(r.contact_id) ?? [];
        list.push(t);
        perContact.set(r.contact_id, list);
      }
      if (data.length < 1000) break;
    }
    const now = Date.now();
    for (const c of contacts) {
      const stamps = perContact.get(c.id);
      if (!stamps) continue;
      const in24h = stamps.filter((t) => now - t < DAY_MS).length;
      if (in24h >= MARKETING_PER_24H || stamps.length >= MARKETING_PER_7D) held.add(c.id);
    }
  } catch { /* fail open */ }

  return held;
}

// ---------------------------------------------------------------------------
// Feedback loop
// ---------------------------------------------------------------------------
// Record a #131049 verdict against this number. Three in a row and we stop
// marketing to them for SUPPRESSION_DAYS. Only cap errors count — a generic
// "undeliverable" (wrong number, not on WhatsApp) is a different problem and is
// handled by the campaign sender's permanentFail set.
export async function recordMarketingCap(
  sb: SupabaseClient,
  waId: string,
  errorCode?: number | string | null,
  errorText?: string | null,
): Promise<void> {
  const id = (waId ?? "").trim();
  if (!id) return;
  if (!isCapError(errorCode, errorText)) return;

  const reason = `#${errorCode ?? 131049} ${String(errorText ?? "healthy ecosystem engagement").slice(0, 200)}`;

  // Preferred path: one atomic statement in Postgres (concurrent status
  // callbacks for the same number cannot lose an increment).
  try {
    const { error } = await sb.rpc("wa_record_marketing_cap", {
      p_wa_id: id,
      p_reason: reason,
      p_strikes: CAP_STRIKES_TO_SUPPRESS,
      p_suppress_days: SUPPRESSION_DAYS,
    });
    if (!error) return;
  } catch { /* fall through */ }

  // Fallback for the window between deploying this function and pasting the
  // migration: read-modify-write. Racy under concurrency, but the failure mode
  // is "we under-count strikes", which only ever sends fewer messages later.
  try {
    const { data: existing } = await sb
      .from("wa_marketing_suppression")
      .select("consecutive_caps")
      .eq("wa_id", id)
      .maybeSingle();
    const caps = Number(existing?.consecutive_caps ?? 0) + 1;
    const nowIso = new Date().toISOString();
    await sb.from("wa_marketing_suppression").upsert({
      wa_id: id,
      consecutive_caps: caps,
      last_cap_at: nowIso,
      suppressed_until: caps >= CAP_STRIKES_TO_SUPPRESS
        ? new Date(Date.now() + SUPPRESSION_DAYS * DAY_MS).toISOString()
        : null,
      reason,
      updated_at: nowIso,
    }, { onConflict: "wa_id" });
  } catch { /* never let bookkeeping break a webhook */ }
}

// A marketing message actually reached this customer, which proves Meta still
// has a slot for us with them. Clear the strike counter and any suppression.
export async function recordMarketingDelivered(sb: SupabaseClient, waId: string): Promise<void> {
  const id = (waId ?? "").trim();
  if (!id) return;
  try {
    await sb.from("wa_marketing_suppression").update({
      consecutive_caps: 0,
      suppressed_until: null,
      reason: "cleared — a marketing message was delivered",
      updated_at: new Date().toISOString(),
    }).eq("wa_id", id);
  } catch { /* bookkeeping only */ }
}

// Meta #131050: the customer has switched OFF marketing messages from us at the
// WhatsApp level. This is an UNSUBSCRIBE, not a cap, and Meta's guidance is not
// to retry. So it gets exactly the standing of a bare STOP (AGENTS.md §4.3):
//
//   1. wa_contacts.opted_in = false — stops campaign broadcasts (the only
//      consumer of that flag before today) and, via the guard added to
//      wa-journey-tick, retires their marketing journey runs too.
//   2. a suppression row far in the future — belt and braces, so the frequency
//      governor also refuses the send even if the contact row is missing (a
//      #131050 can arrive for a number that never made it into wa_contacts).
//
// NOT reversible from our side, deliberately: only the customer can turn our
// marketing back on, by replying START (which sets opted_in = true) or through
// WhatsApp's own controls. We never clear this on their behalf.
//
// Transactional messages are UNAFFECTED. Order confirmations, shipping updates,
// COD verify and ops alerts are utility templates, never consult suppression,
// and do not run through journeys. Someone who mutes our marketing still gets
// told their order shipped.
export async function recordMarketingOptOut(
  sb: SupabaseClient,
  waId: string,
  errorCode?: number | string | null,
  errorText?: string | null,
): Promise<void> {
  const id = (waId ?? "").trim();
  if (!id) return;
  if (!isMarketingOptOutError(errorCode, errorText)) return;

  const reason = `#${errorCode ?? 131050} marketing opt-out: ${
    String(errorText ?? "recipient stopped marketing messages").slice(0, 160)
  }`;

  // Both writes are independent and both are best-effort. Losing either one
  // still leaves the other refusing the send, which is the safe direction.
  try {
    await sb.from("wa_contacts").update({ opted_in: false }).eq("wa_id", id);
  } catch { /* the suppression row below still holds the line */ }

  try {
    const far = new Date(Date.now() + 100 * 365 * 24 * 3600_000).toISOString();
    await sb.from("wa_marketing_suppression").upsert({
      wa_id: id,
      consecutive_caps: CAP_STRIKES_TO_SUPPRESS,
      last_cap_at: new Date().toISOString(),
      suppressed_until: far,
      reason,
      updated_at: new Date().toISOString(),
    }, { onConflict: "wa_id" });
  } catch { /* opted_in = false above still stops campaigns */ }
}
