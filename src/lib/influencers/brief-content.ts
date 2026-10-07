// Pure helpers for influencer briefs: brand-copy cleanup, shape validation of
// BriefContent (AI output and dashboard edits both pass through here), and the
// deterministic must-haves every brief carries regardless of what the model
// wrote (tag, collab invite, discount code, deliverable counts, no medical
// claims). No I/O, safe to import from client or server.

import type { BriefContent, Deliverables, UsageRights } from "./types";

/**
 * PROMUNCH's real Instagram handle (matches SOCIAL_LINKS.instagram in
 * src/lib/email/brand-tokens.ts). Edit here if the brand account changes.
 */
export const PROMUNCH_IG_HANDLE = "@promunch.snacks";

const MAX_STR = 4000;
const MAX_ITEM = 400;
const MAX_ITEMS = 20;

/**
 * Brand copy rules: no em or en dashes, PROMUNCH always in caps. Leaves
 * technical identifiers alone (@promunch.snacks, promunch.in).
 */
export function cleanCopy(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/(?<![@\w.])promunch(?![\w.])/gi, "PROMUNCH")
    .replace(/,\s*,/g, ",")
    .trim();
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function str(v: unknown, field: string, { max = MAX_STR, allowEmpty = false } = {}): Result<string> {
  if (typeof v !== "string") return { ok: false, error: `${field} must be text` };
  const s = cleanCopy(v);
  if (!allowEmpty && !s) return { ok: false, error: `${field} cannot be empty` };
  if (s.length > max) return { ok: false, error: `${field} is too long (max ${max} characters)` };
  return { ok: true, value: s };
}

function strList(v: unknown, field: string, { min = 0 } = {}): Result<string[]> {
  if (!Array.isArray(v)) return { ok: false, error: `${field} must be a list` };
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return { ok: false, error: `${field} must only contain text` };
    const s = cleanCopy(item);
    if (!s) continue;
    if (s.length > MAX_ITEM) return { ok: false, error: `An item in ${field} is too long (max ${MAX_ITEM})` };
    out.push(s);
  }
  if (out.length > MAX_ITEMS) return { ok: false, error: `${field} has too many items (max ${MAX_ITEMS})` };
  if (out.length < min) return { ok: false, error: `${field} needs at least ${min} item${min === 1 ? "" : "s"}` };
  return { ok: true, value: out };
}

function numOrNull(v: unknown, field: string, max: number): Result<number | null> {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return { ok: false, error: `${field} must be a number between 0 and ${max}` };
  return { ok: true, value: Math.round(n) };
}

function strOrNull(v: unknown, field: string, max = 200): Result<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: `${field} must be text` };
  const s = cleanCopy(v);
  if (s.length > max) return { ok: false, error: `${field} is too long` };
  return { ok: true, value: s || null };
}

/** Validate + normalise an unknown value into BriefContent. */
export function validateBriefContent(raw: unknown): Result<BriefContent> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "content must be an object" };
  const r = raw as Record<string, unknown>;

  const concept = str(r.concept, "concept", { max: 1500 });
  if (!concept.ok) return concept;
  const hooks = strList(r.hooks, "hooks", { min: 1 });
  if (!hooks.ok) return hooks;
  const script = str(r.script, "script", { max: MAX_STR });
  if (!script.ok) return script;
  const talking = strList(r.talking_points ?? [], "talking_points");
  if (!talking.ok) return talking;
  const mustSay = strList(r.must_say ?? [], "must_say");
  if (!mustSay.ok) return mustSay;
  const checklist = strList(r.checklist, "checklist", { min: 1 });
  if (!checklist.ok) return checklist;
  const donts = strList(r.donts ?? [], "donts");
  if (!donts.ok) return donts;

  const f = (r.format && typeof r.format === "object" ? r.format : {}) as Record<string, unknown>;
  const len = numOrNull(f.length_sec, "format.length_sec", 600);
  if (!len.ok) return len;
  const aspect = strOrNull(f.aspect, "format.aspect", 40);
  if (!aspect.ok) return aspect;
  const stories = numOrNull(f.stories, "format.stories", 50);
  if (!stories.ok) return stories;

  const d = (r.dates && typeof r.dates === "object" ? r.dates : {}) as Record<string, unknown>;
  const draftDue = strOrNull(d.draft_due, "dates.draft_due", 60);
  if (!draftDue.ok) return draftDue;
  const goLive = strOrNull(d.go_live, "dates.go_live", 60);
  if (!goLive.ok) return goLive;

  const usage = strOrNull(r.usage_rights_text, "usage_rights_text", 1500);
  if (!usage.ok) return usage;

  return {
    ok: true,
    value: {
      concept: concept.value,
      hooks: hooks.value,
      script: script.value,
      talking_points: talking.value,
      must_say: mustSay.value,
      checklist: checklist.value,
      donts: donts.value,
      format: { length_sec: len.value, aspect: aspect.value, stories: stories.value },
      dates: { draft_due: draftDue.value, go_live: goLive.value },
      usage_rights_text: usage.value,
    },
  };
}

