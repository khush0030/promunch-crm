import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAllowedEmail, ALLOWED_DOMAINS_LABEL } from "@/lib/auth-domains";
import { sendEmail } from "@/lib/resend";
import { inviteEmailHtml, inviteEmailSubject } from "@/lib/emails/invite";
import { recordAudit } from "@/lib/audit";
import { assertHuman } from "@/lib/botid-guard";
import { isAdminUser } from "@/lib/rbac";
import { resolveTeamDisplayName } from "@/lib/team";
import { isModuleKey, MODULE_KEYS, storedModules, type ModuleKey } from "@/lib/access";

function callerName(user: { email?: string | null; user_metadata?: Record<string, unknown> }): string {
  const meta = (user.user_metadata || {}) as Record<string, unknown>;
  return (
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    (user.email ? user.email.split("@")[0] : "A teammate")
  );
}

// Team management. An authenticated, allowed-domain caller with the Admin tier
// (app_metadata.role — see rbac.ts) can invite / list / remove users and change
// roles. Uses the service-role admin client for the privileged calls; the
// middleware additionally gates all /api/* with a session.
export const dynamic = "force-dynamic";

async function requireCaller() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedEmail(user.email)) return null;
  return user;
}

// Roles live in app_metadata.role (authoritative — users cannot edit their own
// app_metadata; user_metadata is self-editable and therefore never trusted).
// user_metadata.role is read as a DISPLAY fallback only until migration
// 008_roles_app_metadata backfills existing users. Enforcement (canManage) goes
// through isAdminUser, which is fail-closed.
type Role = "owner" | "admin" | "agent";
function roleOf(u: {
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}): Role {
  const r = (u.app_metadata || {}).role ?? (u.user_metadata || {}).role;
  return r === "owner" || r === "agent" ? r : "admin";
}
function canManage(u: Parameters<typeof isAdminUser>[0]): boolean {
  return isAdminUser(u);
}

type TeamUser = {
  id: string;
  email: string | null;
  name: string;
  role: Role;
  // Areas this member may use (lib/access.ts); null = every area.
  modules: ModuleKey[] | null;
  created_at: string;
  last_sign_in_at: string | null;
  confirmed: boolean;
};

export async function GET() {
  const caller = await requireCaller();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const users: TeamUser[] = data.users.map((u) => {
    return {
      id: u.id,
      email: u.email ?? null,
      name: resolveTeamDisplayName(u),
      role: roleOf(u),
      modules: storedModules(u),
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
    };
  });
  users.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  return NextResponse.json({
    users,
    currentUserId: caller.id,
    currentUserEmail: caller.email ?? null,
    currentUserRole: roleOf(caller),
    currentUserModules: storedModules(caller),
  });
}

