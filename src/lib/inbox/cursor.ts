// Cursor helpers for the unified Inbox conversation list (Task 2.3). The
// cursor encodes the last item returned on the previous page as
// `${at}|${key}`, the same (at desc, key asc) order `mergeItems`/`nextCursor`
// already use in conversations.ts. Paging forward means "strictly after this
// point in that order" — this keeps ties on `at` from being re-shown or
// dropped across a page boundary.

import { mergeItems, type InboxItem } from "./conversations";

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

// True if (at, key) sorts strictly after the cursor under mergeItems' order
// (at desc, key asc) — i.e. it belongs on the next page, not this one. A null
// cursor (first page) always passes.
export function isAfterCursor(at: string, key: string, cursor: Cursor | null): boolean {
  if (!cursor) return true;
  if (at !== cursor.at) return at < cursor.at; // earlier `at` sorts later (desc)
  return key > cursor.key; // same `at`, key is the asc tiebreak
}

// Turns each channel's already-filtered, already-cursor-bounded rows into one
// page + a nextCursor decision. Callers (src/app/api/inbox/conversations)
// fetch each channel with the requested filter pushed into SQL, bound the
// fetch to `limit + 10` rows `lte` the cursor's `at`, and then run
// `isAfterCursor` over the result — that "after-cursor" array (NOT yet capped
// to `limit`, and NOT yet sorted against the other channels) is what goes in
// `channelRows[i]` here.
//
// Correctness of the nextCursor decision: each channel's rows arrive ordered
// `at` desc (the SQL query orders that way), so taking only the first `limit`
// rows from a channel and discarding the rest is safe — every discarded row
// has an `at` <= the `limit`-th row we kept, which itself is <= every row
// that *did* make the final merged page from any channel (a channel only
// gets outcompeted for a merged page slot by rows with an equal-or-later
// `at`). So nothing discarded here is newer than the page's last item: it
// belongs strictly after this page, not on it, and will be picked up again
// on the next fetch once the cursor moves past this page's last item (the
// next fetch re-queries every channel from that new cursor, including the
// previously-untaken tail of whichever channel got capped).
//
// nextCursor is non-null when either:
//   - the total after-cursor rows across all channels exceeds what fit on
//     this page (some rows were pushed to the next page by the global sort +
//     limit slice), or
//   - any single channel's after-cursor array already reached `limit` rows
//     within its own fetch window — meaning that channel might have more
//     beyond what we fetched, even if none of them made this page.
// Only when neither holds do we know every channel is fully drained down to
// (and past) the cursor, so there is nothing left to page to.
export function pageFromChannels(
  channelRows: InboxItem[][],
  cursor: Cursor | null,
  limit: number,
): { items: InboxItem[]; nextCursor: string | null } {
  const hasMoreAny = channelRows.some((rows) => rows.length >= limit && limit > 0);
  const totalAvailable = channelRows.reduce((n, rows) => n + rows.length, 0);
  const sliced = channelRows.map((rows) => rows.slice(0, limit));
  const items = mergeItems(sliced, limit);

  const more = hasMoreAny || totalAvailable > items.length;
  const last = items[items.length - 1];
  // Never emit a cursor built from an item with no `at` (conversations.ts
  // already excludes these before they reach here, but this is the last
  // line of defense so a future caller can't accidentally leak a broken one).
  const nextCursor = more && last && last.at ? `${last.at}|${last.key}` : null;

  return { items, nextCursor };
}
