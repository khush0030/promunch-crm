// Pure per-channel filter-clause builders for the unified Inbox list (Task
// 2.3, fix round 2). Each function turns an InboxFilter into a PostgREST
// filter plan — data, not a live query builder — so the plan itself can be
// unit-tested (exact clause strings, and a table test against matchesFilter)
// independently of Supabase. src/app/api/inbox/conversations/route.ts is the
// only place that turns a plan into an actual `.eq()/.or()/.ilike()` call.
//
// Every branch below is commented with the matchesFilter/toItem rule
// (conversations.ts) it mirrors — that pairing is what the table test in
// filters.test.ts checks, so SQL and the pure rule can't drift apart
// unnoticed.

import type { InboxFilter, WaThreadRow, IgThreadRow, EmailThreadRow } from "./conversations";
import { ilikeExact } from "./search";

// All string-carrying plan values (`clause`, and eqOr's `value`) are already
// PostgREST-ready — quoted/escaped as needed (see ilikeExact/quotePostgrestValue
// in search.ts) — and are applied via `.or()` string parsing, NOT the
// `.ilike()`/`.eq()` builder methods directly, so there is exactly one place
// (the `.or()` string parser) that needs to agree on quoting rules. `eqOr`'s
// `value` is the one exception: it's a plain column value applied via the
// `.eq()` builder method, which handles its own encoding.
export type FilterPlan =
  | { type: "none" } // filter=all: no extra clause
  | { type: "or"; clause: string } // apply .or(clause)
  | { type: "eqOr"; column: string; value: string; clause: string } // apply .eq(column, value).or(clause)
  | { type: "skip" }; // this channel+filter combination can never match — skip the query entirely

// --- WhatsApp -----------------------------------------------------------
//
// Mirrors waToItem's derived fields:
//   ticketActive = ticket_status in ("open", "pending")
//   needsHuman   = ticketActive || status === "human"
//   bot          = status === "bot" && !ticketActive
//   assignee     = assigned_to ?? ticket_assignee   (nullish coalescing: only
//                  falls back when assigned_to is null, not "")
//   mine         = !!assignee && assignee.toLowerCase() === me.toLowerCase()
export function waFilterPlan(filter: InboxFilter, me: string): FilterPlan {
  switch (filter) {
    case "human":
      return { type: "or", clause: "status.eq.human,ticket_status.in.(open,pending)" };
    case "bot":
      // A null ticket_status counts as "not active" — `.not.in` alone would
      // silently exclude NULLs (NULL NOT IN (...) evaluates to NULL, not
      // true in Postgres), so it's spelled out as an explicit `.is.null` OR.
      return {
        type: "eqOr",
        column: "status",
        value: "bot",
        clause: "ticket_status.is.null,ticket_status.not.in.(open,pending)",
      };
    case "mine": {
      // assignee = assigned_to ?? ticket_assignee, so "mine" is: assigned_to
      // matches OR (assigned_to is null AND ticket_assignee matches) — NOT a
      // plain OR of the two ilikes, which would wrongly match a thread whose
      // assigned_to is someone else but whose (stale) ticket_assignee is me.
      const x = ilikeExact(me);
      return { type: "or", clause: `assigned_to.ilike.${x},and(assigned_to.is.null,ticket_assignee.ilike.${x})` };
    }
    case "all":
    default:
      return { type: "none" };
  }
}

// Pure JS mirror of waFilterPlan, for the table test: for a fixture row,
// waMatchesSql(row, filter, me) must agree with
// matchesFilter(waToItem(row), filter, me) for every filter.
export function waMatchesSql(row: WaThreadRow, filter: InboxFilter, me: string): boolean {
  const ticketActive = row.ticket_status === "open" || row.ticket_status === "pending";
  switch (filter) {
    case "human":
      return row.status === "human" || ticketActive;
    case "bot":
      return row.status === "bot" && !ticketActive;
    case "mine": {
      const effective = row.assigned_to ?? row.ticket_assignee;
      return !!effective && effective.toLowerCase() === me.toLowerCase();
    }
    case "all":
    default:
      return true;
  }
}

// --- Instagram ------------------------------------------------------------
//
// Mirrors igToItem:
//   ticketOpen = ticket_status === "open"
//   needsHuman = ticketOpen || status === "human"
//   bot        = status === "bot" && !ticketOpen
//   assignee   = assigned_to (no ticket_assignee fallback for IG)
//   mine       = !!assignee && assignee.toLowerCase() === me.toLowerCase()
export function igFilterPlan(filter: InboxFilter, me: string): FilterPlan {
  switch (filter) {
    case "human":
      return { type: "or", clause: "status.eq.human,ticket_status.eq.open" };
    case "bot":
      return {
        type: "eqOr",
        column: "status",
        value: "bot",
        clause: "ticket_status.is.null,ticket_status.neq.open",
      };
    case "mine":
      // A single-condition `.or()` is still valid PostgREST syntax and keeps
      // every quoted-value case going through the one `.or()` string parser
      // (see the FilterPlan doc comment above) instead of also relying on
      // the `.ilike()` builder method's own (unquoted) encoding.
      return { type: "or", clause: `assigned_to.ilike.${ilikeExact(me)}` };
    case "all":
    default:
      return { type: "none" };
  }
}

export function igMatchesSql(row: IgThreadRow, filter: InboxFilter, me: string): boolean {
  const ticketOpen = row.ticket_status === "open";
  switch (filter) {
    case "human":
      return row.status === "human" || ticketOpen;
    case "bot":
      return row.status === "bot" && !ticketOpen;
    case "mine":
      return !!row.assigned_to && row.assigned_to.toLowerCase() === me.toLowerCase();
    case "all":
    default:
      return true;
  }
}

// --- Support email ----------------------------------------------------
//
// Mirrors emailToItem:
//   draftReady = status === "pending" && should_reply !== false
//   needsHuman = draftReady
//   bot        = false always
//   assignee   = null always
export function emFilterPlan(filter: InboxFilter): FilterPlan {
  switch (filter) {
    case "human":
      return { type: "eqOr", column: "status", value: "pending", clause: "should_reply.is.null,should_reply.eq.true" };
    case "bot":
    case "mine":
      // emailToItem's bot/assignee are always false/null — no email can ever
      // satisfy these filters, so skip the query rather than run a doomed one.
      return { type: "skip" };
    case "all":
    default:
      return { type: "none" };
  }
}

export function emMatchesSql(row: EmailThreadRow, filter: InboxFilter): boolean {
  const draftReady = row.status === "pending" && row.should_reply !== false;
  switch (filter) {
    case "human":
      return draftReady;
    case "bot":
    case "mine":
      return false;
    case "all":
    default:
      return true;
  }
}
