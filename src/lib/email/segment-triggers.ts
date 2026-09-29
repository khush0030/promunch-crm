// Daily segment / date triggers for email flows.
//
// Flows with trigger_type 'segment_entry' (win-back, VIP, sunset) and
// 'date_based' have no event that enrols them: nothing in Shopify "happens"
// when a customer lapses. This evaluator runs once a day (pg_cron ->
// /api/cron/email-segment-tick, ~10:00 IST), works out who is in each
// segment today and enrols them through enrollEmailFlow(). It never sends;
// email-flow-tick sends, taking its email_sends claim first (AGENTS.md §4.1).
//
// Segments (flows.trigger_config):
//   segment: "winback"  last real order between days_since_last_order
//                       (default 60) and +window_days (default 30) days ago.
//                       dedup winback:<last order shopify_id>, so one lapse
//                       enrols once and a later lapse (after a new order)
//                       enrols again.
//   segment: "vip"      lifetime spend >= min_spend (default 2000) OR orders
//                       >= min_orders (default 3). dedup vip:<contact id>,
//                       once ever. Set exit_on_order:false on the VIP flow or
//                       the VIP's next order ends their reward sequence.
//   segment: "sunset"   >= min_sends (default 5) marketing emails in the last
//                       lookback_days (default 90) and no open/click in that
//                       window. dedup sunset:<yyyy-mm>:<contact id>, so at
//                       most monthly.
//   date_based + kind: "first_order_anniversary"
//                       first real order was on this calendar day (IST) in an
//                       earlier year (3-day catch-up if a run is missed).
//                       dedup anniversary:<year>:<contact id>.
//   segment: "browse_abandon" is enrolled by email-browse-tick, skipped here.
//   Anything else is skipped and reported.
//
// Every candidate must be in the base audience (email present, status active,
// consented, not suppressed), same rule as Email Studio campaigns
// (inBaseAudience). Orders count only when not cancelled, not voided/refunded
// and not a HYPD creator seed (is_creator or total <= ₹0.01). shopify_orders
// has no contact_id: orders join to contacts on lower(email), with a phone
// fallback (last 10 digits) because most orders are phone-only.
//
// Warm-up guard: at most trigger_config.max_per_run (default 300) NEW
// enrolments per flow per run. Idempotent: the (flow_id, dedup_key) unique
// index is the real guard, and existing keys are pre-fetched so re-runs skip
// them cheaply. Dry run returns the counts without writing anything.
//
// DB access is injected (SegmentDeps) so this file stays importable in tests.

import type { SupabaseClient } from "@supabase/supabase-js";
import { inBaseAudience, type AudienceContact } from "@/lib/email-studio/segments";

export const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;
const PAGE = 1000;

export const DEFAULTS = {
  maxPerRun: 300,
  winbackDays: 60,
  winbackWindowDays: 30,
  vipMinSpend: 2000,
  vipMinOrders: 3,
  sunsetMinSends: 5,
  sunsetLookbackDays: 90,
  anniversaryCatchupDays: 3,
} as const;

// ============================================================================
// Types
// ============================================================================

export type SegmentContact = {
  id: string;
  email: string | null;
  first_name: string | null;
  phone: string | null;
  status: string | null;
  accepts_marketing: boolean | null;
  email_consent: string | null;
};

export type OrderRow = {
  shopify_id: string | number;
  order_number: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  total_price: number | string | null;
  financial_status: string | null;
  cancelled_at: string | null;
  is_creator: boolean | null;
  shopify_created_at: string;
};

export type ContactOrderStats = {
  orders: number;
  spend: number;
  firstOrderAt: number;
  lastOrderAt: number;
  lastOrderId: string;
  lastOrderNumber: string | null;
};

export type FlowRow = {
  id: string;
  name?: string | null;
  trigger_type: string | null;
  trigger_config: Record<string, unknown> | null;
  steps?: unknown;
};

