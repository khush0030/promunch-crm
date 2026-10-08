import { OWNER_EMAIL } from "@/lib/rbac";

/** Same owner rule as the shell (useShellData): the owner email or an explicit "owner" role. */
export function isOwnerMember(m: { email?: string | null; role?: string | null }): boolean {
  return (m.email ?? "").toLowerCase() === OWNER_EMAIL || m.role === "owner";
}

/** The role to show in the team list: "owner" for the owner, otherwise the stored role. */
export function displayRole(m: { email?: string | null; role?: string | null }): string {
  return isOwnerMember(m) ? "owner" : (m.role ?? "");
}
