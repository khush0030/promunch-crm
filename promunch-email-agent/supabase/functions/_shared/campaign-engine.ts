// Pure decision logic for the WhatsApp campaign engine (wa-campaign-send).
//
// Everything here is side-effect free (no DB, no network, no Deno.env) so it
// can be unit-tested with `deno test` and mirrored in the Next app
// (src/lib/wa-campaign-engine.ts). The engine owns I/O; this module owns the
// verdicts:
//
//   classifySendError      what a Meta failure MEANS (retry? never? halt?)
//   contactVerdict         where one recipient stands in THIS campaign
//   shouldTripBreaker      when a batch proves the template itself is broken
//   pacing helpers         IST day, quiet hours, next allowed wave slot
//   buildTemplateComponents / validateCampaignSetup
//                          template-schema-driven component builder
//   followupGate / followupFinish / followupFilterError
//                          campaign journeys: when a follow-up may run, and
//                          when it may complete (never early) or must wait
//
// SAFETY DIRECTION (promunch-email-agent/CLAUDE.md §0): every uncertain branch
// resolves toward NOT sending. An unknown error is terminal, an ambiguous claim
// is never re-sent, a missing template parameter blocks the start instead of
// spraying one failure per recipient.

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type WaErrorClass =
  | "cap" //         #131049 per-recipient marketing fatigue: retry on a later day
  | "optout" //      #131050 recipient switched our marketing off: never retry
  | "terminal" //    number can't receive this (131026, 130472, ...): never retry
  | "structural" //  OUR fault (template/params/token/account): halt, retry after a fix
  | "transient" //   Meta/network blip: retry next wave, max attempts
  | "ambiguous" //   claim orphaned mid-send, delivery unknown: never re-send (silence > duplicate)
  | "unknown"; //    anything else: treated as terminal (no retry)

export const RETRYABLE_CLASSES: ReadonlySet<WaErrorClass> = new Set(["cap", "transient", "structural"]);

const TRANSIENT_CODES = new Set([131000, 131016, 130429, 131056, 80007, 131048, 2, 4]);
const TERMINAL_CODES = new Set([131026, 130472, 131021, 131047]);
const STRUCTURAL_CODES = new Set([
  1, 3, 10, 100, 190, 368,
  131005, 131008, 131009, 131031, 131042, 131051, 131052, 131053,
]);

export function classifySendError(
  code?: number | string | null,
  text?: string | null,
): WaErrorClass {
  const t = String(text ?? "");
  // A stale claim carries no Meta code; its text is authoritative.
  if (/ambiguous|stale claim/i.test(t)) return "ambiguous";
  if (code !== null && code !== undefined && code !== "") {
    const n = typeof code === "number" ? code : Number(code);
    if (Number.isFinite(n)) {
      if (n === 131049) return "cap";
      if (n === 131050) return "optout";
      if (TERMINAL_CODES.has(n)) return "terminal";
      if (TRANSIENT_CODES.has(n)) return "transient";
      if (STRUCTURAL_CODES.has(n)) return "structural";
      if (n >= 132000 && n <= 132999) return "structural"; // template / parameter errors
      if (n >= 133000 && n <= 133999) return "structural"; // phone registration
      if (n >= 200 && n <= 299) return "structural"; // permission errors
      return "unknown";
    }
  }
  // Text fallback (async webhook titles, legacy stored rows without a code).
  if (/healthy ecosystem|131049/i.test(t)) return "cap";
  if (/131050|stop receiving marketing messages/i.test(t)) return "optout";
  if (/131026|message undeliverable|130472|experiment/i.test(t)) return "terminal";
  if (/template|parameter|param(eter)? (format|count)|132\d{3}|access token|oauth|permission/i.test(t)) {
    return "structural";
  }
  if (
    /rate limit|too many|temporar|timeout|timed out|network|fetch failed|ECONN|HTTP 5\d\d|service unavailable|131000|131016|130429|131056|80007/i
      .test(t)
  ) return "transient";
  return "unknown";
}

