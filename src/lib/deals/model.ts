// Deal model shared by the API routes and the Deals screens. Pure: no I/O.
//
// Rows are normalized on read (normalizeDeal) so old stage names and
// missing columns (before migration 20261010100000_deals_simplify.sql is
// applied) never reach the UI.

import type { TagTone } from "@/components/pm/Tag";
import { normalizeStage, type DealStage } from "./stages";

export type { DealStage } from "./stages";

// ---- type (DB column "kind") ----------------------------------------------

export type DealKind =
  | "hotel_hospitality"
  | "corporate_pantry_gifting"
  | "retail_qcommerce"
  | "distribution_wholesale"
  | "influencer_collab"
  | "brand_partnership"
  | "events_expo"
  | "vendor_pitch"
  | "other";

export const KIND_LABEL: Record<DealKind, string> = {
  hotel_hospitality: "Cafes and restaurants",
  corporate_pantry_gifting: "Corporate and gifting",
  retail_qcommerce: "Shops and quick commerce",
  distribution_wholesale: "Wholesale",
  influencer_collab: "Creator",
  brand_partnership: "Partnership",
  events_expo: "Event or expo",
  vendor_pitch: "Selling to us",
  other: "Other",
};

export const KIND_TONE: Record<DealKind, TagTone> = {
  hotel_hospitality: "brand",
  corporate_pantry_gifting: "blue",
  retail_qcommerce: "amber",
  distribution_wholesale: "purple",
  influencer_collab: "pink",
  brand_partnership: "teal",
  events_expo: "grey",
  vendor_pitch: "grey",
  other: "grey",
};

export const ALL_KINDS = Object.keys(KIND_LABEL) as DealKind[];

const KIND_ALIAS: Record<string, DealKind> = {
  wholesale: "distribution_wholesale",
  distribution: "distribution_wholesale",
  distributor: "distribution_wholesale",
  partnership: "brand_partnership",
  collab: "brand_partnership",
  horeca: "hotel_hospitality",
  hotel: "hotel_hospitality",
  cafe: "hotel_hospitality",
  restaurant: "hotel_hospitality",
  corporate: "corporate_pantry_gifting",
  gifting: "corporate_pantry_gifting",
  pantry: "corporate_pantry_gifting",
  retail: "retail_qcommerce",
  qcommerce: "retail_qcommerce",
  influencer: "influencer_collab",
  creator: "influencer_collab",
  event: "events_expo",
  events: "events_expo",
  expo: "events_expo",
  vendor: "vendor_pitch",
};

/** A kind or a friendly alias ("wholesale", "partnership") to a DealKind. */
export function parseKind(v: unknown): DealKind | null {
  if (typeof v !== "string") return null;
  const k = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((ALL_KINDS as string[]).includes(k)) return k as DealKind;
  return KIND_ALIAS[k] ?? null;
}

// ---- source -----------------------------------------------------------------

export type DealSource = "email_scan" | "whatsapp" | "b2b_reply" | "bulk_form" | "manual";

export const ALL_SOURCES: DealSource[] = ["email_scan", "whatsapp", "b2b_reply", "bulk_form", "manual"];

export const SOURCE_LABEL: Record<DealSource, string> = {
  email_scan: "Email",
  whatsapp: "WhatsApp",
  b2b_reply: "B2B reply",
  bulk_form: "Bulk form",
  manual: "Added by hand",
};

export const SOURCE_TONE: Record<DealSource, TagTone> = {
  email_scan: "blue",
  whatsapp: "green",
  b2b_reply: "purple",
  bulk_form: "brand",
  manual: "grey",
};

export function parseSource(v: unknown): DealSource | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if ((ALL_SOURCES as string[]).includes(s)) return s as DealSource;
  if (s === "wa") return "whatsapp";
  if (s === "email" || s === "scan") return "email_scan";
  if (s === "b2b" || s === "lead") return "b2b_reply";
  if (s === "bulk") return "bulk_form";
  return null;
}

// ---- the deal ---------------------------------------------------------------

export type Direction = "inbound" | "outbound";
export type Temperature = "hot" | "warm" | "cool";

