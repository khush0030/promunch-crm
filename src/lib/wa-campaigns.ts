// WhatsApp campaign lifecycle + input validation for the dashboard API.
//
// The template/param rules come straight from the edge engine's pure module
// (same file wa-campaign-send uses), so the dashboard can never accept a
// campaign the engine would refuse, or vice versa.

import {
  FOLLOWUP_MAX_HOURS,
  FOLLOWUP_MIN_HOURS,
  FOLLOWUP_STAGES,
  mediaKindFromUrl,
  validateCampaignSetup,
  type FollowupStage,
  type TemplateSchema,
} from "../../promunch-email-agent/supabase/functions/_shared/campaign-engine";

export { FOLLOWUP_MAX_HOURS, FOLLOWUP_MIN_HOURS, FOLLOWUP_STAGES, mediaKindFromUrl, validateCampaignSetup };
export type { FollowupStage, TemplateSchema };

export type CampaignStatus =
  | "draft" | "scheduled" | "sending" | "paused" | "completed" | "failed" | "cancelled";

export type CampaignAction = "pause" | "resume" | "cancel";

export interface CampaignRowLite {
  status: CampaignStatus | string;
  started_at?: string | null;
  scheduled_at?: string | null;
  repeat_rule?: string | null;
  followup_of?: string | null;
}

export type Transition =
  | { ok: true; from: string[]; patch: Record<string, unknown>; kick: boolean }
  | { ok: false; status: number; error: string };

// State machine for the pause / resume / cancel buttons. `from` is used as a
// guarded UPDATE filter (status IN from) so two clicks can't race.
export function planTransition(action: CampaignAction, c: CampaignRowLite, nowMs = Date.now()): Transition {
  const nowIso = new Date(nowMs).toISOString();
  switch (action) {
    case "pause":
      if (c.status !== "sending" && c.status !== "scheduled") {
        return { ok: false, status: 409, error: `Only a sending or scheduled campaign can be paused (this one is ${c.status}).` };
      }
      return { ok: true, from: ["sending", "scheduled"], patch: { status: "paused", paused_at: nowIso }, kick: false };
    case "resume": {
      if (c.status !== "paused") {
        return { ok: false, status: 409, error: `Only a paused campaign can be resumed (this one is ${c.status}).` };
      }
      const future = c.scheduled_at && Date.parse(c.scheduled_at) > nowMs;
      // A recurring PARENT never sends itself (each occurrence spawns a child),
      // so it always resumes to 'scheduled' and the tick takes it from there.
      // A follow-up that never started goes back to armed ('scheduled'): the
      // worker starts it from its parent, when people are due.
      if (c.repeat_rule || (!c.started_at && future) || (c.followup_of && !c.started_at)) {
        return { ok: true, from: ["paused"], patch: { status: "scheduled", paused_at: null }, kick: false };
      }
      return {
        ok: true,
        from: ["paused"],
        patch: { status: "sending", paused_at: null, resume_at: null, started_at: c.started_at ?? nowIso },
        kick: true,
      };
    }
    case "cancel":
      if (c.status === "completed" || c.status === "cancelled") {
        return { ok: false, status: 409, error: `This campaign is already ${c.status}.` };
      }
      return {
        ok: true,
        from: ["draft", "scheduled", "sending", "paused", "failed"],
        patch: { status: "cancelled", cancelled_at: nowIso, resume_at: null },
        kick: false,
      };
  }
}

// Content (what is sent, to whom) may only change before anyone got it.
export const CONTENT_FIELDS = ["template_id", "template_vars", "audience_filter", "header_media_url"] as const;

export function contentEditable(status: string, reachedCount: number): boolean {
  if (status === "draft" || status === "scheduled") return true;
  if (status === "paused" || status === "failed") return reachedCount === 0;
  return false;
}

// ---------------------------------------------------------------------------
// audience_filter
// ---------------------------------------------------------------------------
export const RETARGET_STAGES = [
  "not_read", "not_delivered", "read_no_reply", "failed_cap",
  // migration 20260930120000 (follow-ups)
  "delivered", "read", "replied", "clicked", "not_clicked", "ordered", "not_ordered",
] as const;
export type RetargetStage = (typeof RETARGET_STAGES)[number];
// Stages / keys the SQL only understands after 20260930120000. Routes that
// save or preview them probe for the migration first (fail closed).
export const FOLLOWUP_ONLY_STAGES: readonly string[] = [
  "delivered", "read", "replied", "clicked", "not_clicked", "ordered", "not_ordered",
];

