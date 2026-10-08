// Pure query-string parsing for GET /api/orm/mentions (unit-tested).
import { isSourceKey, isStatus, ORM_URGENCIES, type OrmSourceKey, type OrmStatus, type OrmUrgency } from "./types";

/**
 * Status chips in the feed. "needs_reply" and "handled" are views over the
 * stored statuses; a raw status (or a comma list of them) also works.
 *   new          -> status = new
 *   needs_reply  -> still open (new / seen / escalated) and a complaint,
 *                   a question or negative
 *   handled      -> replied or ignored
 *   all          -> no status filter
 */
export type StatusView = "new" | "needs_reply" | "handled" | "all";

export const OPEN_STATUSES: OrmStatus[] = ["new", "seen", "escalated"];
export const HANDLED_STATUSES: OrmStatus[] = ["replied", "ignored"];

export type SentimentBucket = "neg" | "neu" | "pos";

export interface MentionFilters {
  view: StatusView | null;
  statuses: OrmStatus[] | null; // explicit list (when not a view)
  source: OrmSourceKey | null;
  sentiment: SentimentBucket | null;
  urgency: OrmUrgency[] | null;
  q: string | null;
  owned: boolean | null;
  before: string | null; // ISO, exclusive cursor on posted_at
  limit: number;
  includeIrrelevant: boolean;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

const csv = (v: string | null) =>
  (v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Search text safe to drop into a PostgREST or() filter: no , ( ) * % \ or quotes. */
export function cleanSearch(raw: string | null | undefined): string | null {
  const q = (raw ?? "")
    .replace(/[,()*%\\"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return q.length >= 2 ? q : null;
}

export function parseMentionFilters(sp: URLSearchParams): MentionFilters {
  const statusRaw = (sp.get("status") ?? "").trim();
  let view: StatusView | null = null;
  let statuses: OrmStatus[] | null = null;
  if (["new", "needs_reply", "handled", "all"].includes(statusRaw)) view = statusRaw as StatusView;
  else if (statusRaw) {
    const list = csv(statusRaw).filter(isStatus);
    statuses = list.length ? list : null;
  }
  // "new" is both a view and a raw status: same meaning, keep it as a list.
  if (view === "new") {
    view = null;
    statuses = ["new"];
  }
  if (view === "all") view = null;

  const src = sp.get("source");
  const sent = sp.get("sentiment");
  const urg = csv(sp.get("urgency")).filter((u): u is OrmUrgency => (ORM_URGENCIES as readonly string[]).includes(u));
  const owned = sp.get("owned");
  const before = sp.get("before");
  const beforeOk = before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : null;
  const limRaw = Number(sp.get("limit"));
  const limit = Number.isFinite(limRaw) && limRaw >= 1 ? Math.min(MAX_LIMIT, Math.floor(limRaw)) : DEFAULT_LIMIT;

  return {
    view,
    statuses,
    source: isSourceKey(src) ? src : null,
    sentiment: sent === "neg" || sent === "neu" || sent === "pos" ? sent : null,
    urgency: urg.length ? urg : null,
    q: cleanSearch(sp.get("q")),
    owned: owned === "1" || owned === "true" ? true : owned === "0" || owned === "false" ? false : null,
    before: beforeOk,
    limit,
    includeIrrelevant: sp.get("include_irrelevant") === "1",
  };
}

/** Next page cursor: the last row's posted_at when the page came back full. */
export function nextBefore(rows: { posted_at: string | null }[], limit: number): string | null {
  if (rows.length < limit) return null;
  return rows[rows.length - 1]?.posted_at ?? null;
}

/** Sentiment bucket for a -2..2 score (null = not scored yet). */
export function sentimentBucket(s: number | null | undefined): SentimentBucket | null {
  if (s == null) return null;
  return s < 0 ? "neg" : s > 0 ? "pos" : "neu";
}

/** Same rule as the needs_reply view, for one row (used by the UI and summary). */
export function needsReply(m: { status: OrmStatus; sentiment: number | null; intent: string | null }): boolean {
  if (!OPEN_STATUSES.includes(m.status)) return false;
  return (m.sentiment ?? 0) < 0 || m.intent === "complaint" || m.intent === "question";
}

/** PostgREST OR groups for the filters (needs_reply rule, search). */
export function orGroups(f: MentionFilters): string[] {
  const groups: string[] = [];
  if (f.view === "needs_reply") groups.push("sentiment.lt.0,intent.in.(complaint,question)");
  if (f.q) {
    const p = `*${f.q}*`;
    groups.push(`body.ilike.${p},title.ilike.${p},author_name.ilike.${p},author_handle.ilike.${p},summary.ilike.${p}`);
  }
  return groups;
}

/** One `or=` value that ANDs several OR groups (PostgREST logic trees nest). */
export function combineOrGroups(groups: string[]): string | null {
  if (!groups.length) return null;
  if (groups.length === 1) return groups[0];
  return `and(${groups.map((g) => `or(${g})`).join(",")})`;
}
