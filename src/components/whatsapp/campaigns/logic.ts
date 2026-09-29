// Pure helpers for the WhatsApp campaigns UI (home list, wizard, detail page).
// No React, no fetch: everything here is unit-tested in logic.test.ts.
//
// Template/param rules come from the edge engine's own pure module (the same
// file wa-campaign-send and the dashboard API use), so the wizard can never
// accept a campaign the engine would refuse.

import {
  dynamicUrlButtons,
  inQuietHours,
  isShortLinkBase,
  istDayStartMs,
  nextAllowedAt,
  templateVarKeys,
  validateCampaignSetup,
  type TemplateSchema,
} from "../../../../promunch-email-agent/supabase/functions/_shared/campaign-engine";
import { templateKind } from "@/lib/whatsapp/templateKind";
import type { Campaign, CampaignAudienceFilter, CampaignStatus, RetargetStage, Template, TemplateButton } from "../types";
import { COLD_SHARE_DANGER, GST_RATE, HELD_BACK_RATE, MARKETING_RATE_INR } from "./rates";

export { inQuietHours, templateVarKeys };

export const SAMPLE_NAME = "Priya";
const DAY_MS = 24 * 3600_000;
const IST_OFFSET_MS = 5.5 * 3600_000;

/* ------------------------------------------------------------------------ */
/* Status                                                                     */
/* ------------------------------------------------------------------------ */

export type Tone = "good" | "warn" | "crit" | "info" | "neu" | "brand";

export const STATUS_META: Record<CampaignStatus, { label: string; tone: Tone; hint: string }> = {
  draft: { label: "Draft", tone: "neu", hint: "Not sent. Open it to finish and launch." },
  scheduled: { label: "Scheduled", tone: "info", hint: "Will start by itself at the scheduled time." },
  sending: { label: "Sending", tone: "brand", hint: "Going out in waves within today's budget." },
  paused: { label: "Paused", tone: "warn", hint: "Stopped by a teammate. Resume to continue." },
  completed: { label: "Completed", tone: "good", hint: "Everyone who could get it has been handled." },
  failed: { label: "Stopped", tone: "crit", hint: "Stopped because of a problem. Open it to see why." },
  cancelled: { label: "Cancelled", tone: "neu", hint: "Cancelled. Nobody else will get it." },
};

export function statusMeta(s: string) {
  return STATUS_META[s as CampaignStatus] ?? { label: s, tone: "neu" as Tone, hint: "" };
}

export type ListFilter = "all" | "draft" | "scheduled" | "sending" | "paused" | "completed";
export const LIST_FILTERS: { key: ListFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "sending", label: "Sending" },
  { key: "paused", label: "Paused" },
  { key: "completed", label: "Completed" },
];

export function matchesListFilter(status: string, f: ListFilter): boolean {
  if (f === "all") return true;
  if (f === "completed") return status === "completed" || status === "failed" || status === "cancelled";
  return status === f;
}

export function matchesSearch(c: Pick<Campaign, "name"> & { template?: { name?: string } | null }, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return c.name.toLowerCase().includes(needle) || (c.template?.name ?? "").toLowerCase().includes(needle);
}

