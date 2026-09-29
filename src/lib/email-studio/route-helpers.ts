// Shared bits for /api/email-studio/* routes. The middleware already gates
// these on a session + the email_marketing area; routes add who-did-it and
// the admin checks for approvals and settings.

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getCaller } from "@/lib/rbac-server";
import { isAdminUser } from "@/lib/rbac";

export type Caller = { user: User; email: string; admin: boolean };

export async function caller(): Promise<Caller | NextResponse> {
  const user = await getCaller();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return { user, email: user.email ?? "", admin: isAdminUser(user) };
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

export function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status });
}

/** Postgres "relation/column does not exist" → migration 016 not applied yet. */
export function migrationHint(message: string): string {
  return /does not exist|schema cache/i.test(message)
    ? `${message}. Email Studio needs migrations 016 and 017 (supabase/migrations) applied.`
    : message;
}