export function deliverablesLine(d: Deliverables): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(d.reels ?? 0, "Reel", "Reels");
  add(d.stories ?? 0, "Story", "Stories");
  add(d.posts ?? 0, "feed post", "feed posts");
  return parts.length ? parts.join(" + ") : "1 Reel";
}

export function usageRightsDefault(rights: UsageRights, days: number | null): string | null {
  if (rights === "none") return null;
  const span = days ? ` for ${days} days` : "";
  if (rights === "organic_repost") {
    return `PROMUNCH may repost your content on our own Instagram and website${span}, always crediting you.`;
  }
  return `PROMUNCH may run your content as a partnership ad from your handle${span}. We will add you as a partner in Meta and you approve the request once.`;
}

export interface BriefFacts {
  deliverables: Deliverables;
  discount_code: string | null;
  usage_rights: UsageRights;
  usage_rights_days: number | null;
  draft_due: string | null; // human date, e.g. "18 Oct 2026"
  go_live: string | null;
}

const has = (list: string[], re: RegExp) => list.some((s) => re.test(s));

/**
 * Force the non-negotiable parts of a brief, whatever the model returned:
 * required checklist lines, the no-medical-claims don't, correct dates and
 * usage rights text (only when rights are granted).
 */
export function enforceBriefRules(c: BriefContent, facts: BriefFacts): BriefContent {
  const checklist = [...c.checklist];
  const handleRe = new RegExp(PROMUNCH_IG_HANDLE.replace(/[.@]/g, (m) => `\\${m}`), "i");
  if (!has(checklist, handleRe)) checklist.unshift(`Tag ${PROMUNCH_IG_HANDLE} in the video and the caption`);
  if (!has(checklist, /collab/i)) checklist.push(`Send ${PROMUNCH_IG_HANDLE} an Instagram Collab invite when you post`);
  if (facts.discount_code && !has(checklist, new RegExp(escapeRe(facts.discount_code), "i"))) {
    checklist.push(`Share your discount code ${facts.discount_code} in the caption${facts.deliverables.stories ? " and on your Story" : ""}`);
  }
  const deliv = deliverablesLine(facts.deliverables);
  if (!checklist.some((s) => s.includes(deliv))) {
    checklist.push(`Deliverables: ${deliv}`);
  }

  const donts = [...c.donts];
  if (!has(donts, /medical|cure|disease|health claim|weight ?loss/i)) {
    donts.push("No medical or health claims (no cures, no weight loss promises, no disease talk)");
  }

  return {
    ...c,
    checklist,
    donts,
    format: { ...c.format, stories: facts.deliverables.stories || c.format.stories || null },
    dates: { draft_due: facts.draft_due, go_live: facts.go_live },
    usage_rights_text:
      facts.usage_rights === "none"
        ? null
        : c.usage_rights_text || usageRightsDefault(facts.usage_rights, facts.usage_rights_days),
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "18 Oct 2026" in IST, or null. */
export function formatIstDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}
