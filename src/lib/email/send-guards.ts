// Pure send-guard helpers for the email flow engine (no DB, no env reads, so
// they are unit-testable and safe to import anywhere).
//
//   - Quiet hours: flow emails only go out 09:00-21:00 IST. A step that falls
//     due at night is DEFERRED to the next 09:00 IST (plus a small
//     deterministic jitter so a night's backlog doesn't all land at 09:00:00).
//   - Frequency cap ("smart sending"): if the contact got ANY other marketing
//     email (another flow's step, or a campaign) within the cap window, the
//     step is DEFERRED until the window clears. Never skipped: a missed
//     message is worse than a late one for flows, and a deferral is not an
//     attempt.
//   - A/B variants: a step can carry extra subject / preview lines. The
//     variant is a pure function of (enrollment_id, step_index), so a retry of
//     the same step always sends the same variant.
//
// These run BEFORE the email_sends claim insert, so they can never interfere
// with the atomic never-message-twice claim (promunch-email-agent/CLAUDE.md §0).

const IST_OFFSET_MIN = 330; // UTC+05:30, no DST
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

export const QUIET_START_HOUR_IST = 9; // inclusive
export const QUIET_END_HOUR_IST = 21; // exclusive
export const DEFAULT_FREQ_CAP_HOURS = 16;
export const QUIET_JITTER_MAX_MIN = 20;

/** FNV-1a 32-bit. Stable across runtimes; good enough for bucketing. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic 0..max-1 minutes of jitter for a key (0 when max <= 0). */
export function jitterMinutes(key: string, max = QUIET_JITTER_MAX_MIN): number {
  if (max <= 0) return 0;
  return hash32(`jitter:${key}`) % max;
}

/** Hour of day (0-23) in IST for an instant. */
export function istHour(at: Date): number {
  return new Date(at.getTime() + IST_OFFSET_MIN * MIN_MS).getUTCHours();
}

/**
 * Quiet-hours check. Returns null when `at` is inside the 09:00-21:00 IST send
 * window, else the instant of the next 09:00 IST plus `jitterMin` minutes.
 */
export function quietHoursDeferral(
  at: Date,
  opts: { startHour?: number; endHour?: number; jitterMin?: number } = {},
): Date | null {
  const start = opts.startHour ?? QUIET_START_HOUR_IST;
  const end = opts.endHour ?? QUIET_END_HOUR_IST;
  const ist = new Date(at.getTime() + IST_OFFSET_MIN * MIN_MS);
  const h = ist.getUTCHours();
  if (h >= start && h < end) return null;
  // Late evening rolls to tomorrow's window; early morning to today's.
  const dayOffset = h >= end ? 1 : 0;
  const startIstAsUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + dayOffset, start, 0, 0, 0);
  return new Date(startIstAsUtc - IST_OFFSET_MIN * MIN_MS + (opts.jitterMin ?? 0) * MIN_MS);
}

/**
 * When the frequency cap clears. Null = not capped (no recent send, cap
 * disabled with capHours <= 0, or the window already passed).
 */
export function freqCapClearsAt(lastSentAt: number | null | undefined, capHours: number, now: Date): Date | null {
  if (lastSentAt == null || !Number.isFinite(lastSentAt) || !(capHours > 0)) return null;
  const clears = lastSentAt + capHours * HOUR_MS;
  return clears > now.getTime() ? new Date(clears) : null;
}

/** Parse the cap hours from env/settings text. Garbage → default; 0 disables. */
export function parseCapHours(raw: unknown, fallback = DEFAULT_FREQ_CAP_HOURS): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, 24 * 14); // a two-week cap is already absurd; clamp typos
}

export type RecentSend = {
  contact_id: string;
  at: number; // epoch ms
  enrollment_id?: string | null;
  campaign_id?: string | null;
};

/**
 * Latest OTHER marketing send to this contact. The enrolment's own earlier
 * steps are excluded on purpose: a flow's own cadence (cart email 1 at +1h,
 * email 2 at +6h) is designed, and the cap exists to stop DIFFERENT
 * programs (a cart step + a welcome step + a campaign) piling up the same day.
 */
