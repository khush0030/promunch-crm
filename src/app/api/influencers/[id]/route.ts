import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, listDeals, logEvent, readJson, requireUser } from "@/lib/influencers/db";
import { isOpenStage, reliability } from "@/lib/influencers/health";
import { UUID_RE, influencerFields } from "@/lib/influencers/normalize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Creator profile: creator, address, all deals (with health), reliability, recent timeline.
export async function GET(_req: NextRequest, ctx: Ctx) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError("bad id");

  const [{ data: influencer, error }, { data: address }, { data: events }] = await Promise.all([
    supabaseAdmin.from("influencers").select("*").eq("id", id).maybeSingle(),
    supabaseAdmin.from("influencer_addresses").select("*").eq("influencer_id", id).maybeSingle(),
    supabaseAdmin
      .from("influencer_events")
      .select("*")
      .eq("influencer_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (error) return jsonError(error.message, 500);
  if (!influencer) return jsonError("not found", 404);

  let deals;
  try {
    deals = await listDeals({ influencer_id: id });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e), 500);
  }
  return NextResponse.json({
    influencer: {
      ...influencer,
      open_deals: deals.filter((d) => isOpenStage(d.stage)).length,
      reliability: reliability(deals),
    },
    address: address ?? null,
    deals,
    events: events ?? [],
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError("bad id");
  const body = await readJson(req);
  if (!body) return jsonError("bad json");
  const { fields, error } = influencerFields(body);
  if (error) return jsonError(error);
  if (!Object.keys(fields).length) return jsonError("nothing to update");

  const { data, error: upErr } = await supabaseAdmin
    .from("influencers")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (upErr) {
    if (upErr.code === "23505") return jsonError("Another creator already has this handle", 409);
    return jsonError(upErr.message, 500);
  }
  if (!data) return jsonError("not found", 404);
  await logEvent(id, null, "note", "dashboard", gate.actor, `Profile updated: ${Object.keys(fields).join(", ")}`, {
    fields: Object.keys(fields),
  });
  return NextResponse.json({ influencer: data });
}