// Which buttons a campaign row offers. The API still has the final say (it
// answers 409 with a plain reason); this only hides buttons that can't work.
export type CampaignAction = "open" | "edit" | "duplicate" | "pause" | "resume" | "cancel" | "delete";
export function allowedActions(c: Pick<Campaign, "status" | "sent_count" | "failed_count">): CampaignAction[] {
  const untouched = (c.sent_count ?? 0) === 0 && (c.failed_count ?? 0) === 0;
  const out: CampaignAction[] = ["open"];
  switch (c.status) {
    case "draft":
      out.push("edit", "duplicate", "delete");
      break;
    case "scheduled":
      out.push("edit", "pause", "cancel", "duplicate");
      if (untouched) out.push("delete");
      break;
    case "sending":
      out.push("pause", "cancel", "duplicate");
      break;
    case "paused":
      out.push("resume");
      if (untouched) out.push("edit");
      out.push("cancel", "duplicate");
      if (untouched) out.push("delete");
      break;
    case "failed":
      if (untouched) out.push("edit");
      out.push("duplicate", "cancel");
      if (untouched) out.push("delete");
      break;
    default: // completed, cancelled
      out.push("duplicate");
      if (untouched) out.push("delete");
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Progress + rates                                                           */
/* ------------------------------------------------------------------------ */

export function pct(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (!whole || whole <= 0 || part == null) return null;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export function progressOf(c: Pick<Campaign, "sent_count" | "total_audience">): { reached: number; total: number | null; percent: number | null } {
  const reached = c.sent_count ?? 0;
  const total = c.total_audience ?? null;
  return { reached, total, percent: total ? pct(reached, total) : null };
}

export const fmtInt = (n: number | null | undefined) => (n == null ? "–" : Math.round(n).toLocaleString("en-IN"));
export const fmtPct = (n: number | null | undefined) => (n == null ? "–" : `${n}%`);
export const fmtInr = (n: number | null | undefined) =>
  n == null ? "–" : `₹${n < 100 ? n.toFixed(2).replace(/\.00$/, "") : Math.round(n).toLocaleString("en-IN")}`;

export function fmtIst(iso: string | number | null | undefined, withDate = true): string {
  if (iso == null) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    ...(withDate ? { day: "numeric", month: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtIstDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
}

/* ------------------------------------------------------------------------ */
/* Audience                                                                   */
/* ------------------------------------------------------------------------ */

export type AudienceMode = "warm" | "engaged" | "segment" | "tags" | "retarget" | "csv" | "everyone";

export type AudienceState = {
  mode: AudienceMode;
  segments: string[];
  tagsAny: string[];
  tagsAll: string[];
  excludeTags: string[];
  retargetCampaignId: string;
  retargetStage: RetargetStage;
  csvTag: string | null;
  csvCount: number;
  csvConsent: boolean;
};

export const DEFAULT_AUDIENCE: AudienceState = {
  mode: "warm",
  segments: [],
  tagsAny: [],
  tagsAll: [],
  excludeTags: [],
  retargetCampaignId: "",
  retargetStage: "not_read",
  csvTag: null,
  csvCount: 0,
  csvConsent: false,
};

// A draft is created (autosaved) before an audience is confirmed. It carries a
// tag nobody has, so even if someone sent it by mistake it reaches nobody.
export const UNCHOSEN_AUDIENCE_TAG = "draft:audience-not-chosen";

export const ENGAGED_TAG = "tier:engaged";

// RFM segment presets -> rfm:* tags written nightly by wa-rfm-tick; prospect
// buckets ride on source tags. Multi-select unions the tags.
export const SEGMENTS: { key: string; label: string; hint: string; tags: string[] }[] = [
  { key: "vip", label: "VIP", hint: "₹3k+ spent or 5+ orders", tags: ["rfm:vip"] },
  { key: "loyal", label: "Loyal", hint: "2 to 4 orders, last one in 90 days", tags: ["rfm:loyal"] },
  { key: "first", label: "First-time buyers", hint: "one order so far", tags: ["rfm:new", "rfm:one_time"] },
  { key: "at_risk", label: "At risk", hint: "last order 3 to 6 months ago", tags: ["rfm:at_risk"] },
  { key: "dormant", label: "Dormant", hint: "no order for 6+ months", tags: ["rfm:dormant"] },
  { key: "crm_import", label: "CRM contacts", hint: "imported, no order yet", tags: ["crm_import"] },
  { key: "order_phone", label: "Order phones", hint: "phone from an order, no spend matched", tags: ["order_phone"] },
  { key: "lead", label: "Leads", hint: "B2B or scraped prospects", tags: ["lead"] },
];

export const RETARGET_STAGES: { key: RetargetStage; label: string; hint: string }[] = [
  { key: "not_read", label: "Got it but didn't read", hint: "Delivered, never opened." },
  { key: "read_no_reply", label: "Read it but didn't reply", hint: "Opened, no message back since." },
  { key: "failed_cap", label: "Held back by Meta", hint: "Meta held it back and it never reached them." },
  {
    key: "not_delivered",
    label: "Never reached",
    hint: "Every try failed for sure. People whose message may still arrive, or whose result is unclear, are left out so nobody gets it twice.",
  },
];

const uniq = (xs: string[]) => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));

export function segmentTags(keys: string[]): string[] {
  return uniq(SEGMENTS.filter((s) => keys.includes(s.key)).flatMap((s) => s.tags));
}

export function buildAudienceFilter(a: AudienceState): CampaignAudienceFilter {
  switch (a.mode) {
    case "warm":
      return { engagement: "warm" };
    case "engaged":
      return { tags: [ENGAGED_TAG] };
    case "segment":
      return { tags: segmentTags(a.segments) };
    case "tags": {
      const f: CampaignAudienceFilter = {};
      const any = uniq(a.tagsAny);
      const all = uniq(a.tagsAll);
      const not = uniq(a.excludeTags);
      if (any.length) f.tags = any;
      if (all.length) f.tags_all = all;
      if (not.length) f.exclude_tags = not;
      return f;
    }
    case "retarget":
      return { retarget: { campaign_id: a.retargetCampaignId, stage: a.retargetStage } };
    case "csv":
      return a.csvTag ? { tags: [a.csvTag] } : { tags: [UNCHOSEN_AUDIENCE_TAG] };
    case "everyone":
      return {};
  }
}

// Rebuild the picker state from a saved filter (edit, duplicate).
export function audienceFromFilter(f: CampaignAudienceFilter | null | undefined): AudienceState {
  const base = { ...DEFAULT_AUDIENCE };
  if (!f || typeof f !== "object") return base;
  const tags = f.tags ?? [];
  if (tags.includes(UNCHOSEN_AUDIENCE_TAG)) return base;
  if (f.engagement === "warm") return { ...base, mode: "warm" };
  if (f.retarget?.campaign_id) {
    return { ...base, mode: "retarget", retargetCampaignId: f.retarget.campaign_id, retargetStage: f.retarget.stage };
  }
  const onlyTags = !f.tags_all?.length && !f.exclude_tags?.length;
  if (onlyTags && tags.length === 0) return { ...base, mode: "everyone" };
  if (onlyTags && tags.length === 1 && tags[0] === ENGAGED_TAG) return { ...base, mode: "engaged" };
  if (onlyTags && tags.length === 1 && tags[0].startsWith("list:")) return { ...base, mode: "csv", csvTag: tags[0], csvConsent: true };
  if (onlyTags) {
    const keys = SEGMENTS.filter((s) => s.tags.every((t) => tags.includes(t))).map((s) => s.key);
    if (keys.length && segmentTags(keys).length === uniq(tags).length) return { ...base, mode: "segment", segments: keys };
  }
  return { ...base, mode: "tags", tagsAny: [...tags], tagsAll: [...(f.tags_all ?? [])], excludeTags: [...(f.exclude_tags ?? [])] };
}

// Stable key for a filter (sorted keys and tag lists), used both as a query
// key and to check the API kept every part of it.
export function filterKey(f: CampaignAudienceFilter | null | undefined): string {
  const src = (f ?? {}) as Record<string, unknown>;
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return [...v].map(String).sort();
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  const cleaned = Object.fromEntries(
    Object.keys(src)
      .filter((k) => !(Array.isArray(src[k]) && (src[k] as unknown[]).length === 0) && src[k] != null)
      .sort()
      .map((k) => [k, norm(src[k])]),
  );
  return JSON.stringify(cleaned);
}

// True when the server kept exactly the filter we asked for. If the API drops
// a key it doesn't know (e.g. `engagement` before the normaliser supports it),
// the audience would silently WIDEN, so the wizard refuses to continue.
export function sameFilter(sent: CampaignAudienceFilter | null | undefined, echoed: CampaignAudienceFilter | null | undefined): boolean {
  return filterKey(sent) === filterKey(echoed);
}

export function audienceProblems(a: AudienceState): string[] {
  switch (a.mode) {
    case "segment":
      return a.segments.length ? [] : ["Pick at least one customer group."];
    case "tags":
      return a.tagsAny.length || a.tagsAll.length ? [] : ["Pick at least one tag to include."];
    case "retarget":
      return a.retargetCampaignId ? [] : ["Pick the earlier campaign to follow up on."];
    case "csv": {
      const p: string[] = [];
      if (!a.csvTag) p.push("Upload your list first.");
      if (!a.csvConsent) p.push("Confirm that the people on this list agreed to hear from PROMUNCH on WhatsApp.");
      return p;
    }
    default:
      return [];
  }
}

// Is this audience mostly people who never talked to us?
export function isColdAudience(mode: AudienceMode, coldShare: number | null): boolean {
  if (mode === "everyone" || mode === "csv") return true;
  if (mode === "warm" || mode === "engaged") return false;
  return coldShare != null && coldShare > COLD_SHARE_DANGER;
}

export function heldBackRate(mode: AudienceMode, coldShare: number | null = null): number {
  switch (mode) {
    case "engaged":
      return HELD_BACK_RATE.engaged;
    case "warm":
      return HELD_BACK_RATE.warm;
    case "segment":
      return coldShare != null && coldShare > COLD_SHARE_DANGER ? HELD_BACK_RATE.cold : HELD_BACK_RATE.buyers;
    case "retarget":
      return HELD_BACK_RATE.retarget;
    default:
      return coldShare != null && coldShare <= COLD_SHARE_DANGER ? HELD_BACK_RATE.buyers : HELD_BACK_RATE.cold;
  }
}

export type Estimate = { people: number; heldBack: number; delivered: number; costInr: number; costPerMessage: number };

// Expected outcome for `people` recipients: Meta holds back a share, the rest
// is delivered and billed (marketing rate + GST, delivered only).
export function estimateOutcome(people: number, mode: AudienceMode, coldShare: number | null = null): Estimate {
  const n = Math.max(0, Math.round(people));
  const heldBack = Math.round(n * heldBackRate(mode, coldShare));
  const delivered = n - heldBack;
  const costPerMessage = MARKETING_RATE_INR * (1 + GST_RATE);
  return { people: n, heldBack, delivered, costInr: Math.round(delivered * costPerMessage * 100) / 100, costPerMessage };
}

// How many a day, and roughly when it finishes, from the preview's budget.
export function pacing(
  people: number,
  budget: { limit: number | null; non_campaign_24h: number } | null,
  etaDays: number | null,
  startMs: number,
): { perDay: number | null; finishMs: number | null; days: number | null } {
  if (people <= 0) return { perDay: 0, finishMs: startMs, days: 0 };
  const limit = budget?.limit ?? null;
  const perDay = limit != null ? Math.max(1, Math.min(people, limit - (budget?.non_campaign_24h ?? 0))) : null;
  const days = etaDays ?? (perDay ? Math.ceil(people / perDay) : null);
  if (days == null) return { perDay, finishMs: null, days: null };
  const firstDay = istDayStartMs(nextAllowedAt(startMs));
  return { perDay, finishMs: firstDay + (Math.max(1, days) - 1) * DAY_MS + 12 * 3600_000, days };
}

/* ------------------------------------------------------------------------ */
/* Template content                                                           */
/* ------------------------------------------------------------------------ */

export type CampaignTemplate = Pick<
  Template,
  "id" | "name" | "language" | "category" | "status" | "body" | "footer" | "header_type" | "header_text" | "header_media_url" | "buttons" | "variables"
> & { quality_score?: string | null; needs_media?: boolean | null; header_samples?: string[] | null; updated_at?: string | null };

export type VarField = {
  key: string;
  kind: "body" | "header" | "button" | "track";
  label: string;
  help: string;
  sample: string;
  placeholder: string;
  /** True when the blank is the customer's first name (starts as {name}). */
  isName: boolean;
};

// A blank "looks like a name" when Meta's sample is a single capitalised word
// (Priya, Aarav) or the blank comes straight after a greeting ("Hi {{1}}").
// Those default to {name}, never the sample, so nobody gets "Hi Aarav".
const GREETING_BEFORE_RE = /\b(hi|hello|hey|dear)[\s,!]*$/i;
const NAME_SAMPLE_RE = /^[A-Z][a-z]+$/;
export function looksLikeNameBlank(text: string | null | undefined, key: string, sample: string): boolean {
  if (NAME_SAMPLE_RE.test(sample.trim())) return true;
  const src = String(text ?? "");
  const m = src.match(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`));
  if (!m || m.index == null) return false;
  return GREETING_BEFORE_RE.test(src.slice(0, m.index));
}

const eg = (sample: string, fallback: string) => (sample.trim() ? `e.g. ${sample.trim()}` : fallback);

function bodySample(t: CampaignTemplate, n: string): string {
  const v = t.variables;
  if (Array.isArray(v)) {
    const hit = v.find((x: { name?: unknown }) => String(x?.name ?? "") === n) as { sample?: unknown } | undefined;
    if (hit?.sample != null) return String(hit.sample);
  } else if (v && typeof v === "object" && n in v) {
    return String((v as Record<string, unknown>)[n] ?? "");
  }
  return "";
}

function buttonExample(b: TemplateButton | undefined): string {
  const ex = (b as { example?: unknown } | undefined)?.example;
  return Array.isArray(ex) ? String(ex[0] ?? "") : typeof ex === "string" ? ex : "";
}

export function isMediaHeader(t: Pick<CampaignTemplate, "header_type"> | null | undefined): boolean {
  const h = String(t?.header_type ?? "").toUpperCase();
  return h === "IMAGE" || h === "VIDEO" || h === "DOCUMENT";
}

export function mediaKindOf(t: Pick<CampaignTemplate, "header_type"> | null | undefined): "image" | "video" | "document" | null {
  const h = String(t?.header_type ?? "").toUpperCase();
  return h === "IMAGE" ? "image" : h === "VIDEO" ? "video" : h === "DOCUMENT" ? "document" : null;
}

// Every value the template needs from us, as friendly form fields.
export function templateFields(t: CampaignTemplate): VarField[] {
  const out: VarField[] = [];
  if (String(t.header_type ?? "").toUpperCase() === "TEXT" && templateVarKeys(t.header_text).length) {
    const sample = String(t.header_samples?.[0] ?? "");
    const isName = looksLikeNameBlank(t.header_text, "1", sample);
    out.push({
      key: "_header_1",
      kind: "header",
      label: isName ? "Title line: customer's first name" : "Title line",
      help: `Fills the blank in the title: "${t.header_text}"`,
      sample,
      placeholder: eg(sample, "Short title text"),
      isName,
    });
  }
  for (const n of templateVarKeys(t.body)) {
    const sample = bodySample(t, n);
    const isName = looksLikeNameBlank(t.body, n, sample);
    out.push({
      key: n,
      kind: "body",
      label: isName ? `Blank ${n}: customer's first name` : `Blank ${n} in the message`,
      help: isName
        ? "Leave it as {name} and each customer sees their own first name."
        : "Same text for everyone. Type your own words, the grey example is only Meta's sample.",
      sample,
      placeholder: eg(sample, "Text for this blank"),
      isName,
    });
  }
  const tpl = t as unknown as TemplateSchema;
  let trackDone = false;
  for (const b of dynamicUrlButtons(tpl)) {
    const btn = (t.buttons ?? [])[b.index];
    const text = btn?.text ? `"${btn.text}"` : `button ${b.index + 1}`;
    if (isShortLinkBase(b.base)) {
      if (trackDone) continue;
      trackDone = true;
      out.push({
        key: "_track_url",
        kind: "track",
        label: `Where should the ${text} button go?`,
        help: "Paste the full page link. We count every tap before sending people there.",
        sample: "",
        placeholder: "https://promunch.in/...",
        isName: false,
      });
    } else {
      out.push({
        key: `_button_${b.index}`,
        kind: "button",
        label: `Link for the ${text} button`,
        help: `The link starts with ${b.base}. Type the rest, or paste the whole link.`,
        sample: b.example ?? buttonExample(btn),
        placeholder: eg(b.example ?? buttonExample(btn), `${b.base}...`),
        isName: false,
      });
    }
  }
  return out;
}

// Starting values: name blanks get {name}; everything else starts EMPTY (the
// Meta sample is only a placeholder), so a sample can't be sent by accident.
export function initialVars(t: CampaignTemplate): Record<string, string> {
  return Object.fromEntries(templateFields(t).map((f) => [f.key, f.isName ? "{name}" : ""]));
}

// Blanks whose value is exactly Meta's sample text (e.g. "Aarav", "15%"),
// which almost always means the real wording was never typed in.
export function samplesUsed(t: CampaignTemplate | null, vars: Record<string, string>): VarField[] {
  if (!t) return [];
  return templateFields(t).filter((f) => {
    if (f.kind !== "body" && f.kind !== "header") return false;
    const v = (vars[f.key] ?? "").trim();
    return !!v && !!f.sample.trim() && v === f.sample.trim();
  });
}

const HTTPS_RE = /^https:\/\/[^\s/]+\.[^\s]+$/i;

// Plain-English problems with the content step (per field), plus the engine's
// own validation as a final guard.
export function contentProblems(
  t: CampaignTemplate | null,
  vars: Record<string, string>,
  opts: { mediaUrl: string | null; ai: boolean; brief: string; name: string },
): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  if (!opts.name.trim()) out.push({ field: "name", message: "Give the campaign a name so you can find it later." });
  if (!t) return [...out, { field: "template", message: "Pick a template first." }];
  if (isMediaHeader(t) && !(opts.mediaUrl || t.header_media_url)) {
    out.push({ field: "media", message: `This template needs ${mediaKindOf(t) === "image" ? "an image" : `a ${mediaKindOf(t) === "document" ? "PDF" : "video"}`}. Upload one.` });
  }
  for (const f of templateFields(t)) {
    const v = (vars[f.key] ?? "").trim();
    if (f.kind === "body" && opts.ai) continue; // AI fills body blanks per person
    if (!v) {
      if (f.kind === "button" && f.sample.trim()) continue; // engine uses the template's example link
      out.push({ field: f.key, message: `${f.label}: fill this in.` });
      continue;
    }
    if (f.kind === "track" && !HTTPS_RE.test(v)) out.push({ field: f.key, message: "Use a full link that starts with https://" });
    if (/—/.test(v)) out.push({ field: f.key, message: "PROMUNCH copy never uses long dashes (—). Use a comma or full stop." });
  }
  if (opts.ai && !opts.brief.trim()) out.push({ field: "brief", message: "Write a short brief for the AI, or turn AI personalisation off." });
  if (out.length) return out;
  const engineVars: Record<string, unknown> = { ...vars };
  if (opts.ai) engineVars._ai_brief = opts.brief.trim();
  for (const e of validateCampaignSetup(t as unknown as TemplateSchema, engineVars, opts.mediaUrl)) {
    out.push({ field: "engine", message: friendlyEngineError(e) });
  }
  return out;
}