export function lastOtherMarketingAt(
  sends: RecentSend[] | undefined,
  exclude: { enrollmentId?: string; campaignId?: string } = {},
): number | null {
  let best: number | null = null;
  for (const s of sends ?? []) {
    if (exclude.enrollmentId && s.enrollment_id === exclude.enrollmentId) continue;
    if (exclude.campaignId && s.campaign_id === exclude.campaignId) continue;
    if (best === null || s.at > best) best = s.at;
  }
  return best;
}

export type DeferReason = "freq_cap" | "quiet_hours";

/**
 * The single decision the tick makes before claiming a step: send now (null)
 * or defer to `until`. Cap first, then quiet hours applied to the cap-clear
 * time, so a cap that clears at 02:00 IST lands at 09:xx instead.
 */
export function computeSendDeferral(opts: {
  now: Date;
  lastOtherMarketingAt: number | null;
  capHours: number;
  bypassCap: boolean;
  jitterKey: string;
}): { until: Date; reasons: DeferReason[] } | null {
  const reasons: DeferReason[] = [];
  let t = opts.now;
  if (!opts.bypassCap) {
    const clears = freqCapClearsAt(opts.lastOtherMarketingAt, opts.capHours, opts.now);
    if (clears) {
      t = clears;
      reasons.push("freq_cap");
    }
  }
  const qh = quietHoursDeferral(t, { jitterMin: jitterMinutes(opts.jitterKey) });
  if (qh) {
    t = qh;
    reasons.push("quiet_hours");
  }
  return reasons.length ? { until: t, reasons } : null;
}

/**
 * Cap bypass. Explicit step flag wins. Default: ONLY the first abandoned-cart
 * email bypasses, because it is time-critical (the cart is warm for an hour or
 * two, and the enrolment has a 72h deadline) and it is the customer's own
 * action, not a broadcast. Every later cart step (the coupon nudges) respects
 * the cap. Quiet hours still apply to everything.
 */
export function bypassesFreqCap(
  step: { bypass_freq_cap?: boolean },
  triggerType: string | null | undefined,
  stepIndex: number,
): boolean {
  if (typeof step.bypass_freq_cap === "boolean") return step.bypass_freq_cap;
  return triggerType === "checkout_abandoned" && stepIndex === 0;
}

// ---- A/B variants -----------------------------------------------------------

export type StepVariant = { label: string; subject: string; preview_text?: string };

function clean(list: unknown): string[] {
  return Array.isArray(list) ? list.map((s) => String(s ?? "")) : [];
}

/**
 * All variants of a step. Variant A is the step's own subject/preview; B, C...
 * come from subject_variants[i] / preview_variants[i]. A blank variant field
 * falls back to A's value, so "test only the preview line" works.
 */
export function stepVariants(step: {
  subject: string;
  preview_text?: string;
  subject_variants?: string[];
  preview_variants?: string[];
}): StepVariant[] {
  const subs = clean(step.subject_variants);
  const pres = clean(step.preview_variants);
  const extra = Math.max(subs.length, pres.length);
  const out: StepVariant[] = [{ label: "A", subject: step.subject, preview_text: step.preview_text }];
  for (let i = 0; i < extra; i++) {
    const s = subs[i]?.trim();
    const p = pres[i]?.trim();
    if (!s && !p) continue; // an empty "Variant B" row is not a variant
    out.push({
      label: String.fromCharCode(66 + (out.length - 1)), // B, C, ...
      subject: s || step.subject,
      preview_text: p || step.preview_text,
    });
  }
  return out;
}

/** Deterministic bucket for (enrollment, step) in 0..n-1. */
export function pickVariantIndex(enrollmentId: string, stepIndex: number, n: number): number {
  if (n <= 1) return 0;
  return hash32(`${enrollmentId}:${stepIndex}`) % n;
}

