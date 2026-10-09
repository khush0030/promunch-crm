"use client";

// Creators · Instagram side (Find + Outreach): shared types, number formats
// and the read-only count queries the pipeline stepper uses. Every call here
// is a GET the old /dashboard/instagram page already made.

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

export type Prospect = {
  id: string;
  handle: string;
  full_name: string | null;
  biography: string | null;
  followers: number | null;
  media_count: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  avg_views: number | null;
  engagement_rate: number | null;
  last3: { likes: number | null; comments: number | null; views: number | null; caption: string | null; type: string | null }[] | null;
  niche: string | null;
  fit_score: number | null;
  fit_reason: string | null;
  bio_email: string | null;
  status: "new" | "shortlisted" | "contacted" | "in_convo" | "rejected";
  source: string | null;
  thread_id: string | null;
  pitch_dm: string | null;
  pitch_email_subject: string | null;
  pitch_email_body: string | null;
  scraped_at: string | null;
};

export const PROSPECT_STATUS: { key: Prospect["status"]; label: string }[] = [
  { key: "new", label: "New" },
  { key: "shortlisted", label: "Shortlisted" },
  { key: "contacted", label: "Pitched" },
  { key: "in_convo", label: "Talking" },
  { key: "rejected", label: "Not a fit" },
];
export const PROSPECT_LABEL = Object.fromEntries(PROSPECT_STATUS.map((s) => [s.key, s.label])) as Record<Prospect["status"], string>;

export type CollabStage = "new" | "in_convo" | "terms_sent" | "agreed" | "shipped" | "posted" | "declined";
export const COLLAB_STAGES: CollabStage[] = ["new", "in_convo", "terms_sent", "agreed", "shipped", "posted", "declined"];
export const COLLAB_STAGE_LABEL: Record<CollabStage, string> = {
  new: "New",
  in_convo: "Talking",
  terms_sent: "Terms sent",
  agreed: "Agreed",
  shipped: "Shipped",
  posted: "Posted",
  declined: "Declined",
};

export type IgSettings = {
  paused: boolean;
  auto_reply_enabled: boolean;
  auto_reply_scope: "routine_only" | "all";
  auto_reply_comments: boolean;
  escalate_to_slack: boolean;
  min_followers: number;
  max_followers: number;
  barter_terms: string | null;
};

export function fmtNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
export const er = (v: number | null | undefined) => (v == null ? null : `${(v * 100).toFixed(1)}%`);

/** The Instagram tables were never migrated in prod: every read answers
 *  "Could not find the table ..." (or a Postgres "relation does not exist").
 *  That is "not switched on yet", not a failure to shout about. */
export function isIgOff(msg: string | null | undefined): boolean {
  return !!msg && /schema cache|does not exist|relation .*ig_|Could not find the table/i.test(msg);
}

export class IgError extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new IgError(d.error || `${url} answered ${r.status}`);
  // Routes answer 200 { off: true } while the Instagram tables are not
  // migrated (src/lib/instagram/ig-off.ts); keep treating that as "off".
  if (d && d.off === true) throw new IgError(`Could not find the table: ${d.error ?? "instagram"}`);
  return d as T;
}

/** Counts for the pipeline stepper. Tiny reads (limit=1), shared cache keys. */
export function useIgCounts() {
  const prospects = useQuery({
    queryKey: ["ig", "prospect-counts"],
    queryFn: () => getJson<{ total: number; statusCounts: Record<string, number> }>("/api/instagram/prospects?limit=1"),
    retry: false,
    refetchInterval: (q) => (isIgOff(q.state.error?.message) ? false : 300_000),
  });
  const threads = useQuery({
    queryKey: ["ig", "collab-counts"],
    queryFn: () =>
      getJson<{ total: number; classCounts: Record<string, number>; stageCounts: Record<string, number> }>(
        "/api/instagram/threads?tab=collab&limit=1",
      ),
    retry: false,
    refetchInterval: (q) => (isIgOff(q.state.error?.message) ? false : 300_000),
  });
  const followups = useQuery({
    queryKey: ["ig", "followups"],
    queryFn: () => getJson<FollowupsResponse>("/api/instagram/followups"),
    retry: false,
    refetchInterval: (q) => (isIgOff(q.state.error?.message) ? false : 300_000),
  });
  const err = prospects.error ?? threads.error ?? followups.error;
  const off = isIgOff(err?.message);
  const sc = prospects.data?.statusCounts ?? {};
  const st = threads.data?.stageCounts ?? {};
  return {
    loading: prospects.isLoading || threads.isLoading || followups.isLoading,
    off,
    error: off ? null : err?.message ?? null,
    toCheck: (sc.new ?? 0) + (sc.shortlisted ?? 0),
    shortlisted: sc.shortlisted ?? 0,
    pitched: (sc.contacted ?? 0) + (sc.in_convo ?? 0),
    talking: (st.new ?? 0) + (st.in_convo ?? 0) + (st.terms_sent ?? 0),
    followUps: followups.data?.counts?.awaiting ?? 0,
  };
}

export type FollowupThread = {
  id: string;
  handle: string | null;
  collab_stage: string | null;
  fit_score: number | null;
  followers: number | null;
  bio_email: string | null;
  phone: string | null;
  status: string;
  last_inbound_at: string | null;
  last_message_snippet: string | null;
};

export type Followup = {
  id: string;
  thread_id: string;
  stage: string;
  step: number;
  status: string;
  channel: string | null;
  draft: string | null;
  next_action_at: string;
  last_error: string | null;
  meta: { window_state?: string; days_silent?: number } | null;
  thread: FollowupThread | null;
};

export type FollowupsResponse = {
  awaiting: Followup[];
  escalated: Followup[];
  scheduled: Followup[];
  counts: { awaiting: number };
};

/** Close a drawer on Escape while it is open. */
export function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

/** "Good matches" in Find: micro-creators the scorer rates well. Brands are
 *  capped at 15 and non-Indian audiences at 20, so min fit 45 drops both. */
export const GOOD_MATCH = { minFollowers: 1000, maxFollowers: 15000, minFit: 45 } as const;

/** One-click Indian micro-creator search: creator-style tags (snack-word tags
 *  mostly return brands). Each runs as its own hashtag search. */
export const CREATOR_HASHTAGS = [
  "gymfoodindia",
  "highproteinrecipes",
  "indianfitnesscreator",
  "fitnessindia",
  "healthyrecipesindia",
  "fitmomindia",
] as const;