export type SegmentPlan =
  | { kind: "winback"; days: number; windowDays: number; maxPerRun: number }
  | { kind: "vip"; minSpend: number; minOrders: number; maxPerRun: number }
  | { kind: "sunset"; minSends: number; lookbackDays: number; maxPerRun: number }
  | { kind: "first_order_anniversary"; catchupDays: number; maxPerRun: number }
  | { kind: "external"; reason: string }
  | { kind: "unsupported"; reason: string };

export type Candidate = {
  contactId: string;
  email: string;
  firstName: string | null;
  dedupPrefix: string;
  entityRef: string;
  context: Record<string, unknown>;
  /** Sort key: lower goes first when the per-run cap bites. */
  priority: number;
};

// ============================================================================
// Pure rules
// ============================================================================

function num(v: unknown, dflt: number, min = 0): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= min ? n : dflt;
}

/** Read a flow's trigger_config into a plan (or a reason it is skipped). */
export function planForFlow(flow: FlowRow): SegmentPlan {
  const cfg = flow.trigger_config ?? {};
  const maxPerRun = Math.floor(num(cfg.max_per_run, DEFAULTS.maxPerRun, 0));
  if (flow.trigger_type === "date_based") {
    const kind = String(cfg.kind ?? "");
    if (kind === "first_order_anniversary") {
      return { kind, catchupDays: Math.floor(num(cfg.catchup_days, DEFAULTS.anniversaryCatchupDays, 0)), maxPerRun };
    }
    return { kind: "unsupported", reason: kind ? `date_based kind "${kind}" not supported` : "date_based flow has no trigger_config.kind (birthday data is not collected)" };
  }
  if (flow.trigger_type !== "segment_entry") return { kind: "unsupported", reason: `trigger_type ${flow.trigger_type}` };
  const seg = String(cfg.segment ?? "").trim().toLowerCase();
  switch (seg) {
    case "winback":
    case "win_back":
      return {
        kind: "winback",
        days: num(cfg.days_since_last_order, DEFAULTS.winbackDays, 1),
        windowDays: num(cfg.window_days, DEFAULTS.winbackWindowDays, 1),
        maxPerRun,
      };
    case "vip":
      return {
        kind: "vip",
        minSpend: num(cfg.min_spend, DEFAULTS.vipMinSpend, 0),
        minOrders: Math.floor(num(cfg.min_orders, DEFAULTS.vipMinOrders, 1)),
        maxPerRun,
      };
    case "sunset":
      return {
        kind: "sunset",
        minSends: Math.floor(num(cfg.min_sends, DEFAULTS.sunsetMinSends, 1)),
        lookbackDays: num(cfg.lookback_days, DEFAULTS.sunsetLookbackDays, 1),
        maxPerRun,
      };
    case "browse_abandon":
      return { kind: "external", reason: "enrolled by email-browse-tick" };
    case "":
      return { kind: "unsupported", reason: "segment_entry flow has no trigger_config.segment" };
    default:
      return { kind: "unsupported", reason: `unknown segment "${seg}"` };
  }
}

/** A real, revenue-bearing order (not cancelled/voided/refunded/creator seed). */
export function isRealOrder(o: OrderRow): boolean {
  if (o.cancelled_at) return false;
  const fin = String(o.financial_status ?? "").toLowerCase();
  if (fin === "voided" || fin === "refunded") return false;
  if (o.is_creator) return false;
  const total = Number(o.total_price ?? 0);
  if (!Number.isFinite(total) || total <= 0.01) return false; // ₹0.01 = HYPD creator seed
  return Number.isFinite(Date.parse(o.shopify_created_at));
}

