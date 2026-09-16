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