// Classify a SYNCHRONOUS send result from the Graph API. A failure that carries
// a Meta error code is an explicit refusal (nothing was sent), so its class is
// trustworthy. A failure WITHOUT a code (thrown fetch, timeout, 5xx gateway
// page) may have been accepted by Meta before the connection broke, so it is
// AMBIGUOUS and never retried: silence beats a possible duplicate (§0).
//
// HTTP status matters too: Graph answers a server-side fault with a 5xx that
// still carries an error code (1 "unknown error", 2 "service temporarily
// unavailable", 131000 "something went wrong"). A 5xx means Meta could not say
// whether it acted, so it is ambiguous whatever the code. Codes 2 and 131000
// are ambiguous even without a status: they are "we broke", not "we refuse".
// 4xx + code (token 401, bad params 400, rate limit 429...) is an explicit
// refusal and keeps its class.
const SERVER_FAULT_CODES = new Set([2, 131000]);
export function classifySyncFailure(
  code?: number | string | null,
  text?: string | null,
  httpStatus?: number | null,
): WaErrorClass {
  const hasCode = code !== null && code !== undefined && code !== "" && Number.isFinite(Number(code));
  if (!hasCode) return "ambiguous";
  if (typeof httpStatus === "number" && httpStatus >= 500) return "ambiguous";
  if (SERVER_FAULT_CODES.has(Number(code))) return "ambiguous";
  return classifySendError(code, text);
}

// ---------------------------------------------------------------------------
// Per-contact verdict inside one campaign
// ---------------------------------------------------------------------------

export const MAX_TRANSIENT_ATTEMPTS = 3;
export const MAX_STRUCTURAL_ATTEMPTS = 3;
export const MAX_CAP_ATTEMPTS = 3;

export type SkipReason =
  | "optout"
  | "terminal"
  | "unknown_error"
  | "ambiguous"
  | "transient_exhausted"
  | "structural_exhausted"
  | "cap_exhausted";

export interface LedgerRow {
  status: string;
  error?: string | null;
  error_class?: string | null;
  code?: number | string | null;
  created_at: string;
}

export type ContactVerdict =
  | { kind: "reached" } //   has a sent/delivered/read row: NEVER message again
  | { kind: "in_flight" } // live queued claim (another sender mid-send)
  | { kind: "done"; reason: SkipReason } // permanently skipped for this campaign
  | { kind: "retry"; waitNextDay: boolean; attempts: number }
  | { kind: "fresh" };

export function rowClass(r: LedgerRow): WaErrorClass {
  const c = (r.error_class ?? "") as WaErrorClass;
  if (c && ["cap", "optout", "terminal", "structural", "transient", "ambiguous", "unknown"].includes(c)) return c;
  // Legacy row (written before error_class existed) with no Meta code: a
  // network-shaped error text is a send whose outcome was never known, so it is
  // ambiguous, never a retryable transient.
  const noCode = r.code === null || r.code === undefined || r.code === "";
  if (noCode && /fetch failed|network|ECONN|timeout|timed out|HTTP 5\d\d|service unavailable/i.test(String(r.error ?? ""))) {
    return "ambiguous";
  }
  return classifySendError(r.code ?? null, r.error ?? null);
}

export function contactVerdict(rows: LedgerRow[], todayStartMs: number): ContactVerdict {
  if (rows.some((r) => r.status === "sent" || r.status === "delivered" || r.status === "read")) {
    return { kind: "reached" };
  }
  if (rows.some((r) => r.status === "queued")) return { kind: "in_flight" };
  const failed = rows.filter((r) => r.status === "failed");
  if (failed.length === 0) return { kind: "fresh" };

  const classes = failed.map(rowClass);
  if (classes.includes("optout")) return { kind: "done", reason: "optout" };
  if (classes.includes("terminal")) return { kind: "done", reason: "terminal" };
  if (classes.includes("ambiguous")) return { kind: "done", reason: "ambiguous" };
  if (classes.includes("unknown")) return { kind: "done", reason: "unknown_error" };

  const n = (k: WaErrorClass) => classes.filter((c) => c === k).length;
  if (n("transient") >= MAX_TRANSIENT_ATTEMPTS) return { kind: "done", reason: "transient_exhausted" };
  if (n("structural") >= MAX_STRUCTURAL_ATTEMPTS) return { kind: "done", reason: "structural_exhausted" };
  if (n("cap") >= MAX_CAP_ATTEMPTS) return { kind: "done", reason: "cap_exhausted" };

  // Cap + transient retries wait for the next daily wave. Structural failures
  // are OUR fault (nothing reached the customer) and the breaker halts the
  // campaign, so after the operator fixes it they retry immediately.
  const waitNextDay = failed.some((r, i) =>
    Date.parse(r.created_at) >= todayStartMs && classes[i] !== "structural"
  );
  return { kind: "retry", waitNextDay, attempts: failed.length };
}