export function friendlyEngineError(e: string): string {
  if (/header media is a (\w+) but the template needs a (\w+)/.test(e)) {
    const m = e.match(/header media is a (\w+) but the template needs a (\w+)/)!;
    return `You uploaded a ${m[1]} but this template needs a ${m[2]}. Upload the right kind of file.`;
  }
  if (/no media URL/.test(e)) return "This template needs its picture, video or PDF. Upload one.";
  if (/can't be set/.test(e)) return "This template has no picture slot, so remove the uploaded file.";
  if (/body variable/.test(e)) return "Fill in every blank in the message.";
  if (/_header_1/.test(e)) return "Fill in the title line.";
  if (/_track_url/.test(e)) return "Add the link the button should open.";
  if (/_button_/.test(e)) return "Add the link for the button.";
  if (/brief is empty/.test(e)) return "Write a short brief for the AI, or turn AI personalisation off.";
  return e;
}

// Final template_vars payload (the engine's keys).
export function buildTemplateVars(vars: Record<string, string>, ai: boolean, brief: string, t: CampaignTemplate | null): Record<string, string> {
  const keys = new Set(t ? templateFields(t).map((f) => f.key) : Object.keys(vars));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) if (keys.has(k) && String(v ?? "").trim()) out[k] = String(v).trim();
  if (ai && brief.trim()) out._ai_brief = brief.trim();
  return out;
}

