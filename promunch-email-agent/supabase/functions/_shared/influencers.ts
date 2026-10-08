// Influencer delivery tracker: shared types + PURE logic for the reminder
// engine (influencer-send, influencer-tick). Schema source of truth:
// supabase/migrations/018_influencers.sql. Build spec:
// docs/plans/2026-10-07-influencer-build-spec.md ("Edge functions").
//
// Everything except loadInfluencerSettings() is pure (no DB, no env except the
// portal URL) so it is unit-tested in influencers_test.ts.
//
// NO-SPAM model (promunch-email-agent/CLAUDE.md §0):
//   * one influencer_reminders row = one message; unique (deal_id, kind, step)
//     means a given nudge can exist once.
//   * deriveReminders() is deterministic: the same deal state always yields the
//     same (kind, step) keys, so re-arming every 15 min only ever inserts once.
//   * only the caller that wins claim_influencer_reminder (scheduled→sending
//     compare-and-set) may send, and it checks the wa_messages ledger marker
//     `influencer:<reminder_id>` first.

import { db } from "./supabase.ts";

// ---------------------------------------------------------------------------
// Types (mirror 018_influencers.sql; only the columns the engine reads)
// ---------------------------------------------------------------------------

export type DealStage =
  | "agreed" | "brief_draft" | "brief_sent" | "brief_acknowledged" | "dispatched" | "delivered"
  | "draft_submitted" | "changes_requested" | "draft_approved" | "posted" | "completed"
  | "cancelled" | "ghosted";

export const CLOSED_STAGES: ReadonlySet<string> = new Set(["completed", "cancelled", "ghosted"]);

export interface DealRow {
  id: string;
  influencer_id: string;
  code: string;
  stage: DealStage;
  agreed_at: string;
  brief_sent_at: string | null;
  brief_acknowledged_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  draft_due_at: string | null;
  draft_submitted_at: string | null;
  draft_approved_at: string | null;
  go_live_at: string | null;
  posted_at: string | null;
  shopify_order_id?: string | null;
  order_status_url?: string | null;
  revision_count?: number | null;
}

export interface InfluencerRow {
  id: string;
  handle: string;
  full_name: string | null;
  phone: string | null;
  status: "active" | "paused" | "blocked";
}

