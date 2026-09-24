// WhatsApp thread search clause, shared between src/app/api/whatsapp/threads/route.ts
// (the dashboard's WA thread list) and src/app/api/inbox/conversations/route.ts
// (the unified Inbox list) so both build the exact same PostgREST `.or()`
// clause string for a given query — one copy of the search rule, not two
// that can drift apart.
//
// Matches wa_id / last_message_snippet / ticket_subject / escalation_reason
// via ilike, plus an exact ticket_number match when the (leading-`#`-stripped)
// query is all digits — e.g. "#9793" or "9793" finds ticket #9793 even though
// ticket_number is an integer column that can't take ilike.
//
// Returns null (meaning: skip the filter entirely) when the sanitized query
// is empty, matching the callers' existing `if (safe) { ... }` behaviour.
export function waSearchOr(q: string): string | null {
  const like = ilikeContains(q);
  if (!like) return null;
  const clauses = [
    `wa_id.ilike.${like}`,
    `last_message_snippet.ilike.${like}`,
    `ticket_subject.ilike.${like}`,
    `escalation_reason.ilike.${like}`,
  ];
  // ticket_number is int4. A query that is all digits but larger than int4
  // (every 10-digit phone number) makes Postgres reject the WHOLE or-clause
  // with 22003 "out of range", so the search 500s instead of matching on
  // wa_id. Only add the numeric clause when the value actually fits.
  const digits = q.trim().replace(/^#/, "");
  if (/^\d+$/.test(digits) && Number(digits) <= 2147483647) {
    clauses.push(`ticket_number.eq.${digits}`);
  }
  return clauses.join(",");
}

// Instagram thread search clause — matches handle / full_name / last_message_snippet.
// Used by src/app/api/inbox/conversations/route.ts for both the list and
// counts passes so they can't drift apart from each other either.
export function igSearchOr(q: string): string | null {
  const like = ilikeContains(q);
  if (!like) return null;
  return `handle.ilike.${like},full_name.ilike.${like},last_message_snippet.ilike.${like}`;
}

// Support-email thread search clause — matches from_email / from_name / subject.
// Same sharing rationale as igSearchOr above.
export function emSearchOr(q: string): string | null {
  const like = ilikeContains(q);
  if (!like) return null;
  return `from_email.ilike.${like},from_name.ilike.${like},subject.ilike.${like}`;
}

// Wraps `value` as a double-quoted PostgREST literal, for embedding inside
// an `.or()` (or other raw filter) string whenever the value might contain
// characters PostgREST would otherwise try to parse as syntax — commas,
// parentheses, or an ISO timestamp's `:`/`+`. Escapes `\` and `"` with a
// backslash, per PostgREST's quoted-value rules.
export function quotePostgrestValue(value: string): string {
  return `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

// A "contains" match value for `.ilike.` inside a raw `.or()` string.
//
// The old approach was sanitizeSearch + `col.ilike.%${safe}%` unquoted, which
// had to STRIP `.` `,` `(` `)` `"` so PostgREST wouldn't read them as syntax.
// Stripping the dot silently broke the most useful search there is: an email
// address. "nisha@gmail.com" became "nisha@gmail com" and matched nothing, with
// no error to tell anyone. Quoting the value instead lets those characters
// through literally. `%` and `_` are escaped too, so searching "50%" means
// fifty-percent rather than a wildcard that matches half the table.
export function ilikeContains(q: string): string | null {
  const trimmed = q.trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`);
  return quotePostgrestValue(`%${escaped}%`);
}

// An *exact* (no-wildcard) case-insensitive match value for `.ilike()`, for a
// value like an email address that must match byte-for-byte. Escapes ILIKE's
// own metacharacters (`\`, `%`, `_`) so they match literally, then quotes the
// result for embedding in an `.or()` string.
export function ilikeExact(value: string): string {
  const patternEscaped = value.replace(/[\\%_]/g, (c) => `\\${c}`);
  return quotePostgrestValue(patternEscaped);
}
