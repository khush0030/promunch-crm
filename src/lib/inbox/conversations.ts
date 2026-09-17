// Pure aggregator for the unified Inbox conversation list (Task 2.2). Merges
// WhatsApp threads, Instagram threads and support-email threads into one
// `InboxItem` shape, sorted and paginated the same way regardless of
// channel. No React, no Supabase, no fetch — Task 2.3's API route composes
// these functions with real data.

import { categoryWord } from "../../components/inbox/labels";

export type InboxFilter = "human" | "mine" | "bot" | "all";

export type WaThreadRow = {
  id: string;
  status: "bot" | "human" | "snoozed" | "closed";
  assigned_to: string | null;
  ticket_status: string | null;
  ticket_number: number | null;
  ticket_assignee: string | null;
  unread_count: number | null;
  last_message_snippet: string | null;
  last_activity_at: string | null;
  created_at: string;
  archived_at: string | null;
  contact: { name: string | null; phone: string | null; wa_id: string } | null;
};

export type IgThreadRow = {
  id: string;
  status: "bot" | "human";
  classification: string | null;
  handle: string | null;
  full_name: string | null;
  ticket_status: string | null;
  assigned_to: string | null;
  unread_count: number | null;
  last_message_snippet: string | null;
  last_activity_at: string | null;
  archived_at: string | null;
  // Optional: only needed as a fallback for `at` when last_activity_at is
  // null (older rows, or the generated column not backfilled yet). Callers
  // that don't select it simply never hit the fallback branch.
  created_at?: string | null;
};

export type EmailThreadRow = {
  id: string;
  status: string;
  should_reply: boolean | null;
  from_name: string | null;
  from_email: string;
  subject: string | null;
  lead_category: string | null;
  urgency: string | null;
  created_at: string;
};

export type InboxItem = {
  key: string; // "wa-<id>" | "ig-<id>" | "em-<id>"
  channel: "wa" | "ig" | "em";
  name: string;
  preview: string; // one line, max 90 chars, whitespace collapsed
  at: string; // ISO
  pill: { tone: "info" | "neu" | "crit" | "warn" | "good"; text: string };
  needsHuman: boolean;
  assignee: string | null;
  bot: boolean;
  unread: number;
};

function toPreview(raw: string | null | undefined, fallback = ""): string {
  const collapsed = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return fallback;
  return collapsed.slice(0, 90);
}

function isOpenOrPendingTicket(status: string | null): boolean {
  return status === "open" || status === "pending";
}

export function waToItem(r: WaThreadRow): InboxItem {
  const ticketActive = isOpenOrPendingTicket(r.ticket_status);
  const pill = ticketActive
    ? ({ tone: "crit", text: r.ticket_number != null ? `Ticket #${r.ticket_number}` : "Ticket" } as const)
    : r.status === "human"
      ? ({ tone: "warn", text: "Needs a human" } as const)
      : r.status === "closed"
        ? ({ tone: "good", text: "Closed" } as const)
        : ({ tone: "info", text: "Bot" } as const);

  const contactName = r.contact?.name?.trim();
  const name = contactName || r.contact?.phone || r.contact?.wa_id || "";

  return {
    key: `wa-${r.id}`,
    channel: "wa",
    name,
    preview: toPreview(r.last_message_snippet),
    // No created_at fallback here (unlike igToItem): the API route excludes
    // WA threads with a null last_activity_at (no messages either way —
    // nothing to act on) before they ever reach this function, so SQL fetch
    // order and item.at always agree. `?? ""` only matters as a defensive
    // fallback if that exclusion is ever bypassed.
    at: r.last_activity_at ?? "",
    pill,
    needsHuman: ticketActive || r.status === "human",
    assignee: r.assigned_to ?? r.ticket_assignee,
    bot: r.status === "bot" && !ticketActive,
    unread: r.unread_count ?? 0,
  };
}

export function igToItem(r: IgThreadRow): InboxItem {
  const ticketOpen = r.ticket_status === "open";
  const pill =
    r.classification === "collab"
      ? ({ tone: "neu", text: "Creator" } as const)
      : ticketOpen
        ? ({ tone: "crit", text: "Needs a human" } as const)
        : r.status === "human"
          ? ({ tone: "warn", text: "Needs a human" } as const)
          : ({ tone: "info", text: "Bot" } as const);

  const name = r.full_name?.trim() || (r.handle ? `@${r.handle}` : "") || "Instagram user";

  return {
    key: `ig-${r.id}`,
    channel: "ig",
    name,
    preview: toPreview(r.last_message_snippet),
    // Fall back to created_at when last_activity_at is null; if neither is
    // available `at` is "" and the caller must exclude the item from paging
    // rather than emit a cursor built from an empty timestamp.
    at: r.last_activity_at || r.created_at || "",
    pill,
    needsHuman: ticketOpen || r.status === "human",
    assignee: r.assigned_to,
    bot: r.status === "bot" && !ticketOpen,
    unread: r.unread_count ?? 0,
  };
}

export function emailToItem(r: EmailThreadRow): InboxItem {
  const draftReady = r.status === "pending" && r.should_reply !== false;
  const pill = draftReady
    ? ({ tone: "warn", text: "Draft ready" } as const)
    : ({ tone: "neu", text: categoryWord(r.lead_category) } as const);

  const name = r.from_name?.trim() || r.from_email;

  return {
    key: `em-${r.id}`,
    channel: "em",
    name,
    preview: toPreview(r.subject, "(no subject)"),
    at: r.created_at,
    pill,
    needsHuman: draftReady,
    assignee: null,
    bot: false,
    unread: 0,
  };
}

export function matchesFilter(i: InboxItem, f: InboxFilter, me: string): boolean {
  switch (f) {
    case "human":
      return i.needsHuman;
    case "mine":
      return !!i.assignee && i.assignee.toLowerCase() === me.toLowerCase();
    case "bot":
      return i.bot;
    case "all":
    default:
      return true;
  }
}

// Anything with an `at`/`key` pair sorts the same way an InboxItem does —
// widened (rather than requiring a full InboxItem) so cursor.ts's
// pageFromChannels can also compare bare cursor-boundary markers (a raw
// fetch's last row, before it's known whether that row survives filtering)
// against real items with the same comparator.
export type AtKey = { at: string; key: string };

// The canonical sort order for the merged Inbox list: `at` desc, `key` asc
// as the tiebreak. Exported (not just inlined in mergeItems) so
// src/lib/inbox/cursor.ts's pageFromChannels can re-sort each channel's rows
// with the exact same comparator before slicing/merging — one definition of
// "sorted", not two that could drift.
export function compareItems(a: AtKey, b: AtKey): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1; // desc by at
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; // asc by key
}

export function mergeItems(lists: InboxItem[][], limit: number): InboxItem[] {
  const all = lists.flat();
  all.sort(compareItems);
  return all.slice(0, limit);
}
