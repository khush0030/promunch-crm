import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { resolveTeamDisplayName } from "@/lib/team";
import { dealActor } from "@/lib/deals/session";
import type { TeamPerson } from "@/lib/deals/model";

export const dynamic = "force-dynamic";

// Team members for the deal "Owner" picker: just name + email (no roles or
// access details, unlike /api/team). Includes who is asking as `me`.
export async function GET() {
  const who = await dealActor();
  if ("denied" in who) return who.denied;

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const people: TeamPerson[] = data.users
    .filter((u) => !!u.email)
    .map((u) => ({ email: u.email!.toLowerCase(), name: resolveTeamDisplayName(u) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ people, me: who.actor.email });
}