export interface AudienceFilter {
  tags?: string[];
  tags_all?: string[];
  exclude_tags?: string[];
  retarget?: { campaign_id: string; stage: RetargetStage; min_hours_since?: number };
  // "Warm" preset (migration 20260929130000): replied / read / bought recently,
  // minus recent promo + recent Meta holds. Resolved in SQL so preview == send.
  engagement?: "warm";
}

export const ENGAGEMENT_PRESETS = ["warm"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tagList(v: unknown, key: string): string[] | string {
  if (v == null) return [];
  if (!Array.isArray(v)) return `${key} must be a list of tags`;
  const out = v.map((t) => String(t).trim()).filter(Boolean);
  if (out.length > 50) return `${key}: at most 50 tags`;
  return Array.from(new Set(out));
}

// Validate + clean an incoming filter. Unknown keys are dropped (never silently
// widen an audience); a malformed known key is an error.
export function normalizeAudienceFilter(raw: unknown): { ok: true; filter: AudienceFilter } | { ok: false; error: string } {
  if (raw == null) return { ok: true, filter: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "audience_filter must be an object" };
  const r = raw as Record<string, unknown>;
  const filter: AudienceFilter = {};
  for (const key of ["tags", "tags_all", "exclude_tags"] as const) {
    const t = tagList(r[key], key);
    if (typeof t === "string") return { ok: false, error: t };
    if (t.length) filter[key] = t;
  }
  if (r.retarget != null) {
    const rt = r.retarget as Record<string, unknown>;
    const cid = String(rt?.campaign_id ?? "");
    const stage = String(rt?.stage ?? "") as RetargetStage;
    if (!UUID_RE.test(cid)) return { ok: false, error: "retarget.campaign_id must be a campaign id" };
    if (!RETARGET_STAGES.includes(stage)) {
      return { ok: false, error: `retarget.stage must be one of ${RETARGET_STAGES.join(", ")}` };
    }
    filter.retarget = { campaign_id: cid, stage };
    if (rt.min_hours_since != null && rt.min_hours_since !== "") {
      const h = Number(rt.min_hours_since);
      if (!Number.isInteger(h) || h < 0 || h > FOLLOWUP_MAX_HOURS) {
        return { ok: false, error: `retarget.min_hours_since must be a whole number of hours, 0 to ${FOLLOWUP_MAX_HOURS}` };
      }
      filter.retarget.min_hours_since = h;
    }
  }
  if (r.engagement != null && r.engagement !== "") {
    // An unknown preset is an error, never dropped: dropping it would widen
    // the audience to everyone.
    if (!(ENGAGEMENT_PRESETS as readonly unknown[]).includes(r.engagement)) {
      return { ok: false, error: `engagement must be one of ${ENGAGEMENT_PRESETS.join(", ")}` };
    }
    filter.engagement = "warm";
  }
  return { ok: true, filter };
}

// ---------------------------------------------------------------------------
// Input checks the API can do without the template (B10 + media override)
// ---------------------------------------------------------------------------
export function basicInputErrors(input: {
  template_vars?: Record<string, unknown> | null;
  header_media_url?: string | null;
}): string[] {
  const errors: string[] = [];
  const vars = input.template_vars ?? {};
  if (Object.prototype.hasOwnProperty.call(vars, "_ai_brief") || vars._ai_mode === true || vars._ai_mode === "1") {
    if (!String(vars._ai_brief ?? "").trim()) errors.push("AI personalisation is on but the brief is empty");
  }
  const url = input.header_media_url;
  if (url != null && url !== "") {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") errors.push("header_media_url must be an https:// link");
    } catch {
      errors.push("header_media_url must be a full https:// link");
    }
  }
  return errors;
}

// Full check against the template (the same rules the engine applies at start).
export function templateInputErrors(
  tpl: TemplateSchema | null,
  vars: Record<string, unknown>,
  headerMediaUrl: string | null | undefined,
): string[] {
  if (!tpl) return ["template not found"];
  return validateCampaignSetup(tpl, vars, headerMediaUrl ?? null);
}