/** Last 10 digits: matches +91 98..., 9198..., 98... to one key. */
export function phoneKey(p: string | null | undefined): string | null {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

/**
 * Per-contact order stats. An order belongs to the contact whose email equals
 * customer_email (case-insensitive), else whose phone matches customer_phone.
 */
export function buildOrderStats(orders: OrderRow[], contacts: SegmentContact[]): Map<string, ContactOrderStats> {
  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const c of contacts) {
    if (c.email) byEmail.set(c.email.trim().toLowerCase(), c.id);
    const k = phoneKey(c.phone);
    if (k && !byPhone.has(k)) byPhone.set(k, c.id);
  }
  const stats = new Map<string, ContactOrderStats>();
  for (const o of orders) {
    if (!isRealOrder(o)) continue;
    const email = o.customer_email?.trim().toLowerCase();
    const cid = (email && byEmail.get(email)) || byPhone.get(phoneKey(o.customer_phone) ?? "");
    if (!cid) continue;
    const at = Date.parse(o.shopify_created_at);
    const total = Number(o.total_price ?? 0);
    const s = stats.get(cid);
    if (!s) {
      stats.set(cid, { orders: 1, spend: total, firstOrderAt: at, lastOrderAt: at, lastOrderId: String(o.shopify_id), lastOrderNumber: o.order_number });
      continue;
    }
    s.orders++;
    s.spend += total;
    if (at < s.firstOrderAt) s.firstOrderAt = at;
    if (at > s.lastOrderAt) {
      s.lastOrderAt = at;
      s.lastOrderId = String(o.shopify_id);
      s.lastOrderNumber = o.order_number;
    }
  }
  return stats;
}

/** Base audience: email, active, consented, not suppressed (Email Studio rule). */
export function eligibleContacts(contacts: SegmentContact[], suppressed: Set<string>): SegmentContact[] {
  return contacts.filter((c) => inBaseAudience(c as unknown as AudienceContact, suppressed));
}

function base(c: SegmentContact) {
  return { contactId: c.id, email: c.email!.trim().toLowerCase(), firstName: c.first_name ?? null };
}

export function selectWinback(
  contacts: SegmentContact[],
  stats: Map<string, ContactOrderStats>,
  plan: { days: number; windowDays: number },
  now: number,
): Candidate[] {
  const out: Candidate[] = [];
  for (const c of contacts) {
    const s = stats.get(c.id);
    if (!s) continue;
    const days = (now - s.lastOrderAt) / DAY_MS;
    if (days < plan.days || days > plan.days + plan.windowDays) continue;
    out.push({
      ...base(c),
      dedupPrefix: "winback",
      entityRef: s.lastOrderId,
      context: { segment: "winback", last_order_ref: s.lastOrderNumber, days_since_last_order: Math.floor(days), total_orders: s.orders },
      // Oldest lapse first: it leaves the window soonest.
      priority: -days,
    });
  }
  return out;
}

export function selectVip(
  contacts: SegmentContact[],
  stats: Map<string, ContactOrderStats>,
  plan: { minSpend: number; minOrders: number },
): Candidate[] {
  const out: Candidate[] = [];
  for (const c of contacts) {
    const s = stats.get(c.id);
    if (!s) continue;
    if (!(s.spend >= plan.minSpend || s.orders >= plan.minOrders)) continue;
    out.push({
      ...base(c),
      dedupPrefix: "vip",
      entityRef: c.id,
      context: { segment: "vip", lifetime_spend: Math.round(s.spend), total_orders: s.orders },
      priority: -s.spend, // biggest spenders first
    });
  }
  return out;
}

/** yyyy-mm in IST. */
export function istMonth(now: number): string {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 7);
}

export function selectSunset(
  contacts: SegmentContact[],
  sendCounts: Map<string, number>,
  engaged: Set<string>,
  plan: { minSends: number },
  now: number,
): Candidate[] {
  const month = istMonth(now);
  const out: Candidate[] = [];
  for (const c of contacts) {
    const sends = sendCounts.get(c.id) ?? 0;
    if (sends < plan.minSends || engaged.has(c.id)) continue;
    out.push({
      ...base(c),
      dedupPrefix: "sunset",
      entityRef: `${month}:${c.id}`,
      context: { segment: "sunset", sends_in_window: sends },
      priority: -sends,
    });
  }
  return out;
}

/** IST calendar parts of a timestamp. */
function istParts(t: number): { y: number; m: number; d: number } {
  const x = new Date(t + IST_OFFSET_MS);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate() };
}