// Body/header text as a customer named `name` would see it.
export function fillText(text: string | null | undefined, vars: Record<string, string>, name = SAMPLE_NAME, header = false): string {
  return String(text ?? "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => {
    const v = header ? (n === "1" ? vars._header_1 : "") : vars[n];
    return v && v.trim() ? v.replace(/\{name\}/gi, name) : `{{${n}}}`;
  });
}

/* ------------------------------------------------------------------------ */
/* Templates gallery                                                          */
/* ------------------------------------------------------------------------ */

export function isMarketing(t: Pick<CampaignTemplate, "category">): boolean {
  const c = String(t.category ?? "").toLowerCase();
  return c === "marketing" || c === "offer";
}

// Only real marketing templates can be used for a campaign. Internal
// (ops pings, order confirmations) and customer-service (UTILITY) templates
// never show up in the campaign picker.
export function campaignTemplates<T extends { name: string; category?: string | null }>(list: T[]): T[] {
  return list.filter((t) => templateKind(t) === "marketing");
}

export function sortTemplatesForGallery<T extends Pick<CampaignTemplate, "category" | "name">>(list: T[]): T[] {
  return [...list].sort((a, b) => Number(isMarketing(b)) - Number(isMarketing(a)) || a.name.localeCompare(b.name));
}

