// Pure label helpers shared across the Inbox UI (Task 2.2). No React, no
// Supabase, no fetch here — see src/lib/inbox/conversations.ts for the
// aggregator that consumes these.

// Exact words from the plan's Global Constraints for Task 2.2 — these
// intentionally diverge from the older `categoryLabel` map on the Support
// Emails list (src/app/dashboard/support-emails/page.tsx), e.g.
// order_tracking is "Order status" here, not "Order Tracking".
const CATEGORY_WORDS: Record<string, string> = {
  customer_support: "Support",
  order_tracking: "Order status",
  complaint: "Complaint",
  partnership_inquiry: "Partnership",
  wholesale: "Wholesale",
  job_application: "Job application",
  spam: "Spam",
  general: "General",
};

export function categoryWord(c: string | null): string {
  if (!c) return "General";
  return CATEGORY_WORDS[c] || "General";
}

export function urgencyPill(u: string | null): { tone: "crit" | "warn"; text: string } | null {
  if (u === "critical") return { tone: "crit", text: "Urgent" };
  if (u === "high") return { tone: "warn", text: "Soon" };
  return null;
}

export function ticketStatusWord(
  s: string | null,
  assignee: string | null,
  teamName: (email: string) => string,
): string {
  const open = s === "open" || s === "pending";
  if (open && assignee) return `With ${teamName(assignee)}`;
  if (s === "open") return "New";
  if (s === "pending") return "Waiting on customer";
  if (s === "resolved" || s === "closed") return "Resolved";
  return "";
}

// ---- colour-coded tags (Oct 2026 spacious redesign) ----------------------
// One colour per meaning across the Inbox (see Tag in components/pm):
// red = needs a reply, amber = draft ready / waiting / snoozed, grey = bot or
// closed, green = solved. Topics: wholesale purple, partnership teal,
// support blue, order issue red, job application grey.

export type TagSpec = { tone: "green" | "blue" | "red" | "amber" | "purple" | "teal" | "pink" | "grey"; text: string };

type RowLike = {
  channel: "wa" | "ig" | "em";
  state: "ticket" | "human" | "bot" | "snoozed" | "closed" | "draft" | "email";
  waiting: boolean;
  ticketNumber: number | null;
};

/** The one status tag a conversation row shows. Null for a plain email (its topic tag says enough). */
export function statusTag(i: RowLike): TagSpec | null {
  switch (i.state) {
    case "draft":
      return { tone: "amber", text: "Draft ready" };
    case "email":
      return null;
    case "snoozed":
      return { tone: "amber", text: "Snoozed" };
    case "closed":
      return { tone: "grey", text: "Closed" };
    case "bot":
      return i.waiting ? { tone: "red", text: "Needs reply" } : { tone: "grey", text: "Bot" };
    case "ticket":
    case "human":
    default:
      return i.waiting ? { tone: "red", text: "Needs reply" } : { tone: "amber", text: "Waiting on customer" };
  }
}

const TOPIC_TAG: Record<string, TagSpec> = {
  wholesale: { tone: "purple", text: "Wholesale" },
  partnership: { tone: "teal", text: "Partnership" },
  partnership_inquiry: { tone: "teal", text: "Partnership" },
  collab: { tone: "teal", text: "Creator" },
  customer_support: { tone: "blue", text: "Support" },
  support: { tone: "blue", text: "Support" },
  product_query: { tone: "blue", text: "Product question" },
  order_tracking: { tone: "blue", text: "Order status" },
  order_issue: { tone: "red", text: "Order issue" },
  refund: { tone: "red", text: "Refund" },
  complaint: { tone: "red", text: "Complaint" },
  job_application: { tone: "grey", text: "Job application" },
  spam: { tone: "grey", text: "Spam" },
};

/** Colour-coded topic tag for a ticket category or an email's lead category. Null for none/general. */
export function topicTag(category: string | null | undefined): TagSpec | null {
  if (!category) return null;
  return TOPIC_TAG[category.toLowerCase()] ?? null;
}

/** Age tag for an email still waiting: amber after 2 days, red after 7. */
export function ageTag(iso: string, nowMs: number = Date.now()): TagSpec | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((nowMs - t) / 86_400_000);
  if (days > 7) return { tone: "red", text: `${days} days old` };
  if (days > 2) return { tone: "amber", text: `${days} days old` };
  return null;
}

/** Same colours for a display word from categoryWord ("Partnership", "Job application"...). */
export function topicTagForWord(word: string | null | undefined): TagSpec | null {
  if (!word) return null;
  const key = Object.keys(CATEGORY_WORDS).find((k) => CATEGORY_WORDS[k].toLowerCase() === word.toLowerCase());
  return key ? topicTag(key) : null;
}
