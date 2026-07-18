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
