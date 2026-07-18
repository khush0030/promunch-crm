// Pure RBAC logic (no server imports, so it is unit-testable). The server-side
// guards live in rbac-server.ts.
//
// Two effective access tiers (audit R4):
//   Admin  — manage team/settings/integrations, destructive deletes.
//   Member — day-to-day (inbox, campaigns, contacts CRUD except delete).
// Stored role values remain owner/admin/agent for back-compat with the team UI.
//
// SECURITY (audit 2026-07-18): roles are read from app_metadata ONLY. GoTrue
// lets any signed-in user rewrite their own user_metadata with the public anon
// key, so a role stored there is attacker-controlled (self-escalation). The
// tier default is fail-closed: no explicit owner/admin role => Member. The
// migration 008_roles_app_metadata backfills app_metadata.role for existing
// users; the owner email is additionally always Admin so a missed backfill can
// never lock the owner out.

export type Tier = "admin" | "member";

export const OWNER_EMAIL = (process.env.SECRETS_OWNER_EMAIL || "kmutha@vippysoya.com").toLowerCase();

export function tierOfRole(role: unknown): Tier {
  return role === "owner" || role === "admin" ? "admin" : "member";
}

export type RbacUser = {
  email?: string | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
} | null | undefined;

// The authoritative stored role. user_metadata is deliberately ignored.
export function roleOfUser(u: RbacUser): unknown {
  if (!u) return undefined;
  return (u.app_metadata || {}).role;
}

export function isAdminUser(u: RbacUser): boolean {
  if (!u) return false;
  if ((u.email ?? "").toLowerCase() === OWNER_EMAIL) return true;
  return tierOfRole(roleOfUser(u)) === "admin";
}