/**
 * Anniversary of `first` falling on any IST day in (now - catchupDays, now].
 * Feb 29 first orders celebrate on Feb 28 in non-leap years. Returns the
 * anniversary year (for the dedup key) or null.
 */
export function anniversaryYear(first: number, now: number, catchupDays: number): number | null {
  const f = istParts(first);
  for (let back = 0; back <= catchupDays; back++) {
    const day = istParts(now - back * DAY_MS);
    if (day.y <= f.y) continue;
    const leap = (day.y % 4 === 0 && day.y % 100 !== 0) || day.y % 400 === 0;
    const fm = f.m;
    const fd = f.m === 1 && f.d === 29 && !leap ? 28 : f.d;
    if (day.m === fm && day.d === fd) return day.y;
  }
  return null;
}

export function selectAnniversary(
  contacts: SegmentContact[],
  stats: Map<string, ContactOrderStats>,
  plan: { catchupDays: number },
  now: number,
): Candidate[] {
  const out: Candidate[] = [];
  for (const c of contacts) {
    const s = stats.get(c.id);
    if (!s) continue;
    const year = anniversaryYear(s.firstOrderAt, now, plan.catchupDays);
    if (year == null) continue;
    out.push({
      ...base(c),
      dedupPrefix: "anniversary",
      entityRef: `${year}:${c.id}`,
      context: { segment: "first_order_anniversary", years: year - istParts(s.firstOrderAt).y, total_orders: s.orders },
      priority: s.firstOrderAt,
    });
  }
  return out;
}

/**
 * Drop candidates already enrolled (dedup key exists in this flow) or with an
 * active enrolment in this flow, then apply the per-run cap by priority.
 */
export function pickForRun(
  candidates: Candidate[],
  existing: { keys: Set<string>; activeContacts: Set<string> },
  cap: number,
): { fresh: Candidate[]; alreadyEnrolled: number; picked: Candidate[] } {
  const fresh = candidates.filter(
    (c) => !existing.keys.has(`${c.dedupPrefix}:${c.entityRef}`) && !existing.activeContacts.has(c.contactId),
  );
  const picked = [...fresh].sort((a, b) => a.priority - b.priority || a.contactId.localeCompare(b.contactId)).slice(0, Math.max(0, cap));
  return { fresh, alreadyEnrolled: candidates.length - fresh.length, picked };
}

/**
 * Not wired anywhere yet (no auto-suppression in this change). Intended for a
 * sunset flow's final step: a contact who went through the whole sunset
 * sequence and still did not open or click anything since they entered
 * should be moved to the suppression list (reason 'sunset') so we stop
 * mailing a dead address, which protects sender reputation.
 */
export function shouldSuppressAfterSunset(input: {
  enrolmentStatus: string;
  enteredAt: string;
  lastEngagedAt: string | null;
}): boolean {
  if (input.enrolmentStatus !== "completed") return false;
  const entered = Date.parse(input.enteredAt);
  if (!Number.isFinite(entered)) return false;
  const engaged = input.lastEngagedAt ? Date.parse(input.lastEngagedAt) : NaN;
  return !(Number.isFinite(engaged) && engaged >= entered);
}

// ============================================================================
// DB orchestration (injected client)
// ============================================================================

export type EnrollFn = (
  trigger: string,
  opts: {
    email?: string | null;
    entityRef: string;
    dedupPrefix: string;
    firstName?: string | null;
    context?: Record<string, unknown>;
    flowId?: string | null;
  },
) => Promise<number>;

export type SegmentDeps = {
  db: SupabaseClient;
  enroll: EnrollFn;
  fetchSuppressed: () => Promise<Set<string>>;
  now?: number;
};

export type FlowRunSummary = {
  flow_id: string;
  name: string | null;
  trigger_type: string | null;
  segment: string;
  skipped?: string;
  candidates?: number;
  already_enrolled?: number;
  would_enrol?: number;
  capped?: number;
  enrolled?: number;
  failed?: number;
};