export const QUALITY_META: Record<string, { label: string; tone: Tone }> = {
  GREEN: { label: "Quality: good", tone: "good" },
  YELLOW: { label: "Quality: at risk", tone: "warn" },
  RED: { label: "Quality: poor", tone: "crit" },
};

/* ------------------------------------------------------------------------ */
/* Schedule (all in India time, whatever the browser's timezone)              */
/* ------------------------------------------------------------------------ */

// "2026-09-30T10:00" typed as India time -> epoch ms.
export function parseIstInput(v: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const ms = Date.parse(`${v}:00+05:30`);
  return Number.isFinite(ms) ? ms : null;
}

export function toIstInput(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16);
}

export type ScheduleState = { when: "now" | "schedule"; at: string; repeat: "" | "daily" | "weekly" | "monthly"; until: string };

export function scheduleProblems(s: ScheduleState, nowMs = Date.now()): string[] {
  if (s.when === "now") return [];
  const at = parseIstInput(s.at);
  if (at == null) return ["Pick a date and time."];
  const p: string[] = [];
  if (at <= nowMs + 60_000) p.push("Pick a time in the future.");
  if (s.repeat && s.until) {
    const until = Date.parse(`${s.until}T23:59:59+05:30`);
    if (!Number.isFinite(until) || until <= at) p.push("The repeat end date must be after the first send.");
  }
  return p;
}