// ETA in days for `eligible` recipients given the daily budget and today's use.
export function etaDays(eligible: number, limit: number | null, used24h: number, nonCampaign24h: number): number | null {
  if (eligible <= 0) return 0;
  if (limit == null || limit <= 0) return null;
  const perDay = Math.max(1, limit - nonCampaign24h);
  const today = Math.max(0, limit - used24h);
  if (eligible <= today) return 1;
  return 1 + Math.ceil((eligible - today) / perDay);
}

// True when a filter uses something only the follow-up migration understands
// (before it, the SQL would ignore min_hours_since and send early, or match
// nobody for the new stages).
export function needsFollowupSql(filter: AudienceFilter): boolean {
  const rt = filter.retarget;
  return !!rt && (rt.min_hours_since != null || FOLLOWUP_ONLY_STAGES.includes(rt.stage));
}

// ---------------------------------------------------------------------------
// Follow-ups (campaign journeys)
// ---------------------------------------------------------------------------
export const MAX_FOLLOWUP_DEPTH = 3; //      root = 0; a follow-up of a follow-up of a follow-up = 3
export const MAX_JOURNEY_FOLLOWUPS = 5; //   follow-ups per journey root
export const FOLLOWUP_LIFETIME_DAYS = 30; // engine hard stop, from the parent's start

export interface FollowupInput {
  followup_of: string;
  followup_after_hours: number;
  followup_stage: FollowupStage;
}

// All three or none. `none` = an ordinary campaign.
export function parseFollowupInput(
  raw: Record<string, unknown>,
): { ok: true; followup: FollowupInput | null } | { ok: false; error: string } {
  const has = (k: string) => raw[k] != null && raw[k] !== "";
  const n = ["followup_of", "followup_after_hours", "followup_stage"].filter(has).length;
  if (n === 0) return { ok: true, followup: null };
  if (n !== 3) return { ok: false, error: "A follow-up needs followup_of, followup_after_hours and followup_stage together." };
  const of = String(raw.followup_of);
  if (!UUID_RE.test(of)) return { ok: false, error: "followup_of must be a campaign id" };
  const hours = Number(raw.followup_after_hours);
  if (!Number.isInteger(hours) || hours < FOLLOWUP_MIN_HOURS || hours > FOLLOWUP_MAX_HOURS) {
    return { ok: false, error: `The follow-up delay must be a whole number of hours between ${FOLLOWUP_MIN_HOURS} and ${FOLLOWUP_MAX_HOURS} (30 days).` };
  }
  const stage = String(raw.followup_stage) as FollowupStage;
  if (!(FOLLOWUP_STAGES as readonly string[]).includes(stage)) {
    return { ok: false, error: `followup_stage must be one of ${FOLLOWUP_STAGES.join(", ")}` };
  }
  return { ok: true, followup: { followup_of: of.toLowerCase(), followup_after_hours: hours, followup_stage: stage } };
}

// The ONLY audience a follow-up ever has (the engine refuses anything else).
export function followupAudienceFilter(f: FollowupInput): AudienceFilter {
  return { retarget: { campaign_id: f.followup_of, stage: f.followup_stage, min_hours_since: f.followup_after_hours } };
}

// Draft while the parent is a draft; otherwise armed ('scheduled', no
// scheduled_at): the worker starts it from its parent.
export function followupInitialStatus(parentStatus: string): "draft" | "scheduled" {
  return parentStatus === "draft" ? "draft" : "scheduled";
}

// Why a parent can't take a (new) follow-up, or null.
export function followupParentError(
  parent: { status: string; repeat_rule?: string | null; started_at?: string | null } | null,
  nowMs = Date.now(),
): string | null {
  if (!parent) return "The campaign this follows no longer exists.";
  if (parent.status === "cancelled" || parent.status === "failed") {
    return `The campaign this follows is ${parent.status}, so a follow-up would never go out.`;
  }
  if (parent.repeat_rule) return "Follow-ups can't be added to a repeating campaign. Add them to a one-time campaign.";
  if (parent.started_at && nowMs - Date.parse(parent.started_at) >= FOLLOWUP_LIFETIME_DAYS * 86_400_000) {
    return `The campaign this follows started more than ${FOLLOWUP_LIFETIME_DAYS} days ago, too long ago for a follow-up.`;
  }
  return null;
}