export type SegmentRunSummary = {
  dry: boolean;
  flows: FlowRunSummary[];
  enrolled: number;
  eligible_contacts: number;
};

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function loadContacts(db: SupabaseClient): Promise<SegmentContact[]> {
  return pageAll<SegmentContact>((a, b) =>
    db
      .from("contacts")
      .select("id, email, first_name, phone, status, accepts_marketing, email_consent")
      .not("email", "is", null)
      .order("id")
      .range(a, b),
  );
}

async function loadOrders(db: SupabaseClient): Promise<OrderRow[]> {
  return pageAll<OrderRow>((a, b) =>
    db
      .from("shopify_orders")
      .select("shopify_id, order_number, customer_email, customer_phone, total_price, financial_status, cancelled_at, is_creator, shopify_created_at")
      .is("cancelled_at", null)
      .order("id")
      .range(a, b),
  );
}

/** Marketing sends per contact + contacts who opened/clicked, since `sinceIso`. */
async function loadSendsAndEngagement(db: SupabaseClient, sinceIso: string): Promise<{ sends: Map<string, number>; engaged: Set<string> }> {
  const sends = new Map<string, number>();
  const engaged = new Set<string>();
  const bump = (id: string | null) => {
    if (id) sends.set(id, (sends.get(id) ?? 0) + 1);
  };
  const flowSends = await pageAll<{ contact_id: string | null; opened_at: string | null; clicked_at: string | null }>((a, b) =>
    db.from("email_sends").select("contact_id, opened_at, clicked_at").eq("status", "sent").gte("sent_at", sinceIso).order("id").range(a, b),
  );
  for (const r of flowSends) bump(r.contact_id);
  const campSends = await pageAll<{ contact_id: string | null; status: string | null }>((a, b) =>
    db
      .from("campaign_emails")
      .select("contact_id, status")
      .gte("sent_at", sinceIso)
      .in("status", ["sent", "delivered", "opened", "clicked"])
      .order("id")
      .range(a, b),
  );
  for (const r of campSends) bump(r.contact_id);

  // Engagement: any open/click in the window, from any source.
  const since = `"${sinceIso}"`;
  const flowEng = await pageAll<{ contact_id: string | null }>((a, b) =>
    db.from("email_sends").select("contact_id").or(`opened_at.gte.${since},clicked_at.gte.${since}`).order("id").range(a, b),
  );
  const campEng = await pageAll<{ contact_id: string | null }>((a, b) =>
    db.from("campaign_emails").select("contact_id").or(`opened_at.gte.${since},clicked_at.gte.${since}`).order("id").range(a, b),
  );
  const evEng = await pageAll<{ contact_id: string | null }>((a, b) =>
    db.from("email_events").select("contact_id").in("event_type", ["opened", "clicked"]).gte("created_at", sinceIso).order("id").range(a, b),
  );
  for (const r of [...flowEng, ...campEng, ...evEng]) if (r.contact_id) engaged.add(r.contact_id);
  return { sends, engaged };
}

async function loadExisting(db: SupabaseClient, flowId: string): Promise<{ keys: Set<string>; activeContacts: Set<string> }> {
  const rows = await pageAll<{ dedup_key: string | null; contact_id: string | null; status: string | null }>((a, b) =>
    db.from("flow_enrollments").select("dedup_key, contact_id, status").eq("flow_id", flowId).order("id").range(a, b),
  );
  const keys = new Set<string>();
  const activeContacts = new Set<string>();
  for (const r of rows) {
    if (r.dedup_key) keys.add(r.dedup_key);
    if (r.status === "active" && r.contact_id) activeContacts.add(r.contact_id);
  }
  return { keys, activeContacts };
}

