// Cursor helpers for the unified Inbox conversation list (Task 2.3). The
// cursor encodes the last item returned on the previous page as
// `${at}|${key}`, the same (at desc, key asc) order `compareItems`/
// `mergeItems` already use in conversations.ts. `key` is `${channelPrefix}-${id}`
// (e.g. "wa-7449b43e-..."), so a channel's own id can always be recovered by
// splitting on the first "-" — the channel prefix itself never contains one.

import { mergeItems, compareItems, type InboxItem } from "./conversations";

export type Cursor = { at: string; key: string };

// Parses a `${at}|${key}` cursor string. Returns null for anything malformed
// so callers can treat it the same as "no cursor" (first page) instead of
// erroring on a bad query param.
export function parseCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  const idx = raw.indexOf("|");
  if (idx < 0) return null;
  const at = raw.slice(0, idx);
  const key = raw.slice(idx + 1);
  if (!at || !key) return null;
  return { at, key };
}

// True if (at, key) sorts strictly after the cursor under compareItems' order
// (at desc, key asc) — i.e. it belongs on the next page, not this one. A null
// cursor (first page) always passes. Kept as a small standalone predicate
// (used by channelCursorBound's own reasoning, and available for tests/other
// callers) even though fix round 2's route no longer needs to run it over
// fetched rows — SQL now enforces the bound directly (see channelCursorBound).
export function isAfterCursor(at: string, key: string, cursor: Cursor | null): boolean {
  if (!cursor) return true;
  if (at !== cursor.at) return at < cursor.at; // earlier `at` sorts later (desc)
  return key > cursor.key; // same `at`, key is the asc tiebreak
}

// Fix round 2 (review): round 1 bounded each channel's fetch with a plain
// `.lte(atColumn, cursor.at)` and then trimmed the result with isAfterCursor
// in memory. That's tie-*safe* for a single page, but wasteful (fetches rows
// it then throws away) and — combined with the old "+10 window, take first
// limit" approach — could still miss rows when more than `limit` rows shared
// the cursor's exact `at`. This computes the *exact* SQL bound instead, so a
// channel's query returns precisely the rows that belong after the cursor,
// nothing more.
export type CursorBound =
  | { op: "none" } // no cursor (first page): no bound
  | { op: "lt"; value: string } // at < value — every at===value row for this channel sorts BEFORE the cursor
  | { op: "lte"; value: string } // at <= value — every at===value row for this channel sorts AFTER the cursor
  | { op: "tuple"; value: string; id: string }; // at < value OR (at = value AND id > id) — same channel as the cursor

// Decides, for one channel, which of the three shapes above its cursor bound
// takes. The channel's own rows are ordered (at desc, id asc) by SQL, and
// `key = "<prefix>-<id>"` with a constant prefix per channel means "id asc"
// within a channel is exactly "key asc" — the same tiebreak compareItems
// uses across channels.
//
// The subtlety: the cursor's `at` might come from a *different* channel than
// the one being queried now (e.g. the last item on the previous page was a
// WA thread, and we're now bounding the IG query). For rows in THIS channel
// with `at === cursor.at`, whether they belong before or after the cursor
// depends only on how this channel's prefix compares to the cursor's prefix
// — because in the global (at desc, key asc) merge order, when `at` ties,
// everything is decided by `key`, and key comparison across channels checks
// the prefix first ("em" < "ig" < "wa" lexically) before ever looking at the
// id. So:
//   - this channel's prefix > cursor's prefix: every at===cursor.at row here
//     sorts after the cursor (its key is bigger no matter the id) → `lte`.
//   - this channel's prefix < cursor's prefix: every at===cursor.at row here
//     sorts before the cursor → `lt`.
//   - same prefix as the cursor: id decides, hence the `tuple` bound.
export function channelCursorBound(channelPrefix: string, cursor: Cursor | null): CursorBound {
  if (!cursor) return { op: "none" };
  const dashIdx = cursor.key.indexOf("-");
  const cursorPrefix = dashIdx < 0 ? cursor.key : cursor.key.slice(0, dashIdx);
  const cursorId = dashIdx < 0 ? "" : cursor.key.slice(dashIdx + 1);

  if (channelPrefix === cursorPrefix) return { op: "tuple", value: cursor.at, id: cursorId };
  if (channelPrefix > cursorPrefix) return { op: "lte", value: cursor.at };
  return { op: "lt", value: cursor.at };
}

// One channel's page-worth of rows, plus whether the raw SQL fetch (before
// any consistency-check drops) came back exactly `limit` long — meaning
// there might be more beyond what was fetched. `truncated` must be computed
// from the RAW fetch, not the post-drop `items` length, so a consistency
// mismatch can never accidentally suppress a real "there's more" signal (or
// fabricate one).
export type ChannelPage = { items: InboxItem[]; truncated: boolean };

// Turns each channel's already-filtered, already-cursor-bounded page (each
// channel query now fetches exactly `limit` rows — no over-fetch window) into
// one merged page + a nextCursor decision.
//
// Correctness of the nextCursor decision: a channel's own rows are re-sorted
// with compareItems (defensive — see the comment on that function in
// conversations.ts: it guards against a channel's SQL order column and its
// InboxItem `at` occasionally disagreeing, e.g. an IG row that fell back
// from last_activity_at to created_at) and capped to `limit` before merging,
// so nothing beyond a channel's own top `limit` (by the true merge order)
// ever competes for a page slot. nextCursor is non-null when either:
//   - the merged candidate pool (summed across channels, pre-cap) is bigger
//     than what actually fit on this page (some rows got pushed to the next
//     page), or
//   - any channel was `truncated` (its raw fetch hit exactly `limit`) — that
//     channel might have more rows beyond what was fetched, even if none of
//     its rows made this particular page.
// Every row a channel doesn't return this round is <= its own last returned
// row's `at`/key, which is <= everything that made the page, so nothing is
// ever silently lost — it just arrives on a later page once the cursor moves
// past it (the next fetch re-queries every channel from the new cursor).
export function pageFromChannels(
  channelRows: ChannelPage[],
  cursor: Cursor | null,
  limit: number,
): { items: InboxItem[]; nextCursor: string | null } {
  const anyTruncated = channelRows.some((c) => c.truncated);
  const sorted = channelRows.map((c) => [...c.items].sort(compareItems));
  const totalCandidates = sorted.reduce((n, rows) => n + rows.length, 0);
  const capped = sorted.map((rows) => rows.slice(0, limit));
  const items = mergeItems(capped, limit);

  const more = anyTruncated || totalCandidates > items.length;
  const last = items[items.length - 1];
  // Never emit a cursor built from an item with no `at` (conversations.ts
  // already excludes these before they reach here, but this is the last
  // line of defense so a future caller can't accidentally leak a broken one).
  const nextCursor = more && last && last.at ? `${last.at}|${last.key}` : null;

  return { items, nextCursor };
}
