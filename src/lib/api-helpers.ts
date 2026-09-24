// Shared helpers for src/app/api route handlers.

/**
 * Parse a JSON request body, returning null for malformed JSON or any payload
 * that is not a plain object (arrays, strings, numbers, booleans, null).
 * Rejecting non-objects protects `"field" in body` checks and property access
 * from throwing on primitive payloads. Callers should respond 400 on null.
 */
export async function parseBody<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  const body: unknown = await req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  return body as T;
}

/**
 * Strip PostgREST .or() syntax characters so user-supplied search text can't
 * break out of an `.or(`col.ilike.%${q}%`)` filter. Same pattern the
 * /api/contacts GET search has always used; callers should skip the filter
 * entirely when the sanitized string is empty.
 */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,()."\\]/g, " ").trim();
}

// A query-string integer, clamped so it can never reach Postgres as something
// the column cannot hold. total_orders and friends are int4: an out-of-range
// value makes Postgres reject the whole query with 22003, which is how a
// phone number pasted into the wrong filter box turns into a 500 rather than
// an empty result. NaN (a non-numeric param) falls back to `fallback`.
export const INT4_MAX = 2147483647;

export function intParam(raw: string | null, fallback: number, min = 0, max = INT4_MAX): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
