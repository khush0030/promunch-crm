import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, logEvent, readJson, requireUser } from "@/lib/influencers/db";
import { UUID_RE, cleanAddress } from "@/lib/influencers/normalize";

export const dynamic = "force-dynamic";

// Replace the creator's shipping address (PII: kept apart from the profile).
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError("bad id");
  const body = await readJson(req);
  if (!body) return jsonError("bad json");
  if (body.phone && !cleanAddress({ phone: body.phone })?.phone) return jsonError("phone is not a valid number");
  const addr = cleanAddress(body);
  if (!addr) return jsonError("address is empty");

  const { data: exists } = await supabaseAdmin.from("influencers").select("id").eq("id", id).maybeSingle();
  if (!exists) return jsonError("not found", 404);

  const { data, error } = await supabaseAdmin
    .from("influencer_addresses")
    .upsert({ influencer_id: id, ...addr, updated_at: new Date().toISOString() }, { onConflict: "influencer_id" })
    .select("*")
    .single();
  if (error) return jsonError(error.message, 500);
  await logEvent(id, null, "note", "dashboard", gate.actor, "Shipping address updated");
  return NextResponse.json({ address: data });
}
