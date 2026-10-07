// Plain-English helpers for the WhatsApp marketing "Start here" tab and the
// campaign page. Pure: no React, no fetch (tested in summary.test.ts).
// Copy rules: PROMUNCH in caps, no em dashes.

import type { Campaign } from "../types";

type CampaignNumbers = Pick<Campaign, "name" | "status" | "sent_count" | "delivered_count" | "read_count" | "replied_count" | "total_audience">;

const n = (v: number | null | undefined) => Math.max(0, Math.round(Number(v ?? 0)));
const int = (v: number) => v.toLocaleString("en-IN");
const people = (v: number) => `${int(v)} ${v === 1 ? "person" : "people"}`;

/**
 * One-paragraph recap of a campaign, e.g.
 * "Your last campaign "Diwali" went to 500 people. 480 got it, 300 read it (63%), 12 replied, 4 ordered."
 * `orders` is null while unknown (the sentence then leaves orders out).
 */
export function campaignSentence(c: CampaignNumbers, orders: number | null, opts: { lead?: string } = {}): string {
  const sent = n(c.sent_count);
  const lead = opts.lead ?? `Your last campaign "${c.name}"`;
  if (sent === 0) {
    if (c.status === "draft") return `${lead} is still a draft. Nobody has got it yet.`;
    if (c.status === "scheduled") return `${lead} is scheduled. Nobody has got it yet.`;
    return `${lead} hasn't reached anyone yet.`;
  }
  const delivered = n(c.delivered_count);
  const read = n(c.read_count);
  const replied = n(c.replied_count);
  const readPct = delivered > 0 ? Math.round((read / delivered) * 100) : 0;
  const verb = c.status === "sending" ? "has gone to" : "went to";
  const parts = [`${int(delivered)} got it`, `${int(read)} read it (${readPct}%)`, `${int(replied)} replied`];
  if (orders != null) parts.push(`${int(orders)} ordered`);
  const last = parts.pop();
  return `${lead} ${verb} ${people(sent)}${c.status === "sending" ? " so far" : ""}. ${parts.join(", ")} and ${last}.`;
}

export type NextStep = {
  tone: "info" | "success" | "warn";
  title: string;
  body: string;
  stage?: "not_read" | "read_no_reply";
};

// Worth suggesting a follow-up only when it would reach a real group.
export const FOLLOW_UP_MIN = 20;

/** What to do next after a campaign, in one suggestion (or null when nothing useful). */
export function campaignNextStep(c: CampaignNumbers): NextStep | null {
  const sent = n(c.sent_count);
  if (sent === 0) return null;
  if (c.status === "sending") {
    return {
      tone: "info",
      title: "It's still going out",
      body: "Nothing to do. The numbers update by themselves. Come back tomorrow to see who read it and who ordered.",
    };
  }
  const delivered = n(c.delivered_count);
  const read = n(c.read_count);
  const replied = n(c.replied_count);
  const notRead = Math.max(0, delivered - read);
  const readNoReply = Math.max(0, read - replied);
  if (notRead >= FOLLOW_UP_MIN) {
    return {
      tone: "warn",
      stage: "not_read",
      title: `${people(notRead)} got it but didn't read it. Send them a follow-up?`,
      body: "A short, different message a few days later often gets read. Only people who didn't open this one get it.",
    };
  }
  if (readNoReply >= FOLLOW_UP_MIN) {
    return {
      tone: "info",
      stage: "read_no_reply",
      title: `${people(readNoReply)} read it but didn't reply. Nudge them?`,
      body: "Try a clear offer or a question they can answer in one word.",
    };
  }
  return {
    tone: "success",
    title: "Nice work, most people saw it",
    body: "There's no big group left to follow up. Plan your next campaign when you have something new to say.",
  };
}

/** The most recent campaign that actually reached someone, else the newest one. */
export function latestCampaign<T extends Pick<Campaign, "created_at" | "sent_count"> & { started_at?: string | null }>(list: T[]): T | null {
  if (!list.length) return null;
  const at = (c: T) => Date.parse(c.started_at ?? c.created_at) || 0;
  const sorted = [...list].sort((a, b) => at(b) - at(a));
  return sorted.find((c) => n(c.sent_count) > 0) ?? sorted[0];
}

/* ------------------------------------------------------------------------ */
/* Campaign return (Start here ROI block). Only figures the data provides.   */
/* ------------------------------------------------------------------------ */

export type ReturnCard = { orders: number; revenue: number; cost: number; roi: number | null };

/** "34×" for big multiples, "2.8×" for small ones, null when there is no cost yet. */
export function returnMultiple(roi: number | null | undefined): string | null {
  if (roi == null || !Number.isFinite(roi)) return null;
  return `${roi >= 10 ? Math.round(roi) : Math.round(roi * 10) / 10}×`;
}

/** Colour for a return multiple: good at 3× or more, warn below, bad under 1×. */
export function returnTone(roi: number | null | undefined): "good" | "warn" | "crit" | "neu" {
  if (roi == null || !Number.isFinite(roi)) return "neu";
  if (roi >= 3) return "good";
  if (roi >= 1) return "warn";
  return "crit";
}

/** Average order value in rupees, or null with no orders. */
export function avgOrder(c: Pick<ReturnCard, "orders" | "revenue">): number | null {
  return c.orders > 0 ? Math.round(c.revenue / c.orders) : null;
}

export type FunnelStep = { key: string; label: string; count: number; pct: number };

/**
 * Message-to-purchase steps for one campaign, as a share of people who got it.
 * Link taps only appear when the campaign records them.
 */
export function campaignFunnel(
  c: Pick<Campaign, "delivered_count" | "read_count" | "clicked_count">,
  orders: number | null,
): FunnelStep[] {
  const delivered = n(c.delivered_count);
  const share = (v: number) => (delivered > 0 ? Math.round((v / delivered) * 1000) / 10 : 0);
  const steps: FunnelStep[] = [{ key: "delivered", label: "Got it", count: delivered, pct: delivered > 0 ? 100 : 0 }];
  steps.push({ key: "read", label: "Read it", count: n(c.read_count), pct: share(n(c.read_count)) });
  if (c.clicked_count != null) steps.push({ key: "clicked", label: "Tapped the link", count: n(c.clicked_count), pct: share(n(c.clicked_count)) });
  if (orders != null) steps.push({ key: "bought", label: "Bought", count: n(orders), pct: share(n(orders)) });
  return steps;
}
