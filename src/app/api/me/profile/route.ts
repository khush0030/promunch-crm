import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { recordAudit } from "@/lib/audit";
import { resolveTeamDisplayName } from "@/lib/team";
import { avatarUrlOf, validateAvatarUrl, validateProfileName } from "@/lib/profile";
import { meOrNull } from "../caller";

// My profile: every signed-in member reads and edits their OWN name and
// photo (auth user_metadata.full_name / avatar_url). The target is always the
// session user; no id is accepted from the body. Mapped open in lib/access.ts.
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await meOrNull();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const meta = (me.user_metadata || {}) as Record<string, unknown>;
  return NextResponse.json({
    id: me.id,
    email: me.email ?? null,
    full_name: typeof meta.full_name === "string" ? meta.full_name : "",
    display_name: resolveTeamDisplayName(me),
    avatar_url: avatarUrlOf(meta),
  });
}

export async function PATCH(req: NextRequest) {
  const me = await meOrNull();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await parseBody<{ full_name?: unknown; avatar_url?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  if (!("full_name" in body) && !("avatar_url" in body)) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ("full_name" in body) {
    const n = validateProfileName(body.full_name);
    if (!n.ok) return NextResponse.json({ error: n.error }, { status: 400 });
    patch.full_name = n.value;
  }
  if ("avatar_url" in body) {
    const a = validateAvatarUrl(body.avatar_url, me.id, process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (!a.ok) return NextResponse.json({ error: a.error }, { status: 400 });
    patch.avatar_url = a.value;
  }

  // Merge over the stored metadata (fresh from the admin API, not the cookie
  // copy) so other user_metadata keys survive.
  const { data: fresh, error: readErr } = await supabaseAdmin.auth.admin.getUserById(me.id);
  if (readErr || !fresh?.user) return NextResponse.json({ error: readErr?.message ?? "Could not load your profile." }, { status: 500 });
  const existing = (fresh.user.user_metadata || {}) as Record<string, unknown>;
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(me.id, { user_metadata: { ...existing, ...patch } });
  if (error || !data?.user) return NextResponse.json({ error: error?.message ?? "Save failed." }, { status: 500 });

  await recordAudit({
    action: "profile.update",
    entityType: "user",
    entityId: me.id,
    summary: `Updated own profile (${Object.keys(patch).join(", ")})`,
    actor: me,
    request: req,
  });

  const meta = (data.user.user_metadata || {}) as Record<string, unknown>;
  return NextResponse.json({
    ok: true,
    full_name: typeof meta.full_name === "string" ? meta.full_name : "",
    display_name: resolveTeamDisplayName(data.user),
    avatar_url: avatarUrlOf(meta),
  });
}
