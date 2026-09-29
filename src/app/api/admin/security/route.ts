import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { resolveTeamDisplayName } from "@/lib/team";
import { storedModules } from "@/lib/access";
import { isAdminUser, OWNER_EMAIL, roleOfUser } from "@/lib/rbac";
import { describeDevice } from "@/lib/device";

export const dynamic = "force-dynamic";

// Admin security overview: every team member with their last sign-in, last
// activity, IP and device, plus every live session. Admin/Owner only — this
// is teammates' IP addresses.
//
// Sources: auth.users (via the admin API), live auth.sessions (via the
// admin_auth_sessions() function, migration 015) and the 'auth.login' rows the
// migration's trigger writes into audit_log. If 015 is not applied yet the
// session parts come back empty with sessionsAvailable=false.

type SessionRow = {
  id: string;
  user_id: string;
  email: string | null;
  created_at: string;
  last_active_at: string | null;
  ip: string | null;
  user_agent: string | null;
  aal: string | null;
  not_after: string | null;
};

type LoginRow = { actor_id: string | null; ip: string | null; metadata: { user_agent?: string } | null; created_at: string };

const DAY = 86_400_000;

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const [usersRes, sessionsRes, loginsRes] = await Promise.all([
    supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    supabaseAdmin.rpc("admin_auth_sessions"),
    supabaseAdmin
      .from("audit_log")
      .select("actor_id, ip, metadata, created_at")
      .eq("action", "auth.login")
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);
  if (usersRes.error) return NextResponse.json({ error: usersRes.error.message }, { status: 500 });

  const sessionsAvailable = !sessionsRes.error;
  const sessions = ((sessionsRes.data ?? []) as SessionRow[]).map((s) => ({
    ...s,
    device: describeDevice(s.user_agent),
  }));
  const logins = (loginsRes.data ?? []) as LoginRow[];

  const users = usersRes.data.users.map((u) => {
    const mine = sessions.filter((s) => s.user_id === u.id);
    const latestSession = mine[0] ?? null; // ordered by last activity desc
    const myLogins = logins.filter((l) => l.actor_id === u.id);
    const lastLogin = myLogins[0] ?? null;
    const lastActive = [latestSession?.last_active_at, u.last_sign_in_at].filter(Boolean).sort().pop() ?? null;
    const role = roleOfUser(u);
    return {
      id: u.id,
      email: u.email ?? null,
      name: resolveTeamDisplayName(u),
      role: (u.email ?? "").toLowerCase() === OWNER_EMAIL ? "owner" : role === "owner" || role === "admin" ? String(role) : "agent",
      admin: isAdminUser(u),
      modules: storedModules(u),
      created_at: u.created_at,
      invited_at: u.invited_at ?? null,
      confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
      last_sign_in_at: u.last_sign_in_at ?? null,
      last_active_at: lastActive,
      last_ip: latestSession?.ip ?? lastLogin?.ip ?? null,
      last_device: latestSession ? latestSession.device : lastLogin ? describeDevice(lastLogin.metadata?.user_agent) : null,
      active_sessions: mine.length,
      logins_30d: myLogins.filter((l) => l.created_at >= since).length,
      distinct_ips_30d: new Set(myLogins.filter((l) => l.created_at >= since && l.ip).map((l) => l.ip)).size,
    };
  });
  users.sort((a, b) => (b.last_active_at ?? "").localeCompare(a.last_active_at ?? ""));

  return NextResponse.json({ users, sessions, sessionsAvailable });
}
