// Pure helpers that turn lead statuses into the guided B2B flow:
// Find → Score + emails → (AI writes) → Review + send → Follow-ups → Replies → Deals.
// Statuses come from GET /api/leads (statusCounts); nothing here fetches.

import type { Lead } from "./types";

export type FlowCounts = {
  total: number;
  checking: number; // still being scored / crawled for emails
  noEmail: number; // crawled, no usable work email (or no website)
  listedOnly: number; // saved without email finding
  withEmail: number; // has a verified (MX-checked) work email
  writing: number; // email found, AI draft not written yet
  toReview: number; // AI draft written, waiting for a person
  sent: number; // emailed, no reply yet
  replied: number;
  bounced: number;
  suppressed: number;
};

const sum = (c: Record<string, number>, keys: string[]) => keys.reduce((a, k) => a + (c[k] ?? 0), 0);

export function flowCounts(c: Record<string, number>): FlowCounts {
  return {
    total: Object.values(c).reduce((a, b) => a + b, 0),
    checking: sum(c, ["new", "crawling"]),
    noEmail: sum(c, ["no_contacts", "no_website"]),
    listedOnly: c.listed ?? 0,
    withEmail: sum(c, ["ready", "drafting", "drafted", "contacted", "replied", "bounced"]),
    writing: sum(c, ["ready", "drafting"]),
    toReview: c.drafted ?? 0,
    sent: c.contacted ?? 0,
    replied: c.replied ?? 0,
    bounced: c.bounced ?? 0,
    suppressed: c.suppressed ?? 0,
  };
}

// Where a single lead sits in the flow, in plain words, with a tone for its tag.
export type LeadStage = "checking" | "no_email" | "writing" | "review" | "sent" | "followup" | "replied" | "bounced" | "stopped" | "saved";

export function leadStage(lead: Lead & { enrollment?: { status: string } | null }): LeadStage {
  const en = lead.enrollment?.status;
  if (lead.status === "replied" || en === "replied") return "replied";
  if (lead.status === "bounced" || en === "bounced") return "bounced";
  if (lead.status === "suppressed") return "stopped";
  if (en === "active" || en === "sending") return "followup";
  if (lead.status === "contacted" || en === "completed") return "sent";
  if (lead.status === "drafted") return "review";
  if (lead.status === "ready" || lead.status === "drafting") return "writing";
  if (lead.status === "new" || lead.status === "crawling") return "checking";
  if (lead.status === "listed") return "saved";
  return "no_email";
}

export const STAGE_TAG: Record<LeadStage, { label: string; tone?: "good" | "warn" | "info" | "red" | "bad" }> = {
  checking: { label: "Being checked" },
  no_email: { label: "No work email" },
  saved: { label: "Saved, emails not searched" },
  writing: { label: "AI is writing", tone: "info" },
  review: { label: "To review", tone: "warn" },
  sent: { label: "Sent" },
  followup: { label: "In follow-ups", tone: "info" },
  replied: { label: "Replied", tone: "good" },
  bounced: { label: "Bounced", tone: "bad" },
  stopped: { label: "Do not contact" },
};

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function nf(n: number): string {
  return n.toLocaleString("en-IN");
}