// When the first message actually goes out.
export function effectiveStart(s: ScheduleState, nowMs = Date.now()): number {
  const at = s.when === "schedule" ? parseIstInput(s.at) ?? nowMs : nowMs;
  return nextAllowedAt(at);
}

/* ------------------------------------------------------------------------ */
/* Wizard steps                                                               */
/* ------------------------------------------------------------------------ */

// `next` is the primary button label on the step BEFORE this one, so it says
// what happens next in plain words.
export const STEPS = [
  { key: "template", label: "Message", next: "Next: pick a message" },
  { key: "content", label: "Fill in", next: "Next: fill in the message" },
  { key: "audience", label: "Who gets it", next: "Next: choose who gets it" },
  { key: "schedule", label: "When", next: "Next: pick when it goes out" },
  { key: "review", label: "Check and send", next: "Next: check and send" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

// The typed-number check for risky audiences: the teammate types how many
// people will get it.
export function typedCountMatches(typed: string, count: number): boolean {
  const digits = typed.replace(/[^\d]/g, "");
  return digits.length > 0 && Number(digits) === count;
}

/* ------------------------------------------------------------------------ */
/* CSV lists                                                                  */
/* ------------------------------------------------------------------------ */

// RFC-4180-ish: quotes, escaped quotes, commas/newlines inside quotes.
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}

export function toWaId(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

export type CsvContact = { phone: string; name?: string; email?: string };

// Guess the phone / name / email columns, return clean unique rows.
export function csvContacts(headers: string[], rows: string[][]): { contacts: CsvContact[]; skipped: number; phoneCol: number } {
  const find = (re: RegExp) => headers.findIndex((h) => re.test(h));
  let phoneCol = find(/phone|mobile|whats ?app|number|contact/i);
  if (phoneCol < 0) phoneCol = rows.length ? rows[0].findIndex((c) => toWaId(c) != null) : -1;
  const nameCol = find(/name/i);
  const emailCol = find(/e-?mail/i);
  const seen = new Set<string>();
  const contacts: CsvContact[] = [];
  let skipped = 0;
  for (const r of rows) {
    const wa = phoneCol >= 0 ? toWaId(r[phoneCol]) : null;
    if (!wa || seen.has(wa)) { skipped++; continue; }
    seen.add(wa);
    const c: CsvContact = { phone: wa };
    if (nameCol >= 0 && r[nameCol]?.trim()) c.name = r[nameCol].trim();
    if (emailCol >= 0 && r[emailCol]?.trim()) c.email = r[emailCol].trim();
    contacts.push(c);
  }
  return { contacts, skipped, phoneCol };
}

// list:<name>-<yyyymmdd>, unique per upload day.
export function listTagFor(name: string, nowMs = Date.now()): string {
  const slug = name.toLowerCase().replace(/\.csv$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "upload";
  const day = new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, "");
  return `list:${slug}-${day}`;
}

/* ------------------------------------------------------------------------ */
/* Test numbers                                                               */
/* ------------------------------------------------------------------------ */

export function normalizeTestNumber(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

export function rememberNumber(list: string[], n: string, max = 3): string[] {
  return [n, ...list.filter((x) => x !== n)].slice(0, max);
}

/* ------------------------------------------------------------------------ */
/* Held / skipped breakdowns                                                   */
/* ------------------------------------------------------------------------ */

const HELD_LABELS: Record<string, string> = {
  governor: "Got another marketing message recently (we space them out)",
  cart: "Has a cart-recovery message going",
  ticket: "Has an open support chat",
  daily_claim: "Already got a marketing message today",
};

const SKIPPED_LABELS: Record<string, string> = {
  optout: "Unsubscribed (replied STOP)",
  terminal: "Number can't receive WhatsApp messages",
  unknown_error: "Unexpected error, not retried to be safe",
  ambiguous: "Unclear if it arrived (Meta didn't confirm), not re-sent so nobody gets it twice",
  transient_exhausted: "Temporary errors, gave up after 3 tries",
  structural_exhausted: "Message setup problem, gave up after 3 tries",
  cap_exhausted: "Held back by Meta 3 times",
  held_governor: "Still spacing out their marketing messages when the campaign ended",
  held_cart: "Still in cart recovery when the campaign ended",
  held_ticket: "Still had an open support chat when the campaign ended",
  held_daily_claim: "Already got another campaign that day when this one ended",
};

export function breakdownRows(b: Record<string, number> | null | undefined, kind: "held" | "skipped"): { key: string; label: string; count: number }[] {
  const labels = kind === "held" ? HELD_LABELS : SKIPPED_LABELS;
  return Object.entries(b ?? {})
    .filter(([, n]) => Number(n) > 0)
    .map(([key, n]) => ({ key, label: labels[key] ?? key.replace(/_/g, " "), count: Number(n) }))
    .sort((a, b2) => b2.count - a.count);
}

/* ------------------------------------------------------------------------ */
/* Recipients CSV export                                                      */
/* ------------------------------------------------------------------------ */

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}
