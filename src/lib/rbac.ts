// Pure RBAC logic (no server imports, so it is unit-testable). The server-side
// guards live in rbac-server.ts.
//
// Two effective access tiers (audit R4):
//   Admin  — manage team/settings/integrations, destructive deletes.
//   Member — day-to-day (inbox, campaigns, contacts CRUD except delete).
// Stored role values remain owner/admin/agent for back-compat with the team UI:
//   owner + admin (and a missing role) => Admin tier; agent => Member tier.

export type Tier = "admin" | "member";

export function tierOfRole(role: unknown): Tier {
  return role === "agent" || role === "member" ? "member" : "admin";
}

export function isAdminUser(
  u: { user_metadata?: Record<string, unknown> } | null | undefined,
): boolean {
  if (!u) return false;
  return tierOfRole((u.user_metadata || {}).role) === "admin";
}
