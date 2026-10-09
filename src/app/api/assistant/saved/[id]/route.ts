// Ask Maya → one saved answer: pin/unpin, rename, share (PATCH) and delete.
// Only the person who saved it, or an admin, may change it.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isAdminUser } from "@/lib/rbac";
import { canEdit, isMissingTable } from "@/lib/assistant/saved";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function gate(id: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!UUID_RE.test(id)) return { res: NextResponse.json({ error: "not found" }, { status: 404 }) };
  const { data, error } = await supabaseAdmin.from("assistant_saved_answers").select("id, created_by").eq("id", id).maybeSingle();
  if (error) {
    const status = isMissingTable(error) ? 503 : 500;
    return { res: NextResponse.json({ error: error.message }, { status }) };
  }
  if (!data) return { res: NextResponse.json({ error: "not found" }, { status: 404 }) };
  if (!canEdit(data, user.email ?? null, isAdminUser(user))) {
    return { res: NextResponse.json({ error: "Only the person who saved this can change it." }, { status: 403 }) };
  }
  return { res: null };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(id);
  if (g.res) return g.res;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
  if (typeof body.shared === "boolean") patch.shared = body.shared;
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("assistant_saved_answers").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(id);
  if (g.res) return g.res;
  const { error } = await supabaseAdmin.from("assistant_saved_answers").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
