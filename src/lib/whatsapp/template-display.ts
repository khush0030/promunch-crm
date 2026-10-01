// Plain-English labels and grouping for the WhatsApp Templates screen.
// Pure, no React.

import { templateKind, type TemplateKind } from "./templateKind";

export type Tone = "good" | "warn" | "crit" | "neu" | "info";

export type StatusInfo = { label: string; tone: Tone; explain: string };

const STATUS: Record<string, StatusInfo> = {
  approved: { label: "Approved", tone: "good", explain: "Meta approved it. It can be sent." },
  pending: {
    label: "Waiting for Meta",
    tone: "warn",
    explain: "Meta is reviewing it. This usually takes a few minutes and can take up to 24 hours. This page updates by itself.",
  },
  rejected: { label: "Needs changes", tone: "crit", explain: "Meta did not approve it. Fix the reason shown and send it again." },
  disabled: {
    label: "Paused by Meta",
    tone: "crit",
    explain: "Meta paused it, usually because customers blocked or reported it. Soften the wording and send it again.",
  },
  paused: {
    label: "Paused by Meta",
    tone: "crit",
    explain: "Meta paused it, usually because customers blocked or reported it. Soften the wording and send it again.",
  },
  draft: { label: "Draft", tone: "neu", explain: "Only saved here. It has not been sent to Meta yet." },
};

export function statusInfo(status: string | null | undefined): StatusInfo {
  const s = String(status ?? "").toLowerCase();
  return STATUS[s] ?? { label: s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unknown", tone: "neu", explain: "" };
}

/** Status filter chips, in display order. */
export const STATUS_FILTERS = ["all", "approved", "pending", "rejected", "disabled", "draft"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function matchesStatus(status: string, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "disabled") return status === "disabled" || status === "paused";
  return status === filter;
}

export function qualityInfo(q: string | null | undefined): { label: string; tone: Tone } | null {
  switch (String(q ?? "").toUpperCase()) {
    case "GREEN": return { label: "Quality: good", tone: "good" };
    case "YELLOW": return { label: "Quality: medium", tone: "warn" };
    case "RED": return { label: "Quality: low", tone: "crit" };
    default: return null;
  }
}

export const CATEGORY_LABEL: Record<string, string> = {
  marketing: "Marketing", offer: "Marketing", utility: "Utility", authentication: "Authentication",
};

export type TemplateGroups<T> = Record<TemplateKind, T[]>;

/** Split templates into For campaigns / Automatic messages / Team alerts. */
export function groupTemplates<T extends { name: string; category?: string | null }>(list: T[]): TemplateGroups<T> {
  const out: TemplateGroups<T> = { marketing: [], customer_service: [], internal: [] };
  for (const t of list) out[templateKind(t)].push(t);
  return out;
}

/** Search on the technical name, the friendly name and the message text. */
export function matchesSearch(t: { name: string; body?: string | null }, q: string, friendly: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return t.name.toLowerCase().includes(s) || friendly.toLowerCase().includes(s) || (t.body ?? "").toLowerCase().includes(s);
}

/**
 * A video URL that shows its first frame as a still. Mobile Safari (and
 * Chrome with preload="metadata") paints nothing, or black, for a <video>
 * until it has decoded a frame; the #t media fragment makes it seek to
 * 0.1s so the thumbnail is a real picture.
 */
export function videoPosterSrc(url: string): string {
  if (!url || url.includes("#")) return url;
  return `${url}#t=0.1`;
}
