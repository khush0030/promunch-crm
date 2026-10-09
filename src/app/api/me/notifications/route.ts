import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { applyNotifPatch, readNotifState, type NotifPatch } from "@/lib/notifications/state";
import { meOrNull } from "../caller";

// My notifications: read state + preferences for the header bell, stored in
// the caller's OWN auth user_metadata.notifications. The target is always the
// session user; no id is accepted from the body. Mapped open in lib/access.ts.
//
// PATCH { mark_all_read?: true, read?: string[], dismiss?: string[],
//         prefs?: { sound?, popups?, needs_you?, issues? } }
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await meOrNull();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(readNotifState(me.user_metadata as Record<string, unknown>));
}

export async function PATCH(req: NextRequest) {
  const me = await meOrNull();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await parseBody<NotifPatch>(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });

  // Merge over the stored metadata (fresh from the admin API, not the cookie
  // copy) so other user_metadata keys (name, photo) survive.
  const { data: fresh, error: readErr } = await supabaseAdmin.auth.admin.getUserById(me.id);
  if (readErr || !fresh?.user) return NextResponse.json({ error: readErr?.message ?? "Could not load your settings." }, { status: 500 });
  const existing = (fresh.user.user_metadata || {}) as Record<string, unknown>;

  const next = applyNotifPatch(readNotifState(existing), body, new Date());
  if (!next.ok) return NextResponse.json({ error: next.error }, { status: 400 });

  const { error } = await supabaseAdmin.auth.admin.updateUserById(me.id, {
    user_metadata: { ...existing, notifications: next.value },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...next.value });
}
