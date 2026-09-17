// Cursor helpers for the unified Inbox conversation list (Task 2.3). The
// cursor encodes the last item returned on the previous page as
// `${at}|${key}`, the same (at desc, key asc) order `compareItems`/
// `mergeItems` already use in conversations.ts. `key` is `${channelPrefix}-${id}`
// (e.g. "wa-7449b43e-..."), so a channel's own id can always be recovered by
// splitting on the first "-" — the channel prefix itself never contains one.

import { mergeItems, compareItems, type AtKey, type InboxItem } from "./conversations";

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

// Each channel query is bounded by an exact SQL condition instead of a
// looser bound trimmed in memory, so a channel returns precisely the rows
// that belong after the cursor — nothing more, nothing dropped.
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

// One channel's page-worth of rows, plus:
//   - `truncated`: whether the raw SQL fetch (before any consistency-check
//     drops) came back longer than `limit` — meaning there might be more
//     beyond what was fetched. Computed from the RAW fetch, not the
//     post-drop `items` length, so a dropped row can never suppress or
//     fabricate a "there's more" signal.
//   - `rawLast`: the (at, key) of the last row this channel's raw fetch
//     considered this round (after capping to `limit`, before any
//     hasAt/consistency-check drops), or null if the raw fetch was empty.
//     Used only as a cursor-boundary fallback (see pageFromChannels) for the
//     edge case where every row this channel fetched got dropped, so none of
//     them appear in `items` to anchor a cursor on.
export type ChannelPage = { items: InboxItem[]; truncated: boolean; rawLast: AtKey | null };

// Turns each channel's already-filtered, already-cursor-bounded page into
// one merged page + a nextCursor decision.
//
// Correctness of the nextCursor decision: a channel's own rows are re-sorted
// with compareItems (defensive: guards against a channel's SQL order column
// and its InboxItem `at` occasionally disagreeing) and capped to `limit`
// before merging, so nothing beyond a channel's own top `limit` (by the true
// merge order) ever competes for a page slot. `more` is true when either the
// merged candidate pool (summed across channels, pre-cap) is bigger than
// what actually fit on this page, or any channel was truncated.
//
// When `items` is non-empty, its own last entry is always the correct
// boundary — every candidate a channel didn't get onto the page (whether
// cut by the per-channel cap or by losing the global sort) is guaranteed to
// sort after it, so resuming from it next round can't skip anything. A
// channel's `rawLast` must NOT be blended into that choice: a truncated
// channel's rawLast can be further along than the page's actual last item
// (e.g. the channel had 3 candidates for a page of 2), and treating it as a
// valid boundary would make the next round's cursor bound skip that
// channel's own not-yet-shown rows between the two points — a real bug an
// earlier draft of this function had.
//
// `rawLast` exists for exactly one edge case: `items` is completely empty
// (every channel's raw fetch this round, if it had one, got entirely
// dropped by hasAt/the matchesFilter consistency guard in the route) but
// `more` is still true because a channel was truncated. There's no visible
// item to anchor a cursor on, so pick the LEAST advanced truncated channel's
// `rawLast` — the most conservative choice, since a MORE advanced channel
// will just redundantly (but harmlessly) re-examine the range it already
// dropped on the next round, while a less-advanced choice could skip real,
// never-yet-fetched rows for whichever channel didn't get that far.
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

  const lastItem = items[items.length - 1];
  let boundary: AtKey | null = lastItem ?? null;
  if (!boundary) {
    const truncatedRawLasts = channelRows
      .filter((c): c is ChannelPage & { rawLast: AtKey } => c.truncated && c.rawLast !== null)
      .map((c) => c.rawLast);
    truncatedRawLasts.sort(compareItems);
    boundary = truncatedRawLasts[0] ?? null; // least advanced — see the comment above
  }

  // Never emit a cursor built from an item/boundary with no `at`.
  const nextCursor = more && boundary && boundary.at ? `${boundary.at}|${boundary.key}` : null;

  return { items, nextCursor };
}
