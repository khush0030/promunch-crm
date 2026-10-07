import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, readJson, requireUser } from "@/lib/influencers/db";
import { ruleFields } from "@/lib/influencers/kits";
import { UUID_RE } from "@/lib/influencers/normalize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError("bad id");
  const body = await readJson(req);
  if (!body) return jsonError("bad json");
  const { fields, error } = ruleFields(body, false);
  if (error) return jsonError(error);
  if (!Object.keys(fields).length) return jsonError("nothing to update");
  const { data, error: upErr } = await supabaseAdmin
    .from("influencer_kit_rules")
    .update(fields)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (upErr) return jsonError(upErr.code === "23503" ? "kit not found" : upErr.message, upErr.code === "23503" ? 400 : 500);
  if (!data) return jsonError("not found", 404);
  return NextResponse.json({ rule: data });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError("bad id");
  const { error } = await supabaseAdmin.from("influencer_kit_rules").delete().eq("id", id);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}
