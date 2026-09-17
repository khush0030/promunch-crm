// Cursor helpers for the unified Inbox conversation list (Task 2.3). The
// cursor encodes the last item returned on the previous page as
// `${at}|${key}`, the same (at desc, key asc) order `mergeItems`/`nextCursor`
// already use in conversations.ts. Paging forward means "strictly after this
// point in that order" — this keeps ties on `at` from being re-shown or
// dropped across a page boundary.

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