export type DealInsights = {
  willingness: number;
  temperature: Temperature;
  sentiment: string | null;
  emotions: string[];
  drivers: string[];
  risks: string[];
  recommended_move: string | null;
};

export type Deal = {
  id: string;
  company_name: string;
  company_domain: string | null;
  kind: DealKind;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  stage: DealStage;
  stage_updated_at: string;
  closed_reason: string | null;
  samples_sent_at: string | null;
  next_step: string | null;
  next_step_owner: "us" | "them" | null;
  /** True when a follow-up is due today or overdue, or the scanner flagged one. */
  follow_up_needed: boolean;
  follow_up_reason: string | null;
  follow_up_at: string | null; // YYYY-MM-DD
  owner_email: string | null;
  value_inr: number | null;
  source: DealSource;
  source_ref: string | null;
  commercials: string | null;
  summary: string | null;
  notes: string | null;
  last_email_at: string | null;
  last_email_direction: Direction | null;
  first_email_at: string | null;
  email_count: number;
  ai_confidence: number | null;
  interest_temp: Temperature | null;
  insights: DealInsights | null;
  manual_stage_override: boolean;
  human_touched_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ActivityKind = "note" | "call" | "whatsapp" | "meeting" | "email" | "stage" | "system";
export const LOGGABLE_KINDS: ActivityKind[] = ["note", "call", "whatsapp", "meeting"];

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  note: "Note",
  call: "Call",
  whatsapp: "WhatsApp",
  meeting: "Meeting",
  email: "Email",
  stage: "Stage",
  system: "Update",
};

export type DealActivity = {
  id: string;
  deal_id: string;
  kind: ActivityKind;
  body: string;
  author: string | null;
  created_at: string;
};

export type DealEmail = {
  id: string;
  deal_id: string | null;
  gmail_message_id: string;
  gmail_thread_id: string;
  direction: Direction;
  from_email: string | null;
  to_email: string | null;
  subject: string | null;
  snippet: string | null;
  sent_at: string | null;
};

export type ScanState = {
  last_run_at: string | null;
  backfill_done: boolean;
  threads_scanned: number;
  last_error: string | null;
};

export type TeamPerson = { email: string; name: string };

export type DealsResponse = {
  deals: Deal[];
  scan: ScanState | null;
  /** false until the deals_simplify migration is applied (new fields read-only). */
  schema_ready: boolean;
};

export type DealDetailResponse = {
  deal: Deal;
  emails: DealEmail[];
  activity: DealActivity[];
  schema_ready: boolean;
};

// ---- small helpers -----------------------------------------------------------

/** Today's date in India (YYYY-MM-DD). */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Phone to digits with country code (10-digit Indian numbers get 91). */
export function normalizePhone(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = String(v).replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  if (d.length < 10 || d.length > 15) return null;
  return d;
}

/** "919876543210" -> "+91 98765 43210". */
export function formatPhone(p: string | null): string {
  if (!p) return "";
  if (p.length === 12 && p.startsWith("91")) return `+91 ${p.slice(2, 7)} ${p.slice(7)}`;
  return `+${p}`;
}

/** "₹50,000", "50000", "1.5L", "2 lakh", "40k" -> number of rupees. */
export function parseRupees(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/[₹,\s]|rs\.?|inr/g, "");
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)(k|l|lakh|lakhs|lac|cr|crore|crores)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = !m[2] ? 1 : m[2] === "k" ? 1e3 : m[2].startsWith("c") ? 1e7 : 1e5;
  const out = Math.round(n * mult * 100) / 100;
  return Number.isFinite(out) ? out : null;
}