export async function runSegmentTriggers(deps: SegmentDeps, opts: { dry: boolean }): Promise<SegmentRunSummary> {
  const { db } = deps;
  const now = deps.now ?? Date.now();

  const { data: flowData, error: flowErr } = await db
    .from("flows")
    .select("id, name, trigger_type, trigger_config, steps")
    .in("trigger_type", ["segment_entry", "date_based"])
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (flowErr) throw new Error(`flows lookup: ${flowErr.message}`);
  const flows = (flowData ?? []) as FlowRow[];

  const summary: SegmentRunSummary = { dry: opts.dry, flows: [], enrolled: 0, eligible_contacts: 0 };
  const plans = flows.map((f) => ({ flow: f, plan: planForFlow(f) }));
  const runnable = plans.filter((p) => p.plan.kind !== "external" && p.plan.kind !== "unsupported");

  for (const { flow, plan } of plans) {
    if (plan.kind === "external" || plan.kind === "unsupported") {
      if (plan.kind === "unsupported") console.warn("[email-segment-tick] skip flow", flow.id, plan.reason);
      summary.flows.push({
        flow_id: flow.id,
        name: flow.name ?? null,
        trigger_type: flow.trigger_type,
        segment: String((flow.trigger_config ?? {}).segment ?? (flow.trigger_config ?? {}).kind ?? ""),
        skipped: plan.reason,
      });
    }
  }
  if (runnable.length === 0) return summary;

  // Shared lookups, loaded once per run and only when a plan needs them.
  const [contacts, suppressed] = await Promise.all([loadContacts(db), deps.fetchSuppressed()]);
  const eligible = eligibleContacts(contacts, suppressed);
  summary.eligible_contacts = eligible.length;

  const needsOrders = runnable.some((p) => p.plan.kind !== "sunset");
  // Stats use ALL contacts (so a phone match resolves to the right person),
  // then selection runs over the eligible subset only.
  const stats = needsOrders ? buildOrderStats(await loadOrders(db), contacts) : new Map<string, ContactOrderStats>();

  const sunsetWindows = new Map<number, { sends: Map<string, number>; engaged: Set<string> }>();

  for (const { flow, plan } of runnable) {
    const row: FlowRunSummary = { flow_id: flow.id, name: flow.name ?? null, trigger_type: flow.trigger_type, segment: plan.kind };
    summary.flows.push(row);
    try {
      let candidates: Candidate[] = [];
      let cap = 0;
      switch (plan.kind) {
        case "winback":
          candidates = selectWinback(eligible, stats, plan, now);
          cap = plan.maxPerRun;
          break;
        case "vip":
          candidates = selectVip(eligible, stats, plan);
          cap = plan.maxPerRun;
          break;
        case "sunset": {
          let w = sunsetWindows.get(plan.lookbackDays);
          if (!w) {
            w = await loadSendsAndEngagement(db, new Date(now - plan.lookbackDays * DAY_MS).toISOString());
            sunsetWindows.set(plan.lookbackDays, w);
          }
          candidates = selectSunset(eligible, w.sends, w.engaged, plan, now);
          cap = plan.maxPerRun;
          break;
        }
        case "first_order_anniversary":
          candidates = selectAnniversary(eligible, stats, plan, now);
          cap = plan.maxPerRun;
          break;
      }
      const existing = await loadExisting(db, flow.id);
      const { fresh, alreadyEnrolled, picked } = pickForRun(candidates, existing, cap);
      row.candidates = candidates.length;
      row.already_enrolled = alreadyEnrolled;
      row.would_enrol = picked.length;
      row.capped = fresh.length - picked.length;
      if (opts.dry) continue;

      let enrolled = 0;
      let failed = 0;
      for (const c of picked) {
        try {
          enrolled += await deps.enroll(flow.trigger_type ?? "segment_entry", {
            email: c.email,
            entityRef: c.entityRef,
            dedupPrefix: c.dedupPrefix,
            firstName: c.firstName,
            context: c.context,
            flowId: flow.id,
          });
        } catch (e) {
          failed++;
          console.warn("[email-segment-tick] enrol failed", flow.id, c.contactId, e instanceof Error ? e.message : e);
        }
      }
      row.enrolled = enrolled;
      row.failed = failed;
      summary.enrolled += enrolled;
    } catch (e) {
      row.skipped = `error: ${e instanceof Error ? e.message : String(e)}`;
      console.error("[email-segment-tick] flow failed", flow.id, row.skipped);
    }
  }
  return summary;
}
