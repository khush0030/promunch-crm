// Deal health, reliability and stage-group helpers for the influencer tracker.
// Pure (no I/O, explicit `now`) so the board, API and tests agree. The edge
// side duplicates only the subset it needs in _shared/influencers.ts.
//
// Health rules (build spec "Stages"), first match wins in this order:
//   overdue       draft not submitted and now > draft_due_at;
//                 approved, not posted and now > go_live_at + post overdue days (2)
//   at_risk       draft due within 2 days and not submitted;
//                 brief unacknowledged > 72h; delivery unconfirmed > 8d after dispatch
//   waiting_on_us brief_draft > 24h; agreed/acknowledged without dispatch > 48h;
//                 draft_submitted > 24h unreviewed
//   on_track      otherwise
//   closed        completed / cancelled / ghosted
import {
  STAGE_GROUP,
  type BoardSummary,
  type Deal,
  type DealHealth,
  type DealStage,
  type InfluencerSettings,
  type Reliability,
  type StageGroup,
} from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---- Stages -----------------------------------------------------------------

export const STAGE_ORDER: DealStage[] = [
  "agreed",
  "brief_draft",
  "brief_sent",
  "brief_acknowledged",
  "dispatched",
  "delivered",
  "draft_submitted",
  "changes_requested",
  "draft_approved",
  "posted",
  "completed",
  "cancelled",
  "ghosted",
];

export const CLOSED_STAGES: DealStage[] = ["completed", "cancelled", "ghosted"];
export const OPEN_STAGES: DealStage[] = STAGE_ORDER.filter((s) => !CLOSED_STAGES.includes(s));

export const STAGE_GROUP_ORDER: StageGroup[] = ["briefing", "shipping", "creating", "review", "live", "done"];

export const STAGE_LABEL: Record<DealStage, string> = {
  agreed: "Agreed",
  brief_draft: "Brief draft",
  brief_sent: "Brief sent",
  brief_acknowledged: "Brief acknowledged",
  dispatched: "Dispatched",
  delivered: "Delivered",
  draft_submitted: "Draft submitted",
  changes_requested: "Changes requested",
  draft_approved: "Draft approved",
  posted: "Posted",
  completed: "Completed",
  cancelled: "Cancelled",
  ghosted: "Ghosted",
};

export const STAGE_GROUP_LABEL: Record<StageGroup, string> = {
  briefing: "Briefing",
  shipping: "Shipping",
  creating: "Creating",
  review: "Review",
  live: "Live",
  done: "Done",
};

export function isDealStage(v: unknown): v is DealStage {
  return typeof v === "string" && (STAGE_ORDER as string[]).includes(v);
}
export function isStageGroup(v: unknown): v is StageGroup {
  return typeof v === "string" && (STAGE_GROUP_ORDER as string[]).includes(v);
}
export function stageGroup(stage: DealStage): StageGroup {
  return STAGE_GROUP[stage];
}
export function stagesInGroup(group: StageGroup): DealStage[] {
  return STAGE_ORDER.filter((s) => STAGE_GROUP[s] === group);
}
export function isOpenStage(stage: DealStage): boolean {
  return !CLOSED_STAGES.includes(stage);
}

// ---- Health -----------------------------------------------------------------

/** Thresholds health needs; a subset of InfluencerSettings. */
export interface HealthSettings {
  nudges?: Record<string, unknown> | null;
  team_sla?: Partial<InfluencerSettings["team_sla"]> | null;
}

export interface HealthResult {
  health: DealHealth;
  reason: string | null;
  next_date: { label: string; at: string } | null;
}

export type HealthDeal = Pick<
  Deal,
  | "stage"
  | "agreed_at"
  | "brief_sent_at"
  | "brief_acknowledged_at"
  | "dispatched_at"
  | "delivered_at"
  | "draft_due_at"
  | "draft_submitted_at"
  | "go_live_at"
