// The Instagram pipeline tables (ig_prospects, ig_followups,
// ig_discovery_runs, ...) are not migrated in prod yet. A read against a
// missing table is "not switched on", not a server failure: answer 200
// { off: true } so it doesn't land in logs/Sentry as a 500 on every
// Creators visit. The client (src/components/creators/ig.ts) shows
// "Not switched on yet" for it.

type PgError = { code?: string | null; message?: string | null } | null | undefined;

export function isMissingTable(err: PgError): boolean {
  if (!err) return false;
  if (err.code === "PGRST205" || err.code === "42P01") return true;
  return /schema cache|does not exist|Could not find the table/i.test(err.message ?? "");
}

export const IG_OFF_BODY = { off: true, error: "Instagram is not switched on yet" } as const;
