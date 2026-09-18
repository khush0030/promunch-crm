// Shared team-member display-name rule (Task 2.6 fix round 1). Both
// GET /api/team (src/app/api/team/route.ts) and the Tickets board API
// (src/app/api/inbox/tickets/route.ts) must show the exact same name for
// the same person — the Assign dropdown comes from /api/team, "With
// {name}" comes from the tickets board — so this is the one place the rule
// lives. Pure function, no fetch/Supabase here.

export type TeamAuthUser = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

// user_metadata.full_name, then .name, then the email local part (as-is,
// not capitalised — this must stay byte-identical to what /api/team has
// always returned, since other screens depend on it), then "User" for a
// user with no email at all.
export function resolveTeamDisplayName(user: TeamAuthUser): string {
  const meta = (user.user_metadata || {}) as Record<string, unknown>;
  return (
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    (user.email ? user.email.split("@")[0] : "User")
  );
}
