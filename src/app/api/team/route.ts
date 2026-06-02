import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAllowedEmail, ALLOWED_DOMAINS_LABEL } from "@/lib/auth-domains";

// Team management. Every member who can sign in gets full access — there are no
// roles. This route only lets an already-authenticated, allowed-domain user
// invite / list / remove other users. It uses the service-role admin client for
// the privileged calls, so the caller's own session is verified first (the
// middleware does NOT gate /api/*).
export const dynamic = "force-dynamic";

async function requireCaller() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedEmail(user.email)) return null;
  return user;
}

type TeamUser = {
  id: string;
  email: string | null;
  name: string;
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
    const meta = (u.user_metadata || {}) as Record<string, unknown>;
    const name =
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      (u.email ? u.email.split("@")[0] : "User");
    return {
      id: u.id,
      email: u.email ?? null,
      name,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
    };
  });
  users.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  return NextResponse.json({ users, currentUserId: caller.id });
}

export async function POST(req: NextRequest) {
  const caller = await requireCaller();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/dashboard`,
    data: name ? { full_name: name } : undefined,
  });

  if (error) {
    // Most common: the user already exists.
    const already = /already.*registered|already been registered|exists/i.test(error.message);
    return NextResponse.json(
      { error: already ? "That email is already on the team." : error.message },
      { status: already ? 409 : 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const caller = await requireCaller();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing user id." }, { status: 400 });
  if (id === caller.id) {
    return NextResponse.json({ error: "You can't remove yourself." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
