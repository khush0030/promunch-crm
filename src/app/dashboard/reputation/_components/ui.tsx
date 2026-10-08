"use client";

// Shared bits for the Reputation page: labels, small marks (stars, sentiment
// dot, urgency), time formatting, the drawer shell and the data hooks.

import { useEffect, type ReactNode } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import type {
  OrmAlert,
  OrmMention,
  OrmSettingsResponse,
  OrmSourceKey,
  OrmStatus,
  OrmSummary,
  OrmUrgency,
} from "@/lib/orm/types";
import { api, QK } from "./api";
import s from "../reputation.module.css";

// ── labels ──────────────────────────────────────────────────────────────────

/** Short name for the feed and "Open on …" links. */
export const SOURCE_SHORT: Record<OrmSourceKey, string> = {
  judgeme: "Website review",
  amazon: "Amazon",
  youtube: "YouTube",
  reddit: "Reddit",
  rss: "News and web",
  instagram: "Instagram",
};

export const OPEN_ON: Record<OrmSourceKey, string> = {
  judgeme: "Open on the website",
  amazon: "Open on Amazon",
  youtube: "Open on YouTube",
  reddit: "Open on Reddit",
  rss: "Open the article",
  instagram: "Open on Instagram",
};

export const STATUS_LABEL: Record<OrmStatus, string> = {
  new: "New",
  seen: "Seen",
  replied: "Replied",
  ignored: "Ignored",
  escalated: "Escalated",
};

/** Tone per status: coloured text + dot, never a filled block. */
export type Tone = "crit" | "warn" | "good" | "info" | "neu" | "ink";
export const STATUS_TONE: Record<OrmStatus, Tone> = {
  new: "ink",
  seen: "neu",
  replied: "good",
  ignored: "neu",
  escalated: "warn",
};

export const TOPIC_LABEL: Record<string, string> = {
  taste: "Taste",
  crunch: "Crunch",
  flavour: "Flavour",
  price: "Price",
  value: "Value",
  protein: "Protein",
  ingredients: "Ingredients",
  packaging: "Packaging",
  delivery: "Delivery",
  freshness: "Freshness",
  quality: "Quality",
  foreign_object: "Foreign object",
  allergy: "Allergy",
  availability: "Availability",
  customer_service: "Customer service",
  competitor: "Competitor",
  other: "Other",
};
export const topicLabel = (t: string) => TOPIC_LABEL[t] ?? t.replace(/_/g, " ");

export const INTENT_LABEL: Record<string, string> = {
  complaint: "Complaint",
  question: "Question",
  praise: "Praise",
  suggestion: "Suggestion",
  collab: "Collab ask",
  spam: "Spam",
  other: "Other",
};

export function sentimentInfo(v: number | null): { label: string; tone: Tone } | null {
  if (v == null) return null;
  if (v <= -2) return { label: "Very negative", tone: "crit" };
  if (v === -1) return { label: "Negative", tone: "crit" };
  if (v === 0) return { label: "Neutral", tone: "neu" };
  if (v === 1) return { label: "Positive", tone: "good" };
  return { label: "Very positive", tone: "good" };
}

// ── formatting ──────────────────────────────────────────────────────────────

/** "just now", "12 min ago", "3 h ago", "2 days ago", then "28 Sep". */
export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 8) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function compact(n: number | null | undefined): string {
  if (n == null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export function authorOf(m: Pick<OrmMention, "author_name" | "author_handle">): string {
  return m.author_name || m.author_handle || "Someone";
}

// ── marks ───────────────────────────────────────────────────────────────────

export function Mark({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`${s.mark} ${s[`t_${tone}`]}`} title={title}>
      {children}
    </span>
  );
}

export function Stars({ rating }: { rating: number | string | null }) {
  const r = rating == null ? NaN : Number(rating);
  if (!Number.isFinite(r)) return null;
  const full = Math.round(r);
  return (
    <span className={s.stars} aria-label={`${r} out of 5 stars`} title={`${r} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= full ? s.starOn : s.starOff} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}

export function UrgencyMark({ urgency }: { urgency: OrmUrgency | null }) {
  if (urgency === "critical") return <Mark tone="crit">Critical</Mark>;
  if (urgency === "high") return <Mark tone="warn">Urgent</Mark>;
  return null;
}

export function SentimentMark({ value }: { value: number | null }) {
  const i = sentimentInfo(value);
  if (!i) return <Mark tone="neu">Not scored yet</Mark>;
  return <Mark tone={i.tone}>{i.label}</Mark>;
}

// ── drawer ──────────────────────────────────────────────────────────────────

export function Drawer({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.drawer} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function CloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="pm-btn ghost sm" onClick={onClose} aria-label="Close">
      <X size={15} />
    </button>
  );
}

export function Switch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={s.switch}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

// ── data hooks ──────────────────────────────────────────────────────────────

export type FeedFilters = { status: string; source: string; sentiment: string; q: string };

export function useMentions(f: FeedFilters) {
  const sp = new URLSearchParams();
  if (f.status && f.status !== "all") sp.set("status", f.status);
  if (f.source) sp.set("source", f.source);
  if (f.sentiment) sp.set("sentiment", f.sentiment);
  if (f.q.trim().length >= 2) sp.set("q", f.q.trim());
  sp.set("limit", "50");
  const qs = sp.toString();
  return useInfiniteQuery({
    queryKey: [...QK.mentions, qs],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<{ mentions: OrmMention[]; next_before: string | null }>(
        `/api/orm/mentions?${qs}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    getNextPageParam: (last) => last.next_before ?? null,
    refetchInterval: 120_000,
  });
}

export function useMention(id: string) {
  return useQuery({
    queryKey: QK.mention(id),
    queryFn: () => api<{ mention: OrmMention; alerts: OrmAlert[] }>(`/api/orm/mentions/${id}`),
  });
}

export function useSummary(days: number) {
  return useQuery({
    queryKey: QK.summary(days),
    queryFn: () => api<OrmSummary>(`/api/orm/summary?days=${days}`),
    refetchInterval: 300_000,
  });
}

export function useOrmSettings() {
  return useQuery({
    queryKey: QK.settings,
    queryFn: () => api<OrmSettingsResponse>("/api/orm/settings"),
  });
}