// ---------------------------------------------------------------------------
// Wholesale-failure circuit breaker
// ---------------------------------------------------------------------------
// Trip ONLY when the batch delivered nothing AND the failures are structural
// (template / params / token / account) — i.e. every further send would fail
// the same way. The marketing cap, dead numbers and transient blips never trip
// it (they were the false-positive halts).
export const BREAKER_MIN_STRUCTURAL = 5;
export function shouldTripBreaker(b: { sent: number; structural: number; attempted: number }): boolean {
  if (b.sent > 0 || b.structural <= 0) return false;
  return b.structural >= BREAKER_MIN_STRUCTURAL || b.structural === b.attempted;
}

// ---------------------------------------------------------------------------
// Pacing (all in IST, UTC+5:30, no DST)
// ---------------------------------------------------------------------------
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const QUIET_START_MIN = 21 * 60; // 21:00 IST: no marketing after this
export const QUIET_END_MIN = 9 * 60; //    09:00 IST: nothing before this
export const DEFAULT_WAVE_MIN = 10 * 60; // 10:00 IST when no time-of-day is known
// A daily wave must leave room to send before quiet hours start: a campaign
// scheduled at 20:55 would otherwise resume every day at 20:55 and get five
// minutes of sending per day. Later than this, later waves start at 10:00.
export const LATEST_WAVE_MIN = 19 * 60;
export const BUDGET_MARGIN_MS = 5 * 60_000;
export const HOLD_RECHECK_MS = 60 * 60_000; // held contacts re-checked hourly
export const MAX_CAMPAIGN_LIFETIME_MS = 7 * DAY_MS;

