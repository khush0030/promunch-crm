import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAllowedEmail } from "@/lib/auth-domains";
import { isAdminUser } from "@/lib/rbac";

// Server-side RBAC guards (import only from server routes). The pure tier logic
// lives in rbac.ts so it can be unit-tested without the Next server runtime.

// The current allowed-domain, signed-in user (or null).
export async function getCaller(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedEmail(user.email)) return null;
  return user;
}

type AdminGate = { ok: true; user: User } | { ok: false; response: NextResponse };

// Use at the top of an Admin-only route handler:
//   const gate = await requireAdmin();
//   if (!gate.ok) return gate.response;
export async function requireAdmin(): Promise<AdminGate> {
  const user = await getCaller();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!isAdminUser(user)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "forbidden: admin only" }, { status: 403 }),
    };
  }
  return { ok: true, user };
}
