// Who is calling a /api/deals route. Same gate as requireSession (a signed-in
// dashboard user), but also returns the email so activity entries carry an
// author. The middleware additionally enforces the "partners" area.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveTeamDisplayName } from "@/lib/team";

export type DealActor = { email: string | null; name: string };

export async function dealActor(): Promise<{ actor: DealActor } | { denied: NextResponse }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { denied: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { actor: { email: user.email?.toLowerCase() ?? null, name: resolveTeamDisplayName(user) } };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
