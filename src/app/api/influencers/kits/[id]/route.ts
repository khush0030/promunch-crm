import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, readJson, requireUser } from "@/lib/influencers/db";
import { kitFields } from "@/lib/influencers/kits";
import { UUID_RE } from "@/lib/influencers/normalize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError("bad id");
  const { data, error } = await supabaseAdmin.from("influencer_kits").select("*").eq("id", id).maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError("not found", 404);
  return NextResponse.json({ kit: data });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError("bad id");
  const body = await readJson(req);
  if (!body) return jsonError("bad json");
  const { fields, error } = kitFields(body, false);
  if (error) return jsonError(error);
  if (!Object.keys(fields).length) return jsonError("nothing to update");
  const { data, error: upErr } = await supabaseAdmin.from("influencer_kits").update(fields).eq("id", id).select("*").maybeSingle();
  if (upErr) return jsonError(upErr.message, 500);
  if (!data) return jsonError("not found", 404);
  return NextResponse.json({ kit: data });
}

// A kit already used by a collab can't be deleted (deals keep their kit for
// the dispatch record); it is deactivated instead.
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError("bad id");
  const { count } = await supabaseAdmin
    .from("influencer_deals")
    .select("id", { count: "exact", head: true })
    .eq("kit_id", id);
  if ((count ?? 0) > 0) {
    const { error } = await supabaseAdmin.from("influencer_kits").update({ active: false }).eq("id", id);
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ ok: true, deactivated: true });
  }
  const { error } = await supabaseAdmin.from("influencer_kits").delete().eq("id", id);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true, deleted: true });
}