> & { updated_at?: string | null };

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function nudge(settings: HealthSettings | undefined, gate: string, key: string, fallback: number): number {
  const g = (settings?.nudges ?? {})[gate];
  return num(g && typeof g === "object" ? (g as Record<string, unknown>)[key] : undefined, fallback);
}

export function healthThresholds(settings?: HealthSettings) {
  return {
    briefAckEscalateHours: nudge(settings, "brief_ack", "escalate_after_hours", 72),
    deliveryEscalateDays: nudge(settings, "delivery_check", "escalate_after_days", 8),
    postOverdueDays: nudge(settings, "post_due", "overdue_after_days", 2),
    draftAtRiskDays: 2,
    briefApprovalHours: num(settings?.team_sla?.brief_approval_hours, 24),
    dispatchHours: num(settings?.team_sla?.dispatch_hours, 48),
    draftReviewHours: num(settings?.team_sla?.draft_review_hours, 24),
  };
}

const ts = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};
const iso = (t: number) => new Date(t).toISOString();

/** "1 day" / "3 days" / "5 hours"; rounds down, minimum 1 unit. */
export function spanText(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < DAY) {
    const h = Math.max(1, Math.floor(abs / HOUR));
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.floor(abs / DAY);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/** Calendar day in IST (YYYY-MM-DD) for a timestamp. */
export function istDay(t: number | Date): string {
  const d = typeof t === "number" ? new Date(t) : t;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function dueText(label: string, due: number, now: number): string {
  if (now > due) return `${label} overdue by ${spanText(now - due)}`;
  if (istDay(due) === istDay(now)) return `${label} due today`;
  return `${label} due in ${spanText(due - now)}`;
}

export function computeHealth(deal: HealthDeal, now: Date | number, settings?: HealthSettings): HealthResult {
  const t = typeof now === "number" ? now : now.getTime();
  const th = healthThresholds(settings);
  const stage = deal.stage;

  if (CLOSED_STAGES.includes(stage)) return { health: "closed", reason: null, next_date: null };

  const agreed = ts(deal.agreed_at) ?? t;

  switch (stage) {
    case "agreed": {
      const shipBy = agreed + th.dispatchHours * HOUR;
      const next = { label: "Ship kit by", at: iso(shipBy) };
      if (ts(deal.dispatched_at) == null && t > shipBy) {
        return { health: "waiting_on_us", reason: `Kit not shipped ${spanText(t - agreed)} after agreeing`, next_date: next };
      }
      return { health: "on_track", reason: null, next_date: next };
    }
    case "brief_draft": {
      // No per-stage timestamp exists; the deal's agreed_at is the anchor.
      const by = agreed + th.briefApprovalHours * HOUR;
      const next = { label: "Approve brief by", at: iso(by) };
      if (t > by) return { health: "waiting_on_us", reason: "Brief waiting for approval", next_date: next };
      return { health: "on_track", reason: null, next_date: next };
    }
    case "brief_sent": {
      const sent = ts(deal.brief_sent_at) ?? agreed;
      const by = sent + th.briefAckEscalateHours * HOUR;
      const next = { label: "Brief ack due", at: iso(by) };
      if (t > by) {
        return { health: "at_risk", reason: `Brief not acknowledged for ${spanText(t - sent)}`, next_date: next };
      }
      return { health: "on_track", reason: null, next_date: next };
    }
    case "brief_acknowledged": {
      const anchor = ts(deal.brief_acknowledged_at) ?? agreed;
      const shipBy = anchor + th.dispatchHours * HOUR;
      const next = { label: "Ship kit by", at: iso(shipBy) };
      if (ts(deal.dispatched_at) == null && t > shipBy) {
        return { health: "waiting_on_us", reason: `Kit not shipped ${spanText(t - anchor)} after brief ack`, next_date: next };
      }
      return { health: "on_track", reason: null, next_date: next };
    }
    case "dispatched": {
      const sent = ts(deal.dispatched_at) ?? agreed;
      const by = sent + th.deliveryEscalateDays * DAY;
      const next = { label: "Delivery confirm by", at: iso(by) };
      if (t > by) {
        return { health: "at_risk", reason: `Delivery not confirmed ${spanText(t - sent)} after dispatch`, next_date: next };
      }
      return { health: "on_track", reason: null, next_date: next };
    }
    case "delivered":
    case "changes_requested": {
      const due = ts(deal.draft_due_at);
      if (due == null) return { health: "on_track", reason: null, next_date: null };
      const next = { label: "Draft due", at: iso(due) };
      if (t > due) return { health: "overdue", reason: dueText("Draft", due, t), next_date: next };
      if (due - t <= th.draftAtRiskDays * DAY) return { health: "at_risk", reason: dueText("Draft", due, t), next_date: next };
      return { health: "on_track", reason: null, next_date: next };
    }
    case "draft_submitted": {
      const sub = ts(deal.draft_submitted_at) ?? t;
      const by = sub + th.draftReviewHours * HOUR;
      const next = { label: "Review draft by", at: iso(by) };
      if (t > by) return { health: "waiting_on_us", reason: `Draft waiting for review for ${spanText(t - sub)}`, next_date: next };
      return { health: "on_track", reason: null, next_date: next };
    }
    case "draft_approved": {
      const live = ts(deal.go_live_at);
      if (live == null) return { health: "on_track", reason: null, next_date: null };
      const next = { label: "Go live", at: iso(live) };
      const late = live + th.postOverdueDays * DAY;
      if (t > late) return { health: "overdue", reason: `Post overdue by ${spanText(t - live)}`, next_date: next };
      return { health: "on_track", reason: null, next_date: next };
    }
    case "posted":
    default:
      return { health: "on_track", reason: null, next_date: null };
  }
}

// ---- Reliability --------------------------------------------------------------

export type ReliabilityDeal = Pick<Deal, "stage" | "draft_due_at" | "draft_submitted_at" | "revision_count">;

/**
 * Creator track record across deals. on_time_pct counts drafts with a due date
 * that were submitted on/before it; a draft still missing past its due date
 * counts as late. avg_days_late averages only late drafts (still-missing ones
 * measured up to `now`).
 */
export function reliability(deals: ReliabilityDeal[], now: Date | number = Date.now()): Reliability {
  const t = typeof now === "number" ? now : now.getTime();
  let judged = 0;
  let onTime = 0;
  let lateDays = 0;
  let lateCount = 0;
  let revisions = 0;
  let withDraft = 0;
  for (const d of deals) {
    const due = ts(d.draft_due_at);
    const sub = ts(d.draft_submitted_at);
    if (sub != null) {
      withDraft++;
      revisions += d.revision_count ?? 0;
    }
    if (due == null) continue;
    if (sub != null) {
      judged++;
      if (sub <= due) onTime++;
      else {
        lateCount++;
        lateDays += (sub - due) / DAY;
      }
    } else if (t > due && d.stage !== "cancelled") {
      judged++;
      lateCount++;
      lateDays += (t - due) / DAY;
    }
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    deals_total: deals.length,
    deals_completed: deals.filter((d) => d.stage === "completed" || d.stage === "posted").length,
    on_time_pct: judged ? Math.round((onTime / judged) * 100) : null,
    avg_days_late: lateCount ? round1(lateDays / lateCount) : null,
    ghosted: deals.filter((d) => d.stage === "ghosted").length,
    avg_revisions: withDraft ? round1(revisions / withDraft) : null,
  };
}

// ---- Board summary ------------------------------------------------------------

export interface SummaryDeal extends HealthDeal {
  id: string;
  shopify_order_id: string | null;
}

/** Stages where the kit has not gone out yet. */
export const PRE_DISPATCH_STAGES: DealStage[] = ["agreed", "brief_draft", "brief_sent", "brief_acknowledged"];

export function boardSummary(
  deals: SummaryDeal[],
  extras: { briefDealIds: Iterable<string>; pendingDraftDealIds: Iterable<string> },
  now: Date | number,
  settings?: HealthSettings,
): BoardSummary {
  const t = typeof now === "number" ? now : now.getTime();
  const today = istDay(t);
  const open = deals.filter((d) => isOpenStage(d.stage));
  const openIds = new Set(open.map((d) => d.id));
  const s: BoardSummary = {
    due_today: 0,
    overdue: 0,
    at_risk: 0,
    waiting_on_us: 0,
    briefs_to_approve: new Set([...extras.briefDealIds].filter((id) => openIds.has(id))).size,
    drafts_to_review: new Set([...extras.pendingDraftDealIds].filter((id) => openIds.has(id))).size,
    kits_to_ship: 0,
  };
  for (const d of open) {
    const h = computeHealth(d, t, settings);
    if (h.health === "overdue") s.overdue++;
    else if (h.health === "at_risk") s.at_risk++;
    else if (h.health === "waiting_on_us") s.waiting_on_us++;
    // Due today = still ahead of us today (IST); anything past is already counted by health.
    if (h.next_date) {
      const due = Date.parse(h.next_date.at);
      if (due >= t && istDay(due) === today) s.due_today++;
    }
    if (PRE_DISPATCH_STAGES.includes(d.stage) && !d.shopify_order_id && !d.dispatched_at) s.kits_to_ship++;
  }
  return s;
}

// ---- Stage transitions ----------------------------------------------------------

export type TransitionDeal = Pick<
  Deal,
  | "brief_sent_at"
  | "brief_acknowledged_at"
  | "dispatched_at"
  | "delivered_at"
  | "draft_submitted_at"
  | "draft_approved_at"
  | "go_live_at"
  | "posted_at"
  | "completed_at"
  | "draft_due_days"
>;

/**
 * Columns to set when a deal moves to `to`. First-time timestamps are kept
 * (reliability measures the first draft against its due date). Delivery sets
 * draft_due_at = delivered_at + draft_due_days; approval defaults go_live_at.
 * Pass `deal` already merged with any draft_due_days edit in the same request.
 */
export function stagePatch(
  deal: TransitionDeal,
  to: DealStage,
  now: Date | number,
  opts: { postAfterApprovalDays: number; deliveredAt?: string | null },
): Record<string, string | null> {
  const t = typeof now === "number" ? now : now.getTime();
  const nowIso = iso(t);
  const p: Record<string, string | null> = {};
  switch (to) {
    case "brief_sent":
      p.brief_sent_at = deal.brief_sent_at ?? nowIso;
      break;
    case "brief_acknowledged":
      p.brief_acknowledged_at = deal.brief_acknowledged_at ?? nowIso;
      break;
    case "dispatched":
      p.dispatched_at = deal.dispatched_at ?? nowIso;
      break;
    case "delivered": {
      const delivered = opts.deliveredAt ?? deal.delivered_at ?? nowIso;
      p.delivered_at = delivered;
      p.draft_due_at = draftDueAt(delivered, deal.draft_due_days);
      break;
    }
    case "draft_submitted":
      p.draft_submitted_at = deal.draft_submitted_at ?? nowIso;
      break;
    case "draft_approved":
      p.draft_approved_at = nowIso;
      p.go_live_at = deal.go_live_at ?? iso(t + opts.postAfterApprovalDays * DAY);
      break;
    case "posted":
      p.posted_at = deal.posted_at ?? nowIso;
      break;
    case "completed":
      p.completed_at = deal.completed_at ?? nowIso;
      break;
  }
  return p;
}

export function draftDueAt(deliveredAt: string, draftDueDays: number): string {
  return iso(Date.parse(deliveredAt) + draftDueDays * DAY);
}