export async function POST(req: NextRequest) {
  const bot = await assertHuman();
  if (bot) return bot;
  const caller = await requireCaller();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManage(caller)) return NextResponse.json({ error: "Only admins can invite members." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "That doesn't look like a valid email." }, { status: 400 });
  }
  if (!isAllowedEmail(email)) {
    return NextResponse.json(
      { error: `Only ${ALLOWED_DOMAINS_LABEL} email addresses can be added.` },
      { status: 400 }
    );
  }

  const origin = new URL(req.url).origin;

  // Mint the invite link ourselves (this also creates the auth user) so we can
  // deliver a branded PROMUNCH email via Resend instead of Supabase's default.
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      redirectTo: `${origin}/auth/callback?next=/auth/set-password`,
      data: name ? { full_name: name } : undefined,
    },
  });

  if (error) {
    // Most common: the user already exists.
    const already = /already.*registered|already been registered|exists/i.test(error.message);
    return NextResponse.json(
      { error: already ? "That email is already on the team." : error.message },
      { status: already ? 409 : 500 }
    );
  }

  const inviteToken = data?.properties?.hashed_token;
  const inviteUrl = inviteToken
    ? `${origin}/auth/callback?token_hash=${encodeURIComponent(inviteToken)}&type=invite&next=/auth/set-password`
    : null;
  if (!inviteUrl) {
    return NextResponse.json({ error: "Could not generate an invite link." }, { status: 500 });
  }

  // New members start at the Member tier (app_metadata is the authoritative
  // role store); an admin can promote them from the Team screen.
  if (data?.user?.id) {
    await supabaseAdmin.auth.admin
      .updateUserById(data.user.id, { app_metadata: { role: "agent" } })
      .catch(() => {});
  }

  try {
    const inviterName = callerName(caller);
    await sendEmail({
      to: email,
      subject: inviteEmailSubject(),
      html: inviteEmailHtml({ inviteUrl, inviterName, recipientName: name || undefined }),
      replyTo: caller.email || undefined,
    });
  } catch (e) {
    // The auth user now exists but the email failed to go out. Roll it back so a
    // retry isn't blocked by a "already on the team" 409.
    if (data?.user?.id) {
      await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => {});
    }
    return NextResponse.json(
      { error: `Couldn't send the invite email: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 502 }
    );
  }

  await recordAudit({
    action: "team.invite",
    entityType: "user",
    entityId: data?.user?.id,
    summary: `Invited ${email} to the team`,
    metadata: { email, name: name || null },
    actor: caller,
    request: req,
  });

  return NextResponse.json({ ok: true });
}

// Change a member's role (owner/admin/agent) and/or the areas they can use
// (`modules`: a list of area keys, or null for every area). Admins only; you
// can't change your own access (prevents the last admin locking themselves out).
export async function PATCH(req: NextRequest) {
  const bot = await assertHuman();
  if (bot) return bot;
  const caller = await requireCaller();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManage(caller)) return NextResponse.json({ error: "Only admins can change roles." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing user id." }, { status: 400 });
  if (id === caller.id) return NextResponse.json({ error: "You can't change your own access." }, { status: 400 });

  if (body && "modules" in body && !("role" in body)) return setModules(req, caller, id, body.modules);

  const role = String(body?.role ?? "");
  if (!["owner", "admin", "agent"].includes(role)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const { data: target } = await supabaseAdmin.auth.admin.getUserById(id);
  const prevRole = roleOf(target.user ?? {});
  // app_metadata is authoritative; user_metadata mirrors it for legacy display.
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
    app_metadata: { ...(target.user?.app_metadata ?? {}), role },
    user_metadata: { ...(target.user?.user_metadata ?? {}), role },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    action: "team.role_change",
    entityType: "user",
    entityId: id,
    summary: `Changed ${target.user?.email ?? id} role: ${prevRole} → ${role}`,
    metadata: { from: prevRole, to: role, email: target.user?.email ?? null },
    actor: caller,
    request: req,
  });

  return NextResponse.json({ ok: true });
}

async function setModules(
  req: NextRequest,
  caller: NonNullable<Awaited<ReturnType<typeof requireCaller>>>,
  id: string,
  raw: unknown
) {
  if (raw !== null && (!Array.isArray(raw) || !raw.every(isModuleKey))) {
    return NextResponse.json({ error: "Invalid areas." }, { status: 400 });
  }
  // Canonical order, no duplicates. null clears the restriction (every area).
  const modules: ModuleKey[] | null = raw === null ? null : MODULE_KEYS.filter((k) => (raw as unknown[]).includes(k));

  const { data: target } = await supabaseAdmin.auth.admin.getUserById(id);
  if (!target.user) return NextResponse.json({ error: "No such member." }, { status: 404 });
  const prev = storedModules(target.user);
  const meta: Record<string, unknown> = { ...(target.user.app_metadata ?? {}) };
  // GoTrue merges app_metadata keys, so clearing needs an explicit null.
  meta.modules = modules;
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: meta });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const label = (m: ModuleKey[] | null) => (m === null ? "all areas" : m.length ? m.join(", ") : "no areas");
  await recordAudit({
    action: "team.access_change",
    entityType: "user",
    entityId: id,
    summary: `Changed ${target.user.email ?? id} access: ${label(prev)} → ${label(modules)}`,
    metadata: { from: prev, to: modules, email: target.user.email ?? null },
    actor: caller,
    request: req,
  });

  return NextResponse.json({ ok: true, modules });
}

export async function DELETE(req: NextRequest) {
  const bot = await assertHuman();
  if (bot) return bot;
  const caller = await requireCaller();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManage(caller)) return NextResponse.json({ error: "Only admins can remove members." }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing user id." }, { status: 400 });
  if (id === caller.id) {
    return NextResponse.json({ error: "You can't remove yourself." }, { status: 400 });
  }

  const { data: target } = await supabaseAdmin.auth.admin.getUserById(id);
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    action: "team.remove",
    entityType: "user",
    entityId: id,
    summary: `Removed ${target.user?.email ?? id} from the team`,
    metadata: { email: target.user?.email ?? null },
    actor: caller,
    request: req,
  });

  return NextResponse.json({ ok: true });
}
