// Relative imports, not the "@/" alias: vitest.config.ts has no path-alias
// resolver, and this file (and its test) run directly under vitest.
import { sanitizeSearch } from "../api-helpers";

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
  const safe = sanitizeSearch(q);
  if (!safe) return null;
  const clauses = [
    `wa_id.ilike.%${safe}%`,
    `last_message_snippet.ilike.%${safe}%`,
    `ticket_subject.ilike.%${safe}%`,
    `escalation_reason.ilike.%${safe}%`,
  ];
  const digits = safe.replace(/^#/, "");
  if (/^\d+$/.test(digits)) clauses.push(`ticket_number.eq.${digits}`);
  return clauses.join(",");
}

// Instagram thread search clause — matches handle / full_name / last_message_snippet.
// Used by src/app/api/inbox/conversations/route.ts for both the list and
// counts passes so they can't drift apart from each other either.
export function igSearchOr(q: string): string | null {
  const safe = sanitizeSearch(q);
  if (!safe) return null;
  return `handle.ilike.%${safe}%,full_name.ilike.%${safe}%,last_message_snippet.ilike.%${safe}%`;
}

// Support-email thread search clause — matches from_email / from_name / subject.
// Same sharing rationale as igSearchOr above.
export function emSearchOr(q: string): string | null {
  const safe = sanitizeSearch(q);
  if (!safe) return null;
  return `from_email.ilike.%${safe}%,from_name.ilike.%${safe}%,subject.ilike.%${safe}%`;
}