/** The variant this enrolment gets for this step (null label = no A/B test). */
export function variantFor(
  step: Parameters<typeof stepVariants>[0],
  enrollmentId: string,
  stepIndex: number,
): { variant: StepVariant; tested: boolean } {
  const vs = stepVariants(step);
  const v = vs[pickVariantIndex(enrollmentId, stepIndex, vs.length)];
  return { variant: v, tested: vs.length > 1 };
}

// ---- From name for plain "founder" emails ----------------------------------

/**
 * Swap the display name on a From header, keeping the verified address
 * ("PROMUNCH <hello@promunch.in>" + "Parth from PROMUNCH" →
 * "Parth from PROMUNCH <hello@promunch.in>"). Header-injection safe.
 */
export function withFromName(defaultFrom: string, name?: string | null): string {
  const n = String(name ?? "").replace(/[\r\n<>"]/g, "").trim().slice(0, 60);
  if (!n) return defaultFrom;
  const m = defaultFrom.match(/<([^>]+)>/);
  const addr = (m ? m[1] : defaultFrom).trim();
  return `${n} <${addr}>`;
}

// ---- A/B report ------------------------------------------------------------

export type VariantSendRow = {
  step_index: number;
  variant: string | null;
  status: string;
  opened_at: string | null;
  clicked_at: string | null;
};

export type VariantStat = {
  step_index: number;
  variant: string; // "A" when the send had no recorded variant
  sends: number;
  opens: number;
  clicks: number;
  open_rate: number; // 0..1
  click_rate: number; // 0..1
};

/** Sends/opens/clicks per (step, variant) over SENT rows only. */
export function summarizeVariants(rows: VariantSendRow[]): VariantStat[] {
  const m = new Map<string, VariantStat>();
  for (const r of rows) {
    if (r.status !== "sent") continue;
    const variant = r.variant || "A";
    const key = `${r.step_index}:${variant}`;
    const s = m.get(key) ?? { step_index: r.step_index, variant, sends: 0, opens: 0, clicks: 0, open_rate: 0, click_rate: 0 };
    s.sends++;
    if (r.opened_at) s.opens++;
    if (r.clicked_at) s.clicks++;
    m.set(key, s);
  }
  return [...m.values()]
    .map((s) => ({ ...s, open_rate: s.sends ? s.opens / s.sends : 0, click_rate: s.sends ? s.clicks / s.sends : 0 }))
    .sort((a, b) => a.step_index - b.step_index || a.variant.localeCompare(b.variant));
}

// ---- Coupon safety ----------------------------------------------------------
//
// Offers use unique minted codes with NO static fallback (coupon_code ""), so
// a Shopify mint failure returns "". An email that promises "your code:" and
// shows nothing (or a literal "{{coupon_code}}") must never go out. The engine
// runs this AFTER rendering and BEFORE sendEmail; a non-null result means
// "do not send, release the claim, retry later".

/** Any coupon-ish merge tag, including unsupported spellings like {{coupon}}. */
const COUPON_TOKEN_RE = /\{\{\s*coupon[a-z_]*\s*\}\}/i;

export function mentionsCouponToken(text: string | null | undefined): boolean {
  return COUPON_TOKEN_RE.test(String(text ?? ""));
}

/** True when the step mints a unique code (percent_off > 0). */
export function stepWantsCoupon(step: { coupon?: { percent_off?: number } | null }): boolean {
  return !!step.coupon && Number(step.coupon.percent_off) > 0;
}

/**
 * Why this rendered email is unsafe to send because of its coupon, or null.
 *   - the step mints a code and the mint came back empty
 *   - the copy (subject / preview / body, any variant) uses a coupon merge tag
 *     and the code is empty (the slot would render blank)
 *   - a coupon merge tag survived rendering (e.g. an unsupported {{coupon}})
 */
export function couponProblem(opts: {
  step: {
    coupon?: { percent_off?: number } | null;
    subject?: string;
    preview_text?: string;
    body_html?: string;
    subject_variants?: string[];
    preview_variants?: string[];
  };
  coupon: string;
  rendered: { subject: string; html: string; previewText?: string };
}): string | null {
  const code = String(opts.coupon ?? "").trim();
  const s = opts.step;
  if (stepWantsCoupon(s) && !code) return "coupon unavailable";
  const sources = [s.subject, s.preview_text, s.body_html, ...(s.subject_variants ?? []), ...(s.preview_variants ?? [])];
  if (!code && sources.some(mentionsCouponToken)) return "coupon unavailable";
  const r = opts.rendered;
  if ([r.subject, r.html, r.previewText].some(mentionsCouponToken)) return "coupon unavailable (unrendered coupon tag)";
  return null;
}

// ---- WhatsApp overlap guard ---------------------------------------------------
//
// WhatsApp already runs review / replenishment / cart journeys
// (wa_journey_runs, promunch-email-agent/supabase/functions/_shared/journeys.ts).
// A step with skip_if_wa_journey stands down when WhatsApp already SENT the
// matching ask to this customer, so they don't get the same nudge twice on
// two channels.

export type WaJourneyKind = "review" | "replenishment" | "cart";

export const WA_JOURNEY_KEYS: Record<WaJourneyKind, string> = {
  review: "review_request",
  replenishment: "replenishment_reminder",
  cart: "abandoned_checkout",
};

export const WA_OVERLAP_WINDOW_DAYS = 30;

/**
 * Raw phone → Meta wa_id digits (India default). Same rules as toWaId in
 * promunch-email-agent/supabase/functions/_shared/journeys.ts; keep in sync.
 */
export function toWaId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

export type WaJourneyRunRow = {
  journey_key: string;
  status: string;
  order_ref: string | null;
  delivered_at: string | null;
  updated_at: string | null;
  next_action_at: string | null;
};

/**
 * A run counts as SENT when wa-journey-tick marked it 'completed' (Meta
 * accepted the send; an async failure reopens it to 'active') or the status
 * webhook recorded delivered_at. active / cancelled / failed / expired /
 * converted-without-delivery are not sends.
 */
export function waRunWasSent(r: Pick<WaJourneyRunRow, "status" | "delivered_at">): boolean {
  return r.status === "completed" || !!r.delivered_at;
}

/** Order / checkout refs an email enrolment is about (order_ref, checkout tokens). */
export function enrolmentRefs(ctx: Record<string, unknown> | null | undefined): string[] {
  const c = ctx ?? {};
  const out = new Set<string>();
  const add = (v: unknown) => {
    const s = v == null ? "" : String(v).trim();
    if (s) out.add(s);
  };
  add(c.order_ref);
  add(c.order_name);
  add(c.checkout_token);
  if (Array.isArray(c.checkout_tokens)) c.checkout_tokens.forEach(add);
  return [...out];
}

/**
 * The pure decision: did WhatsApp already send this kind of ask?
 *   - refs known (the enrolment carries its order / checkout): only a sent run
 *     for one of THOSE refs counts (a review ask about a different order is a
 *     different ask).
 *   - no refs: any sent run of that journey within the last windowDays.
 * Returns the matching run's ref (or "recent") for logging, or null.
 */
export function waJourneyOverlap(opts: {
  kind: WaJourneyKind;
  runs: WaJourneyRunRow[];
  refs: string[];
  now: Date;
  windowDays?: number;
}): { ref: string } | null {
  const key = WA_JOURNEY_KEYS[opts.kind];
  if (!key) return null;
  const sent = opts.runs.filter((r) => r.journey_key === key && waRunWasSent(r));
  if (opts.refs.length) {
    const refs = new Set(opts.refs);
    const hit = sent.find((r) => r.order_ref != null && refs.has(String(r.order_ref)));
    return hit ? { ref: String(hit.order_ref) } : null;
  }
  const since = opts.now.getTime() - (opts.windowDays ?? WA_OVERLAP_WINDOW_DAYS) * 24 * HOUR_MS;
  const hit = sent.find((r) => {
    const at = Date.parse(r.delivered_at ?? r.updated_at ?? r.next_action_at ?? "");
    return Number.isFinite(at) && at >= since;
  });
  return hit ? { ref: hit.order_ref ? String(hit.order_ref) : "recent" } : null;
}