export function istDayStartMs(ms: number): number {
  const ist = ms + IST_OFFSET_MS;
  return Math.floor(ist / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}
export function istDay(ms: number): string {
  return new Date(istDayStartMs(ms) + IST_OFFSET_MS).toISOString().slice(0, 10);
}
export function istMinuteOfDay(ms: number): number {
  return Math.floor(((ms + IST_OFFSET_MS) % DAY_MS) / 60_000);
}
export function inQuietHours(ms: number): boolean {
  const m = istMinuteOfDay(ms);
  return m >= QUIET_START_MIN || m < QUIET_END_MIN;
}

// The campaign's own time-of-day (from its schedule, else its first start),
// used for every later daily wave. Falls back to 10:00 when unknown or when
// the chosen time is inside quiet hours.
export function waveMinute(scheduledAt?: string | null, startedAt?: string | null): number {
  const src = scheduledAt ?? startedAt ?? null;
  const ms = src ? Date.parse(src) : NaN;
  if (!Number.isFinite(ms)) return DEFAULT_WAVE_MIN;
  const m = istMinuteOfDay(ms);
  return m >= QUIET_END_MIN && m <= LATEST_WAVE_MIN ? m : DEFAULT_WAVE_MIN;
}

// Consecutive ambiguous sends in one batch that stop it: an outage (network,
// Meta 5xx) would otherwise mark a whole batch "never re-send". Stopping early
// bounds how many contacts one outage can strand.
export const AMBIGUOUS_STOP_STREAK = 3;

// Earliest instant >= earliestMs that is outside quiet hours. Inside quiet
// hours it jumps to the (next) morning's wave time.
export function nextAllowedAt(earliestMs: number, waveMin = DEFAULT_WAVE_MIN): number {
  if (!inQuietHours(earliestMs)) return earliestMs;
  const dayStart = istDayStartMs(earliestMs);
  const m = istMinuteOfDay(earliestMs);
  const base = m < QUIET_END_MIN ? dayStart : dayStart + DAY_MS;
  return base + waveMin * 60_000;
}

// Next daily wave: tomorrow (IST) at the campaign's time-of-day.
export function nextWaveAt(nowMs: number, waveMin = DEFAULT_WAVE_MIN): number {
  return istDayStartMs(nowMs) + DAY_MS + waveMin * 60_000;
}

// Rolling-24h budget exhausted: resume once the OLDEST counted send ages out
// of the window (plus a margin), and never inside quiet hours. Unknown oldest
// send → fall back to the next daily wave.
export function budgetResumeAt(nowMs: number, oldestCountedMs: number | null, waveMin = DEFAULT_WAVE_MIN): number {
  if (oldestCountedMs == null || !Number.isFinite(oldestCountedMs)) return nextWaveAt(nowMs, waveMin);
  const frees = Math.max(nowMs + 60_000, oldestCountedMs + DAY_MS + BUDGET_MARGIN_MS);
  return nextAllowedAt(frees, waveMin);
}

// ---------------------------------------------------------------------------
// Follow-ups (campaign journeys)
// ---------------------------------------------------------------------------
// A follow-up is a wa_campaigns row with followup_of = parent id. Its audience
// is always { retarget: { campaign_id: parent, stage, min_hours_since } }; the
// SQL makes each contact eligible `min_hours_since` hours after the parent
// first reached them. These verdicts decide when the engine may STOP looking
// (never early: someone still waiting for their time must get their chance)
// and when it should look again.

export const FOLLOWUP_STAGES = [
  "delivered", "read", "not_read", "read_no_reply", "replied",
  "clicked", "not_clicked", "ordered", "not_ordered",
] as const;
export type FollowupStage = (typeof FOLLOWUP_STAGES)[number];
export const FOLLOWUP_MIN_HOURS = 1;
export const FOLLOWUP_MAX_HOURS = 720;
// Hard stop: 30 days after the parent started PLUS the follow-up's own delay.
// (Without the delay a 30-day follow-up could never fire, and a 14-day one
// would silently miss everyone the parent reached after day 16.)
export const FOLLOWUP_LIFETIME_MS = 30 * DAY_MS;
export function followupLifetimeEndMs(startedMs: number, delayHours = 0): number {
  const h = Number.isFinite(delayHours) && delayHours > 0 ? delayHours : 0;
  return startedMs + FOLLOWUP_LIFETIME_MS + h * 3600_000;
}
export const FOLLOWUP_PARENT_RECHECK_MS = 60 * 60_000; // parent still sending: look again hourly
export const FOLLOWUP_MIN_DEFER_MS = 60_000; //        never hot-loop
export const PARENT_TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled", "failed"]);

export interface FollowupParent {
  status: string;
  started_at: string | null;
}
export interface FollowupTiming {
  next_due_at?: string | null; // earliest future "anchor + hours" over all parent contacts
  last_due_at?: string | null; //  latest "anchor + hours" over all parent contacts
}

// Before a batch: may this follow-up run at all?
//   cancel             parent was cancelled: the whole journey stops
//   wait_parent_start  parent not launched yet: do nothing (stay armed)
//   expired            30 days + the delay since the parent started: finish now
//   open               run the normal batch
export type FollowupGate = "cancel" | "wait_parent_start" | "expired" | "open";

export function followupGate(parent: FollowupParent | null, nowMs: number, delayHours = 0): FollowupGate {
  // Parent row gone (deleted): its messages lost campaign_id, the retarget
  // matches nobody, so the normal flow completes it. Nothing to wait for.
  if (!parent) return "open";
  if (parent.status === "cancelled") return "cancel";
  const started = parent.started_at ? Date.parse(parent.started_at) : NaN;
  if (!Number.isFinite(started)) return "wait_parent_start";
  if (nowMs >= followupLifetimeEndMs(started, delayHours)) return "expired";
  return "open";
}

// When the batch found nobody left to send to right now: complete, or park
// until the next person's time (or re-check while the parent still runs).
export type FollowupFinish =
  | { kind: "complete" }
  | { kind: "expired" }
  | { kind: "cancel" }
  | { kind: "defer"; resumeAtMs: number; reason: "parent_running" | "waiting_for_time" };

export function followupFinish(
  parent: FollowupParent | null,
  timing: FollowupTiming | null,
  nowMs: number,
  waveMin = DEFAULT_WAVE_MIN,
  delayHours = 0,
): FollowupFinish {
  const gate = followupGate(parent, nowMs, delayHours);
  if (gate === "cancel") return { kind: "cancel" };
  if (gate === "expired") return { kind: "expired" };
  if (!parent) return { kind: "complete" };
  const startedMs = Date.parse(parent.started_at ?? "");
  const parentRunning = gate === "wait_parent_start" || !PARENT_TERMINAL_STATUSES.has(parent.status);
  const next = timing?.next_due_at ? Date.parse(timing.next_due_at) : NaN;
  const last = timing?.last_due_at ? Date.parse(timing.last_due_at) : NaN;
  const timePending = Number.isFinite(last) && last > nowMs;
  if (!parentRunning && !timePending) return { kind: "complete" };

  let at = Number.POSITIVE_INFINITY;
  if (Number.isFinite(next) && next > nowMs) at = next;
  if (parentRunning) at = Math.min(at, nowMs + FOLLOWUP_PARENT_RECHECK_MS);
  if (!Number.isFinite(at)) at = nowMs + FOLLOWUP_PARENT_RECHECK_MS; // pending but no next: look again
  at = Math.max(at, nowMs + FOLLOWUP_MIN_DEFER_MS);
  if (Number.isFinite(startedMs)) at = Math.min(at, followupLifetimeEndMs(startedMs, delayHours));
  at = nextAllowedAt(at, waveMin);
  return { kind: "defer", resumeAtMs: at, reason: parentRunning ? "parent_running" : "waiting_for_time" };
}

// True when any of `cols` differs between the row read before the send lock
// and the row returned by the lock update (jsonb values come back from
// PostgREST in one canonical serialization, so JSON equality is exact).
export function contentChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  cols: readonly string[],
): boolean {
  return cols.some((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

// The engine trusts audience_filter, but a follow-up whose filter does not
// point at its own parent with its own timing is refused (fail closed: a
// hand-edited row must not broadcast to a different audience).
export function followupFilterError(c: {
  followup_of?: string | null;
  followup_after_hours?: number | null;
  followup_stage?: string | null;
  audience_filter?: unknown;
}): string | null {
  if (!c.followup_of) return null;
  const f = (c.audience_filter ?? {}) as Record<string, unknown>;
  const rt = (f.retarget ?? null) as Record<string, unknown> | null;
  const extra = Object.keys(f).filter((k) => k !== "retarget");
  if (
    !rt || extra.length ||
    String(rt.campaign_id ?? "").toLowerCase() !== String(c.followup_of).toLowerCase() ||
    rt.stage !== c.followup_stage ||
    Number(rt.min_hours_since) !== Number(c.followup_after_hours) ||
    !(FOLLOWUP_STAGES as readonly string[]).includes(String(c.followup_stage)) ||
    !Number.isInteger(c.followup_after_hours) ||
    (c.followup_after_hours as number) < FOLLOWUP_MIN_HOURS ||
    (c.followup_after_hours as number) > FOLLOWUP_MAX_HOURS
  ) {
    return "This follow-up's audience does not match its parent and timing. Edit the follow-up to fix it.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Template-schema-driven component builder
// ---------------------------------------------------------------------------

export interface TemplateSchema {
  name?: string;
  header_type?: string | null;
  header_text?: string | null;
  header_media_url?: string | null;
  body?: string | null;
  buttons?: unknown;
}

export type Component = {
  type: "header" | "body" | "button";
  sub_type?: "url" | "quick_reply";
  index?: string;
  parameters: Array<Record<string, unknown>>;
};

export interface BuildOpts {
  vars: Record<string, unknown>;
  contactName?: string | null;
  headerMediaOverride?: string | null;
  // button index -> tracked short-link code (already minted)
  trackedCodes?: Record<number, string>;
  // tag a full URL with UTM (injected so this module stays pure)
  tagUrl?: (url: string) => string;
  // AI mode: body vars are filled per recipient, so skip the body check at
  // campaign-start validation time
  skipBodyCheck?: boolean;
  // campaign-start validation: tracked-link codes are minted later
  validationOnly?: boolean;
}

export function templateVarKeys(text: string | null | undefined): string[] {
  const m = String(text ?? "").match(/\{\{\s*(\d+)\s*\}\}/g) ?? [];
  return Array.from(new Set(m.map((s) => s.replace(/[^\d]/g, "")))).sort((a, b) => Number(a) - Number(b));
}

export interface DynamicUrlButton {
  index: number;
  base: string; // URL text before {{1}}
  example: string | null;
}

export function dynamicUrlButtons(tpl: TemplateSchema): DynamicUrlButton[] {
  const buttons = Array.isArray(tpl.buttons) ? (tpl.buttons as Record<string, unknown>[]) : [];
  const out: DynamicUrlButton[] = [];
  buttons.forEach((b, i) => {
    const type = String(b?.type ?? "").toUpperCase();
    const url = typeof b?.url === "string" ? b.url : "";
    if (type !== "URL" || !/\{\{\s*1\s*\}\}/.test(url)) return;
    const base = url.split(/\{\{\s*1\s*\}\}/)[0];
    const ex = Array.isArray(b?.example) ? b.example[0] : b?.example;
    out.push({ index: i, base, example: typeof ex === "string" && ex ? ex : null });
  });
  return out;
}

// Is this dynamic URL button pointed at OUR short-link redirect (…/r/{{1}})?
// Only then can a per-recipient tracked code be the suffix.
export function isShortLinkBase(base: string): boolean {
  return /\/r\/$/.test(base);
}

export type MediaKind = "IMAGE" | "VIDEO" | "DOCUMENT";
export function mediaKindFromUrl(url: string | null | undefined): MediaKind | null {
  const path = String(url ?? "").split(/[?#]/)[0].toLowerCase();
  if (/\.(jpe?g|png|webp)$/.test(path)) return "IMAGE";
  if (/\.(mp4|3gpp?)$/.test(path)) return "VIDEO";
  if (/\.pdf$/.test(path)) return "DOCUMENT";
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export function buildTemplateComponents(
  tpl: TemplateSchema,
  opts: BuildOpts,
): { components: Component[]; errors: string[] } {
  const components: Component[] = [];
  const errors: string[] = [];
  const vars = opts.vars ?? {};
  const name = (opts.contactName ?? "").trim() || "there";

  // ---- header ----
  const ht = String(tpl.header_type ?? (tpl.header_text ? "TEXT" : "")).toUpperCase();
  const override = (opts.headerMediaOverride ?? "").trim() || null;
  if (ht === "IMAGE" || ht === "VIDEO" || ht === "DOCUMENT") {
    const link = override ?? (tpl.header_media_url ?? null);
    if (!link) {
      errors.push(`template has a ${ht.toLowerCase()} header but no media URL is set`);
    } else {
      const kind = mediaKindFromUrl(link);
      if (override && kind && kind !== ht) {
        errors.push(`header media is a ${kind.toLowerCase()} but the template needs a ${ht.toLowerCase()}`);
      } else {
        const key = ht.toLowerCase();
        components.push({ type: "header", parameters: [{ type: key, [key]: { link } }] });
      }
    }
  } else {
    if (override) errors.push("this template has no media header, so a header image/video can't be set");
    if (ht === "TEXT") {
      const hk = templateVarKeys(tpl.header_text);
      if (hk.length) {
        const v = str(vars._header_1).trim();
        if (!v) errors.push("header text variable {{1}} needs a value (_header_1)");
        else components.push({ type: "header", parameters: [{ type: "text", text: v.replace(/\{name\}/gi, name) }] });
      }
    }
  }

  // ---- body: exactly the template's placeholders, in order ----
  const keys = templateVarKeys(tpl.body);
  if (keys.length) {
    const missing = keys.filter((k) => !str(vars[k]).trim());
    if (missing.length && !opts.skipBodyCheck) {
      errors.push(`body variable(s) ${missing.map((k) => `{{${k}}}`).join(", ")} need a value`);
    }
    if (!missing.length) {
      components.push({
        type: "body",
        parameters: keys.map((k) => ({ type: "text", text: str(vars[k]).replace(/\{name\}/gi, name) })),
      });
    }
  }

  // ---- dynamic URL buttons ----
  for (const b of dynamicUrlButtons(tpl)) {
    let suffix: string | null = null;
    const tracked = opts.trackedCodes?.[b.index];
    const given = str(vars[`_button_${b.index}`]).trim();
    const wantsTracking = isShortLinkBase(b.base) && !!str(vars._track_url).trim();
    if (tracked) {
      suffix = tracked;
    } else if (wantsTracking && !given) {
      // A short-link (/r/{{1}}) button's suffix is a per-recipient code minted
      // at send time. At validation time that is fine; at send time a missing
      // code means minting failed, which must not ship a dead link.
      if (opts.validationOnly) suffix = "pending";
    } else if (isShortLinkBase(b.base) && !given) {
      // The template's sample code is not a real link; never fall back to it.
      suffix = null;
    } else {
      if (given) suffix = given.startsWith(b.base) ? given.slice(b.base.length) : given;
      else if (b.example && b.example.startsWith(b.base)) suffix = b.example.slice(b.base.length);
      if (suffix && opts.tagUrl) {
        const tagged = opts.tagUrl(b.base + suffix);
        if (tagged.startsWith(b.base)) suffix = tagged.slice(b.base.length);
      }
    }
    if (!suffix) {
      errors.push(
        isShortLinkBase(b.base)
          ? `button ${b.index + 1} is a tracked link — set its destination (_track_url)`
          : `button ${b.index + 1} has a dynamic link — set its value (_button_${b.index})`,
      );
      continue;
    }
    components.push({
      type: "button",
      sub_type: "url",
      index: String(b.index),
      parameters: [{ type: "text", text: suffix }],
    });
  }

  return { components, errors };
}

// Pre-send validation for the whole campaign: the same builder run against the
// campaign-level values. A non-empty result blocks the START (clear last_error)
// instead of letting every recipient fail with the same Meta error.
export function validateCampaignSetup(
  tpl: TemplateSchema,
  vars: Record<string, unknown>,
  headerMediaOverride: string | null | undefined,
): string[] {
  const errors: string[] = [];
  const hasBriefKey = Object.prototype.hasOwnProperty.call(vars ?? {}, "_ai_brief");
  const brief = str(vars?._ai_brief).trim();
  const aiMode = brief.length > 0 || vars?._ai_mode === true || vars?._ai_mode === "1";
  if ((hasBriefKey || aiMode) && !brief) errors.push("AI personalisation is on but the brief is empty");
  const { errors: build } = buildTemplateComponents(tpl, {
    vars: vars ?? {},
    headerMediaOverride,
    skipBodyCheck: brief.length > 0,
    validationOnly: true,
  });
  return [...errors, ...build];
}

// ---------------------------------------------------------------------------
// wa_messages status ordering (webhook monotonicity)
// ---------------------------------------------------------------------------
// sent < delivered < read. 'failed' may only override queued/sent (a message
// that was delivered or read cannot become undelivered).
export function allowedPriorStatuses(next: string): string[] {
  switch (next) {
    case "sent":
      return ["queued"];
    case "delivered":
      return ["queued", "sent"];
    case "read":
      return ["queued", "sent", "delivered"];
    case "failed":
      return ["queued", "sent"];
    default:
      return [];
  }
}