// A follow-up's message / timing can change until it has reached anyone and
// while it is not finished.
export function followupEditable(status: string, reachedCount: number): boolean {
  return reachedCount === 0 && status !== "completed" && status !== "cancelled";
}

export const TERMINAL_STATUSES: readonly string[] = ["completed", "cancelled", "failed"];

export interface JourneyRow {
  id: string;
  followup_of?: string | null;
  created_at?: string | null;
  [k: string]: unknown;
}
export interface JourneyStep<T extends JourneyRow = JourneyRow> {
  row: T;
  depth: number;
  parent_id: string | null;
}

// Walk up from any member to the root (cycle / depth guarded).
export function journeyRootId(rows: Map<string, JourneyRow>, id: string): string {
  let cur = id;
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const r = rows.get(cur);
    const up = r?.followup_of ?? null;
    if (!up || seen.has(up) || !rows.has(up)) return cur;
    seen.add(cur);
    cur = up;
  }
  return cur;
}

// Parent-first (pre-order) list of the journey under rootId; siblings oldest first.
export function orderJourney<T extends JourneyRow>(rows: T[], rootId: string): JourneyStep<T>[] {
  const byParent = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.followup_of) continue;
    const list = byParent.get(r.followup_of) ?? [];
    list.push(r);
    byParent.set(r.followup_of, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.id.localeCompare(b.id));
  }
  const root = rows.find((r) => r.id === rootId);
  if (!root) return [];
  const out: JourneyStep<T>[] = [];
  const seen = new Set<string>();
  const walk = (r: T, depth: number, parentId: string | null) => {
    if (seen.has(r.id) || depth > 10) return;
    seen.add(r.id);
    out.push({ row: r, depth, parent_id: parentId });
    for (const child of byParent.get(r.id) ?? []) walk(child, depth + 1, r.id);
  };
  walk(root, 0, null);
  return out;
}

// Every follow-up stage implies the person already got an earlier step, so
// an IDENTICAL message later in the same journey would put the same thing on
// their phone twice. Refuse only that: same template AND same blanks AND the
// same picture. Reusing a template with a different picture or text is fine.
export interface JourneyMessage {
  template_id?: string | null;
  template_vars?: Record<string, unknown> | null;
  header_media_url?: string | null;
}

// Canonical JSON: keys sorted, strings trimmed, empty object == null.
export function normalizeVars(v: unknown): string {
  const canon = (x: unknown): unknown => {
    if (typeof x === "string") return x.trim();
    if (Array.isArray(x)) return x.map(canon);
    if (x && typeof x === "object") {
      return Object.fromEntries(
        Object.keys(x as Record<string, unknown>).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])]),
      );
    }
    return x ?? null;
  };
  const c = canon(v ?? {});
  return JSON.stringify(c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 0 ? {} : c);
}

// What the customer SEES: the tracked-link destination (_track_url) sits behind
// the same button text, so two steps that differ only there still put the
// same message on the phone twice.
const INVISIBLE_VARS = new Set(["_track_url"]);
function visibleVars(v: Record<string, unknown> | null | undefined): string {
  const src = v ?? {};
  return normalizeVars(Object.fromEntries(Object.entries(src).filter(([k]) => !INVISIBLE_VARS.has(k))));
}

// Effective header picture: the campaign override, else the template's own.
function effectiveMedia(override: string | null | undefined, templateDefault: string | null | undefined): string | null {
  return (override ?? "").trim() || (templateDefault ?? "").trim() || null;
}

export const JOURNEY_DUPLICATE_ERROR =
  "This follow-up is exactly the same as an earlier message in this journey. Change the picture or the text.";

export function journeyDuplicateError(
  candidate: JourneyMessage,
  others: JourneyMessage[],
  templateDefaultMedia?: string | null,
): string | null {
  if (!candidate.template_id) return null;
  const vars = visibleVars(candidate.template_vars);
  const media = effectiveMedia(candidate.header_media_url, templateDefaultMedia);
  const same = others.some((o) =>
    o.template_id === candidate.template_id &&
    visibleVars(o.template_vars) === vars &&
    // same template_id, so the same template default applies to both
    effectiveMedia(o.header_media_url, templateDefaultMedia) === media
  );
  return same ? JOURNEY_DUPLICATE_ERROR : null;
}