/** ₹ in Indian style, compact for big numbers: ₹8,500 · ₹1.2L · ₹2.5Cr. */
export function formatRupees(n: number | null | undefined, compact = true): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (compact && n >= 1e7) return `₹${trim(n / 1e7)}Cr`;
  if (compact && n >= 1e5) return `₹${trim(n / 1e5)}L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
function trim(x: number): string {
  return (Math.round(x * 10) / 10).toString();
}

export type FollowUpState =
  | { state: "overdue"; label: string }
  | { state: "today"; label: string }
  | { state: "later"; label: string }
  | { state: "none"; label: "" };

/** Follow-up chip for a deal: date-driven first, then the scanner's flag. */
export function followUpState(
  d: Pick<Deal, "follow_up_at" | "stage"> & { follow_up_flag?: boolean },
  today: string,
): FollowUpState {
  // Won and Lost need nothing. On hold only surfaces once its date comes round.
  if (d.stage === "won" || d.stage === "lost") return { state: "none", label: "" };
  if (d.stage === "on_hold") {
    return d.follow_up_at && d.follow_up_at <= today
      ? { state: "today", label: "Check back today" }
      : { state: "none", label: "" };
  }
  if (d.follow_up_at) {
    if (d.follow_up_at < today) return { state: "overdue", label: "Overdue" };
    if (d.follow_up_at === today) return { state: "today", label: "Follow up today" };
    return { state: "later", label: `Follow up ${shortDay(d.follow_up_at)}` };
  }
  if (d.follow_up_flag) return { state: "today", label: "Follow up today" };
  return { state: "none", label: "" };
}

/** "2026-10-14" -> "14 Oct". */
export function shortDay(ymd: string): string {
  const [y, m, day] = ymd.split("-").map(Number);
  if (!y || !m || !day) return ymd;
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * DB row (any schema version) to a Deal. follow_up_needed becomes "due now":
 * the scanner's flag OR a follow-up date that is today or past.
 */
export function normalizeDeal(raw: Record<string, unknown>, today: string): Deal {
  const stage = normalizeStage(raw.stage) ?? "new";
  const followUpAt = str(raw.follow_up_at)?.slice(0, 10) ?? null;
  const flag = raw.follow_up_needed === true;
  const kind = (parseKind(raw.kind) ?? "other") as DealKind;
  const source = parseSource(raw.source) ?? (raw.first_email_at ? "email_scan" : "manual");
  const owner = raw.next_step_owner === "us" || raw.next_step_owner === "them" ? raw.next_step_owner : null;
  const dir = raw.last_email_direction === "inbound" || raw.last_email_direction === "outbound" ? raw.last_email_direction : null;
  const temp = raw.interest_temp === "hot" || raw.interest_temp === "warm" || raw.interest_temp === "cool" ? raw.interest_temp : null;
  const fu = followUpState({ follow_up_at: followUpAt, stage, follow_up_flag: flag }, today);
  return {
    id: String(raw.id),
    company_name: str(raw.company_name) ?? "Unnamed",
    company_domain: str(raw.company_domain),
    kind,
    contact_name: str(raw.contact_name),
    contact_email: str(raw.contact_email),
    contact_phone: str(raw.contact_phone),
    stage,
    stage_updated_at: str(raw.stage_updated_at) ?? str(raw.created_at) ?? new Date(0).toISOString(),
    closed_reason: str(raw.closed_reason),
    samples_sent_at: str(raw.samples_sent_at),
    next_step: str(raw.next_step),
    next_step_owner: owner,
    follow_up_needed: fu.state === "overdue" || fu.state === "today",
    follow_up_reason: str(raw.follow_up_reason),
    follow_up_at: followUpAt,
    owner_email: str(raw.owner_email),
    value_inr: num(raw.value_inr),
    source,
    source_ref: str(raw.source_ref),
    commercials: str(raw.commercials),
    summary: str(raw.summary),
    notes: str(raw.notes),
    last_email_at: str(raw.last_email_at),
    last_email_direction: dir,
    first_email_at: str(raw.first_email_at),
    email_count: num(raw.email_count) ?? 0,
    ai_confidence: num(raw.ai_confidence),
    interest_temp: temp,
    insights: (raw.insights as DealInsights | null) ?? null,
    manual_stage_override: raw.manual_stage_override === true,
    human_touched_at: str(raw.human_touched_at),
    created_at: str(raw.created_at) ?? new Date(0).toISOString(),
    updated_at: str(raw.updated_at) ?? new Date(0).toISOString(),
  };
}

/** "Priya Shah" / "priya@x.com" -> "PS" / "PR". */
export function initialsOf(name: string | null | undefined): string {
  if (!name) return "?";
  const base = name.includes("@") ? name.split("@")[0].replace(/[._-]+/g, " ") : name;
  const parts = base.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