export interface ReminderRow {
  id: string;
  deal_id: string;
  kind: string;
  step: number;
  audience: "creator" | "team" | "owner";
  channel: "whatsapp" | "task";
  status: "scheduled" | "sending" | "sent" | "done" | "cancelled" | "failed";
  due_at: string;
  template_name: string | null;
  claimed_at: string | null;
  sent_at: string | null;
  wa_message_id: string | null;
  attempts: number;
  last_error: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface NudgeSettings {
  brief_ack: { after_hours: number[]; escalate_after_hours: number };
  delivery_check: { after_days_from_dispatch: number[]; escalate_after_days: number };
  draft_due: { days_before_due: number[]; days_after_due: number[]; escalate_after_days: number };
  post_due: { days_before: number[]; overdue_after_days: number; ghosted_after_days: number };
}

export interface TeamSla {
  brief_approval_hours: number;
  dispatch_hours: number;
  draft_review_hours: number;
}

export interface InfluencerSettings {
  engine_enabled: boolean;
  digest_enabled: boolean;
  digest_hour_ist: number;
  owner_wa_id: string | null;
  default_draft_due_days: number;
  default_post_after_approval_days: number;
  nudges: NudgeSettings;
  team_sla: TeamSla;
}

export const DEFAULT_NUDGES: NudgeSettings = {
  brief_ack: { after_hours: [24, 48], escalate_after_hours: 72 },
  delivery_check: { after_days_from_dispatch: [4, 6], escalate_after_days: 8 },
  draft_due: { days_before_due: [2, 0], days_after_due: [1, 3], escalate_after_days: 5 },
  post_due: { days_before: [1], overdue_after_days: 2, ghosted_after_days: 7 },
};

export const DEFAULT_TEAM_SLA: TeamSla = {
  brief_approval_hours: 24,
  dispatch_hours: 48,
  draft_review_hours: 24,
};

export const DEFAULT_SETTINGS: InfluencerSettings = {
  engine_enabled: false,
  digest_enabled: false,
  digest_hour_ist: 9,
  owner_wa_id: null,
  default_draft_due_days: 10,
  default_post_after_approval_days: 3,
  nudges: DEFAULT_NUDGES,
  team_sla: DEFAULT_TEAM_SLA,
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const numArr = (v: unknown, fb: number[]): number[] =>
  Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n >= 0) : fb;
const num = (v: unknown, fb: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fb;
};

// Merge a (possibly partially edited) settings row over the defaults. Pure.
export function normalizeSettings(row: Record<string, unknown> | null | undefined): InfluencerSettings {
  if (!row) return DEFAULT_SETTINGS;
  const n = (row.nudges ?? {}) as Record<string, Record<string, unknown>>;
  const s = (row.team_sla ?? {}) as Record<string, unknown>;
  const d = DEFAULT_NUDGES;
  return {
    engine_enabled: row.engine_enabled === true,
    digest_enabled: row.digest_enabled === true,
    digest_hour_ist: Math.min(23, Math.max(0, Math.floor(num(row.digest_hour_ist, 9)))),
    owner_wa_id: typeof row.owner_wa_id === "string" && row.owner_wa_id.trim() ? row.owner_wa_id : null,
    default_draft_due_days: num(row.default_draft_due_days, 10),
    default_post_after_approval_days: num(row.default_post_after_approval_days, 3),
    nudges: {
      brief_ack: {
        after_hours: numArr(n.brief_ack?.after_hours, d.brief_ack.after_hours),
        escalate_after_hours: num(n.brief_ack?.escalate_after_hours, d.brief_ack.escalate_after_hours),
      },
      delivery_check: {
        after_days_from_dispatch: numArr(
          n.delivery_check?.after_days_from_dispatch,
          d.delivery_check.after_days_from_dispatch,
        ),
        escalate_after_days: num(n.delivery_check?.escalate_after_days, d.delivery_check.escalate_after_days),
      },
      draft_due: {
        days_before_due: numArr(n.draft_due?.days_before_due, d.draft_due.days_before_due),
        days_after_due: numArr(n.draft_due?.days_after_due, d.draft_due.days_after_due),
        escalate_after_days: num(n.draft_due?.escalate_after_days, d.draft_due.escalate_after_days),
      },
      post_due: {
        days_before: numArr(n.post_due?.days_before, d.post_due.days_before),
        overdue_after_days: num(n.post_due?.overdue_after_days, d.post_due.overdue_after_days),
        ghosted_after_days: num(n.post_due?.ghosted_after_days, d.post_due.ghosted_after_days),
      },
    },
    team_sla: {
      brief_approval_hours: num(s.brief_approval_hours, DEFAULT_TEAM_SLA.brief_approval_hours),
      dispatch_hours: num(s.dispatch_hours, DEFAULT_TEAM_SLA.dispatch_hours),
      draft_review_hours: num(s.draft_review_hours, DEFAULT_TEAM_SLA.draft_review_hours),
    },
  };
}

// Load the single settings row. On a DB error this returns the defaults, whose
// engine_enabled=false means "send nothing to creators" (fail toward silence).
export async function loadInfluencerSettings(): Promise<InfluencerSettings> {
  const { data, error } = await db().from("influencer_settings").select("*").eq("id", 1).maybeSingle();
  if (error) {
    console.error("[influencers] settings load failed", error.message);
    return DEFAULT_SETTINGS;
  }
  return normalizeSettings(data as Record<string, unknown> | null);
}

// Owner's WhatsApp for escalations + digest: settings row, then OWNER_WA_ID,
// then ESCALATION_WA_ID (the existing owner ticket lane). Digits only.
export function ownerWaId(settings: InfluencerSettings): string {
  const pick = settings.owner_wa_id || Deno.env.get("OWNER_WA_ID") || Deno.env.get("ESCALATION_WA_ID") || "";
  return toWaId(pick) ?? "";
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 86_400_000;
const IST_OFFSET = 5.5 * HOUR; // India has no DST

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

// Digits incl. country code, same format as wa_contacts.wa_id. Bare 10-digit
// Indian numbers get 91. Null when it can't be a phone number.
export function toWaId(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

// IST calendar date key, e.g. "2026-10-07".
export function istDateKey(t: number): string {
  return new Date(t + IST_OFFSET).toISOString().slice(0, 10);
}

export function istHour(t: number): number {
  return new Date(t + IST_OFFSET).getUTCHours();
}

// The instant that is `hour:minute` IST on (IST calendar date of t) + dayOffset.
export function atIst(t: number, dayOffset: number, hour = 10, minute = 0): number {
  const d = new Date(t + IST_OFFSET);
  const midnightUtcOfIstDate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return midnightUtcOfIstDate + dayOffset * DAY + hour * HOUR + minute * 60_000 - IST_OFFSET;
}

// "12 Oct" in IST. Used inside template params, so plain ASCII.
export function fmtDateIst(iso: string | null | undefined): string {
  const t = ms(iso);
  if (t === null) return "the agreed date";
  const d = new Date(t + IST_OFFSET);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon}`;
}

export function firstName(inf: Pick<InfluencerRow, "full_name" | "handle">): string {
  const n = (inf.full_name ?? "").trim().split(/\s+/)[0];
  if (n) return n.slice(0, 40);
  return (inf.handle ?? "there").replace(/^@/, "").slice(0, 40) || "there";
}

// Meta rejects template params with newlines/tabs or 4+ consecutive spaces;
// brand rules ban em dashes in creator-facing copy.
export function cleanParam(s: string, max = 200): string {
  const out = String(s ?? "")
    .replace(/[—–]/g, ",")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
  return out || "-";
}

// Creator messages only go out 09:00 to 21:00 IST.
export const SEND_WINDOW_IST = { start: 9, end: 21 };
export function inSendWindow(t: number): boolean {
  const h = istHour(t);
  return h >= SEND_WINDOW_IST.start && h < SEND_WINDOW_IST.end;
}
export function nextSendWindowStart(t: number): number {
  const h = istHour(t);
  return h < SEND_WINDOW_IST.start ? atIst(t, 0, SEND_WINDOW_IST.start, 30) : atIst(t, 1, SEND_WINDOW_IST.start, 30);
}

// ---------------------------------------------------------------------------
// Portal URL
// ---------------------------------------------------------------------------

export const DEFAULT_SITE_APP_URL = "https://admin.promunch.in";

export function siteAppUrl(): string {
  const raw = (Deno.env.get("SITE_APP_URL") ?? "").trim() || DEFAULT_SITE_APP_URL;
  return raw.replace(/\/+$/, "");
}

// Creator-facing host (collab.promunch.in). The Next middleware rewrites
// /<code> to the portal page; the dashboard host keeps serving /c/<code>.
export const DEFAULT_COLLAB_PORTAL_URL = "https://collab.promunch.in";

export function portalUrl(code: string): string {
  const base = ((Deno.env.get("COLLAB_PORTAL_URL") ?? "").trim() || DEFAULT_COLLAB_PORTAL_URL).replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(code)}`;
}

// ---------------------------------------------------------------------------
// Template registry (creator-facing). Every template has exactly one dynamic
// URL button `https://collab.promunch.in/{{1}}`; the button param is the deal code.
// Copy + Meta definitions: docs/whatsapp/influencer-templates.md and
// _shared/influencer-templates.json.
// ---------------------------------------------------------------------------

export type SendKind =
  | "brief_ready" | "brief_reminder" | "box_check" | "draft_reminder" | "draft_overdue"
  | "draft_feedback" | "post_reminder" | "post_fix";

export const SEND_KINDS: readonly SendKind[] = [
  "brief_ready", "brief_reminder", "box_check", "draft_reminder", "draft_overdue",
  "draft_feedback", "post_reminder", "post_fix",
];

export interface ParamCtx {
  influencer: Pick<InfluencerRow, "full_name" | "handle">;
  deal: DealRow;
  meta: Record<string, unknown>; // reminder meta (decision / note / go_live)
}

export interface TemplateSpec {
  name: string;
  language: "en";
  body: (c: ParamCtx) => string[]; // {{1}}..{{n}} in order
}

const name1 = (c: ParamCtx) => cleanParam(firstName(c.influencer), 40);

export function feedbackLine(c: ParamCtx): string {
  if (c.meta.decision === "approved") {
    return c.deal.go_live_at
      ? `your draft is approved, please post it on ${fmtDateIst(c.deal.go_live_at)}`
      : "your draft is approved and ready to post";
  }
  return "we have a few small changes for you";
}

export const TEMPLATES: Record<SendKind, TemplateSpec> = {
  brief_ready: { name: "influencer_brief_ready", language: "en", body: (c) => [name1(c)] },
  brief_reminder: { name: "influencer_brief_reminder", language: "en", body: (c) => [name1(c)] },
  box_check: {
    name: "influencer_box_check",
    language: "en",
    body: (c) => [name1(c), fmtDateIst(c.deal.dispatched_at)],
  },
  draft_reminder: {
    name: "influencer_draft_reminder",
    language: "en",
    body: (c) => [name1(c), fmtDateIst(c.deal.draft_due_at)],
  },
  draft_overdue: {
    name: "influencer_draft_overdue",
    language: "en",
    body: (c) => [name1(c), fmtDateIst(c.deal.draft_due_at)],
  },
  draft_feedback: {
    name: "influencer_draft_feedback",
    language: "en",
    body: (c) => [name1(c), cleanParam(feedbackLine(c), 120)],
  },
  post_reminder: {
    name: "influencer_post_reminder",
    language: "en",
    body: (c) => [name1(c), fmtDateIst(c.deal.go_live_at)],
  },
  post_fix: {
    name: "influencer_post_fix",
    language: "en",
    // template adds the full stop after {{2}}
    body: (c) => [
      name1(c),
      cleanParam(String(c.meta.note || "a small detail in the post").replace(/[.\s]+$/, ""), 160),
    ],
  },
};

// Meta component array for a send: body params + the URL button param (code).
export function buildTemplateComponents(kind: SendKind, c: ParamCtx) {
  const params = TEMPLATES[kind].body(c);
  const vars: Record<string, string> = {};
  params.forEach((p, i) => (vars[String(i + 1)] = p));
  const components = [
    { type: "body" as const, parameters: params.map((text) => ({ type: "text" as const, text })) },
    {
      type: "button" as const,
      sub_type: "url" as const,
      index: "0",
      parameters: [{ type: "text" as const, text: c.deal.code }],
    },
  ];
  return { name: TEMPLATES[kind].name, language: TEMPLATES[kind].language, components, vars };
}

// ---------------------------------------------------------------------------
// Reminder kinds
//
// Row kinds (influencer_reminders.kind):
//   creator, derived by the tick : brief_ack, delivery_check, draft_due, post_due
//   creator, manual (dashboard)  : brief_ready (step = brief version),
//                                  draft_feedback (step = draft version),
//                                  post_fix (step = fix round, default 1),
//                                  manual_<send kind> (step = IST day number:
//                                  a manual nudge can go once per day)
//   team tasks (channel task)    : team_brief_approval, team_dispatch,
//                                  team_draft_review, team_fix_phone
//   owner WhatsApp ping          : escalation
//
// Step namespaces (deterministic, so re-arming is idempotent):
//   brief_ack       version*10 + i   (i = 1..9 per after_hours entry)
//   delivery_check  1..n
//   draft_due       1..10 before/on due day (draft_reminder), 11.. after (draft_overdue)
//   post_due        1..n
//   escalation      100+brief version (brief unacked) | 200 (box unconfirmed) | 300 (draft late)
//   team_dispatch   1 (anchored agreed_at) | 2 (anchored brief_acknowledged_at)
//   team_brief_approval 1 ; team_draft_review = draft version
// ---------------------------------------------------------------------------

// Kinds the tick derives (and therefore may cancel / complete when the deal no
// longer implies them). Manual kinds are never touched by the ARM pass.
export const DERIVED_CREATOR_KINDS: ReadonlySet<string> = new Set([
  "brief_ack", "delivery_check", "draft_due", "post_due",
]);
export const DERIVED_TEAM_KINDS: ReadonlySet<string> = new Set([
  "team_brief_approval", "team_dispatch", "team_draft_review",
]);
export const DERIVED_KINDS: ReadonlySet<string> = new Set([
  ...DERIVED_CREATOR_KINDS, ...DERIVED_TEAM_KINDS, "escalation",
]);

export const DRAFT_OVERDUE_STEP_BASE = 10;

// Which template a creator reminder row sends. Null for team/owner rows.
export function sendKindFor(kind: string, step: number): SendKind | null {
  switch (kind) {
    case "brief_ready": return "brief_ready";
    case "brief_ack": return "brief_reminder";
    case "delivery_check": return "box_check";
    case "draft_due": return step > DRAFT_OVERDUE_STEP_BASE ? "draft_overdue" : "draft_reminder";
    case "draft_feedback": return "draft_feedback";
    case "post_due": return "post_reminder";
    case "post_fix": return "post_fix";
  }
  if (kind.startsWith("manual_")) {
    const k = kind.slice("manual_".length) as SendKind;
    return (SEND_KINDS as readonly string[]).includes(k) ? k : null;
  }
  return null;
}

// Manual {deal_id, kind} → the reminder row key it lives under.
// Returns null when the kind is not a valid manual send.
export function manualRowKey(
  kind: SendKind,
  ctx: { briefVersion: number | null; draftVersion: number | null; step?: number | null; now: number },
): { kind: string; step: number } | { error: string } {
  if (kind === "brief_ready") {
    if (!ctx.briefVersion) return { error: "no approved or sent brief to announce" };
    return { kind: "brief_ready", step: ctx.briefVersion };
  }
  if (kind === "draft_feedback") {
    if (!ctx.draftVersion) return { error: "no reviewed draft to give feedback on" };
    return { kind: "draft_feedback", step: ctx.draftVersion };
  }
  if (kind === "post_fix") {
    const s = Math.floor(Number(ctx.step ?? 1));
    return { kind: "post_fix", step: s >= 1 ? s : 1 };
  }
  // automated kinds sent by hand: once per IST calendar day per deal
  const istDay = Math.floor((ctx.now + IST_OFFSET) / DAY);
  return { kind: `manual_${kind}`, step: istDay };
}

// ---------------------------------------------------------------------------
// deriveReminders: the PURE arming rule
// ---------------------------------------------------------------------------

export interface DesiredReminder {
  kind: string;
  step: number;
  audience: "creator" | "team" | "owner";
  channel: "whatsapp" | "task";
  due_at: string;
  template_name: string | null;
  meta: Record<string, unknown>;
}

export interface DeriveCtx {
  briefVersion: number | null;      // latest SENT brief version (namespaces brief_ack)
  latestDraftVersion: number | null; // latest submitted draft version
  latestDraftSubmittedAt: string | null;
}

// A creator nudge whose time passed more than this long ago is not sent at
// all (e.g. engine switched on late): stale nudges read as spam.
export const CREATOR_STALE_HOURS = 36;

// From a gate's ordered creator steps, keep only the future ones plus the
// single most recent due one (never two catch-up nudges at once), and drop it
// too if it is stale.
function trimCreatorSteps(steps: DesiredReminder[], now: number): DesiredReminder[] {
  const sorted = [...steps].sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  const past = sorted.filter((s) => Date.parse(s.due_at) <= now);
  const future = sorted.filter((s) => Date.parse(s.due_at) > now);
  const latestPast = past[past.length - 1];
  const keep = latestPast && now - Date.parse(latestPast.due_at) <= CREATOR_STALE_HOURS * HOUR ? [latestPast] : [];
  return [...keep, ...future];
}

function creator(kind: string, step: number, at: number, meta: Record<string, unknown> = {}): DesiredReminder {
  const sk = sendKindFor(kind, step);
  return {
    kind,
    step,
    audience: "creator",
    channel: "whatsapp",
    due_at: new Date(at).toISOString(),
    template_name: sk ? TEMPLATES[sk].name : null,
    meta,
  };
}

function team(kind: string, step: number, at: number, meta: Record<string, unknown>): DesiredReminder {
  return { kind, step, audience: "team", channel: "task", due_at: new Date(at).toISOString(), template_name: null, meta };
}

function owner(step: number, at: number, meta: Record<string, unknown>): DesiredReminder {
  return {
    kind: "escalation",
    step,
    audience: "owner",
    channel: "whatsapp",
    due_at: new Date(at).toISOString(),
    template_name: null,
    meta,
  };
}

export function deriveReminders(
  deal: DealRow,
  settings: InfluencerSettings,
  now: number,
  ctx: DeriveCtx,
): DesiredReminder[] {
  if (CLOSED_STAGES.has(deal.stage)) return [];
  const n = settings.nudges;
  const sla = settings.team_sla;
  const out: DesiredReminder[] = [];

  // ---- brief acknowledgement (creator) + escalation ----
  const briefSent = ms(deal.brief_sent_at);
  if (deal.stage === "brief_sent" && briefSent !== null && !deal.brief_acknowledged_at) {
    const v = Math.max(1, Math.min(99, ctx.briefVersion ?? 1));
    const steps = n.brief_ack.after_hours.slice(0, 9).map((h, i) =>
      creator("brief_ack", v * 10 + i + 1, briefSent + h * HOUR, { gate: "brief_ack", brief_version: v })
    );
    out.push(...trimCreatorSteps(steps, now));
    out.push(owner(100 + v, briefSent + n.brief_ack.escalate_after_hours * HOUR, {
      gate: "brief_ack",
      reason: `Brief not acknowledged ${n.brief_ack.escalate_after_hours}h after sending`,
    }));
  }

  // ---- box delivery check (creator) + escalation ----
  const dispatched = ms(deal.dispatched_at);
  if (deal.stage === "dispatched" && dispatched !== null && !deal.delivered_at) {
    const steps = n.delivery_check.after_days_from_dispatch.map((d, i) =>
      creator("delivery_check", i + 1, atIst(dispatched, d), { gate: "delivery_check" })
    );
    out.push(...trimCreatorSteps(steps, now));
    out.push(owner(200, atIst(dispatched, n.delivery_check.escalate_after_days), {
      gate: "delivery_check",
      reason: `Box not confirmed ${n.delivery_check.escalate_after_days} days after dispatch`,
    }));
  }

  // ---- draft due (creator) + escalation; only before the first draft ----
  const due = ms(deal.draft_due_at);
  if (deal.stage === "delivered" && due !== null && !deal.draft_submitted_at) {
    const before = n.draft_due.days_before_due.slice(0, DRAFT_OVERDUE_STEP_BASE).map((d, i) => {
      // reminder on (due date - d) at 10:00 IST, but never after the deadline itself
      const at = Math.min(atIst(due, -d), due - HOUR);
      return creator("draft_due", i + 1, at, { gate: "draft_due", phase: "before" });
    });
    const after = n.draft_due.days_after_due.map((d, i) =>
      creator("draft_due", DRAFT_OVERDUE_STEP_BASE + i + 1, atIst(due, d), { gate: "draft_due", phase: "after" })
    );
    out.push(...trimCreatorSteps([...before, ...after], now));
    out.push(owner(300, atIst(due, n.draft_due.escalate_after_days), {
      gate: "draft_due",
      reason: `Draft ${n.draft_due.escalate_after_days} days late`,
    }));
  }

  // ---- post reminder (creator) ----
  const goLive = ms(deal.go_live_at);
  if (deal.stage === "draft_approved" && goLive !== null && !deal.posted_at) {
    const steps = n.post_due.days_before.map((d, i) =>
      creator("post_due", i + 1, atIst(goLive, -d), { gate: "post_due", go_live_at: deal.go_live_at })
    );
    out.push(...trimCreatorSteps(steps, now));
  }

  // ---- team tasks (our-side SLAs) ----
  const agreed = ms(deal.agreed_at) ?? now;
  if (deal.stage === "agreed" || deal.stage === "brief_draft") {
    out.push(team("team_brief_approval", 1, agreed + sla.brief_approval_hours * HOUR, {
      reason: `Brief not approved and sent within ${sla.brief_approval_hours}h`,
    }));
  }
  if (!deal.dispatched_at) {
    if (deal.stage === "agreed") {
      out.push(team("team_dispatch", 1, agreed + sla.dispatch_hours * HOUR, {
        reason: `Kit not dispatched ${sla.dispatch_hours}h after agreeing`,
      }));
    }
    const acked = ms(deal.brief_acknowledged_at);
    if (deal.stage === "brief_acknowledged" && acked !== null) {
      out.push(team("team_dispatch", 2, acked + sla.dispatch_hours * HOUR, {
        reason: `Kit not dispatched ${sla.dispatch_hours}h after brief acknowledged`,
      }));
    }
  }
  if (deal.stage === "draft_submitted") {
    const sub = ms(ctx.latestDraftSubmittedAt) ?? ms(deal.draft_submitted_at);
    if (sub !== null) {
      const v = ctx.latestDraftVersion ?? (deal.revision_count ?? 0) + 1;
      out.push(team("team_draft_review", v, sub + sla.draft_review_hours * HOUR, {
        reason: `Draft v${v} not reviewed within ${sla.draft_review_hours}h`,
        draft_version: v,
      }));
    }
  }
  return out;
}

export const reminderKey = (r: { kind: string; step: number }) => `${r.kind}#${r.step}`;

// ---------------------------------------------------------------------------
// Health (minimal edge-side copy of src/lib/influencers/health.ts semantics)
// ---------------------------------------------------------------------------

export type DealHealth = "overdue" | "at_risk" | "waiting_on_us" | "on_track" | "closed";

export interface HealthResult {
  health: DealHealth;
  reason: string | null;
  days_overdue: number | null;
}

export function dealHealth(deal: DealRow, settings: InfluencerSettings, now: number): HealthResult {
  if (CLOSED_STAGES.has(deal.stage) || deal.stage === "posted") {
    return { health: deal.stage === "posted" ? "on_track" : "closed", reason: null, days_overdue: null };
  }
  const sla = settings.team_sla;
  const n = settings.nudges;
  const due = ms(deal.draft_due_at);
  const goLive = ms(deal.go_live_at);
  const awaitingDraft = deal.stage === "delivered" || deal.stage === "changes_requested";

  // overdue
  if (awaitingDraft && due !== null && now > due) {
    const d = Math.max(1, Math.ceil((now - due) / DAY));
    return { health: "overdue", reason: `Draft ${d}d late`, days_overdue: d };
  }
  if (deal.stage === "draft_approved" && goLive !== null && now > goLive + n.post_due.overdue_after_days * DAY) {
    const d = Math.max(1, Math.ceil((now - goLive) / DAY));
    return { health: "overdue", reason: `Post ${d}d late`, days_overdue: d };
  }
  // at risk
  if (awaitingDraft && due !== null && due - now <= 2 * DAY) {
    return { health: "at_risk", reason: "Draft due within 2 days", days_overdue: null };
  }
  const briefSent = ms(deal.brief_sent_at);
  if (deal.stage === "brief_sent" && briefSent !== null && now - briefSent > n.brief_ack.escalate_after_hours * HOUR) {
    return { health: "at_risk", reason: "Brief not acknowledged", days_overdue: null };
  }
  const dispatched = ms(deal.dispatched_at);
  if (
    deal.stage === "dispatched" && dispatched !== null &&
    now - dispatched > n.delivery_check.escalate_after_days * DAY
  ) {
    return { health: "at_risk", reason: "Delivery not confirmed", days_overdue: null };
  }
  // waiting on us
  const agreed = ms(deal.agreed_at) ?? now;
  if ((deal.stage === "agreed" || deal.stage === "brief_draft") && now - agreed > sla.brief_approval_hours * HOUR) {
    return { health: "waiting_on_us", reason: "Brief to approve", days_overdue: null };
  }
  const acked = ms(deal.brief_acknowledged_at);
  if (
    !deal.dispatched_at &&
    ((deal.stage === "agreed" && now - agreed > sla.dispatch_hours * HOUR) ||
      (deal.stage === "brief_acknowledged" && acked !== null && now - acked > sla.dispatch_hours * HOUR))
  ) {
    return { health: "waiting_on_us", reason: "Kit to ship", days_overdue: null };
  }
  const sub = ms(deal.draft_submitted_at);
  if (deal.stage === "draft_submitted" && sub !== null && now - sub > sla.draft_review_hours * HOUR) {
    return { health: "waiting_on_us", reason: "Draft to review", days_overdue: null };
  }
  return { health: "on_track", reason: null, days_overdue: null };
}

// ---------------------------------------------------------------------------
// Digest (owner, once per IST day)
// ---------------------------------------------------------------------------

export interface DigestCounts {
  due_today: number;
  overdue: number;
  overdue_list: string[]; // "@a 4d"
  at_risk: number;
  briefs_to_approve: number;
  drafts_to_review: number;
  kits_to_ship: number;
}

export function digestCounts(
  deals: Array<DealRow & { handle: string }>,
  briefDraftDealIds: Set<string>,
  settings: InfluencerSettings,
  now: number,
): DigestCounts {
  const today = istDateKey(now);
  const c: DigestCounts = {
    due_today: 0, overdue: 0, overdue_list: [], at_risk: 0,
    briefs_to_approve: 0, drafts_to_review: 0, kits_to_ship: 0,
  };
  const overdue: Array<{ h: string; d: number }> = [];
  for (const d of deals) {
    if (CLOSED_STAGES.has(d.stage)) continue;
    const h = dealHealth(d, settings, now);
    if (h.health === "overdue") overdue.push({ h: d.handle, d: h.days_overdue ?? 1 });
    if (h.health === "at_risk") c.at_risk++;
    const due = ms(d.draft_due_at);
    const goLive = ms(d.go_live_at);
    if (
      ((d.stage === "delivered" || d.stage === "changes_requested") && due !== null && istDateKey(due) === today) ||
      (d.stage === "draft_approved" && goLive !== null && istDateKey(goLive) === today)
    ) c.due_today++;
    if ((d.stage === "agreed" || d.stage === "brief_draft") && briefDraftDealIds.has(d.id)) c.briefs_to_approve++;
    if (d.stage === "draft_submitted") c.drafts_to_review++;
    if (d.stage === "brief_acknowledged" && !d.dispatched_at) c.kits_to_ship++;
  }
  overdue.sort((a, b) => b.d - a.d);
  c.overdue = overdue.length;
  c.overdue_list = overdue.map((o) => `@${o.h.replace(/^@/, "")} ${o.d}d`);
  return c;
}

export function digestLine(c: DigestCounts): string {
  const shown = c.overdue_list.slice(0, 5);
  const more = c.overdue_list.length > shown.length ? `, +${c.overdue_list.length - shown.length} more` : "";
  const od = c.overdue ? `Overdue ${c.overdue} (${shown.join(", ")}${more})` : "Overdue 0";
  return [
    `Due today ${c.due_today}`,
    od,
    `At risk ${c.at_risk}`,
    `Briefs to approve ${c.briefs_to_approve}`,
    `Drafts to review ${c.drafts_to_review}`,
    `Kits to ship ${c.kits_to_ship}`,
  ].join(" · ");
}

export function digestIsEmpty(c: DigestCounts): boolean {
  return !c.due_today && !c.overdue && !c.at_risk && !c.briefs_to_approve && !c.drafts_to_review &&
    !c.kits_to_ship;
}
