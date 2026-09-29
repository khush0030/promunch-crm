// WhatsApp campaign lifecycle + input validation for the dashboard API.
//
// The template/param rules come straight from the edge engine's pure module
// (same file wa-campaign-send uses), so the dashboard can never accept a
// campaign the engine would refuse, or vice versa.

import {
  mediaKindFromUrl,
  validateCampaignSetup,
  type TemplateSchema,
} from "../../promunch-email-agent/supabase/functions/_shared/campaign-engine";

export { mediaKindFromUrl, validateCampaignSetup };
export type { TemplateSchema };

export type CampaignStatus =
  | "draft" | "scheduled" | "sending" | "paused" | "completed" | "failed" | "cancelled";

export type CampaignAction = "pause" | "resume" | "cancel";

export interface CampaignRowLite {
  status: CampaignStatus | string;
  started_at?: string | null;
  scheduled_at?: string | null;
  repeat_rule?: string | null;
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
      if (c.repeat_rule || (!c.started_at && future)) {
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
export const RETARGET_STAGES = ["not_read", "not_delivered", "read_no_reply", "failed_cap"] as const;
export type RetargetStage = (typeof RETARGET_STAGES)[number];

export interface AudienceFilter {
  tags?: string[];
  tags_all?: string[];
  exclude_tags?: string[];
  retarget?: { campaign_id: string; stage: RetargetStage };
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
