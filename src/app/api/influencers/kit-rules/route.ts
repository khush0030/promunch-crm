import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, readJson, requireUser, suggestKit } from "@/lib/influencers/db";
import { ruleFields } from "@/lib/influencers/kits";
import { cleanNiche } from "@/lib/influencers/normalize";

export const dynamic = "force-dynamic";

// Rules in evaluation order (lowest priority number wins).
// ?followers=&niche=a,b also returns the kit the rules would suggest.
export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { data, error } = await supabaseAdmin
    .from("influencer_kit_rules")
    .select("*, kit:influencer_kits(id, name, active)")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return jsonError(error.message, 500);
  const sp = req.nextUrl.searchParams;
  let suggested_kit_id: string | null | undefined;
  if (sp.has("followers") || sp.has("niche")) {
    const f = Number(sp.get("followers"));
    suggested_kit_id = await suggestKit(sp.get("followers") && Number.isFinite(f) ? f : null, cleanNiche(sp.get("niche") ?? ""));
  }
  return NextResponse.json({ rules: data ?? [], ...(suggested_kit_id !== undefined ? { suggested_kit_id } : {}) });
}

export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const body = await readJson(req);
  if (!body) return jsonError("bad json");
  const { fields, error } = ruleFields(body, true);
  if (error) return jsonError(error);
  const { data, error: insErr } = await supabaseAdmin.from("influencer_kit_rules").insert(fields).select("*").single();
  if (insErr) return jsonError(insErr.code === "23503" ? "kit not found" : insErr.message, insErr.code === "23503" ? 400 : 500);
  return NextResponse.json({ rule: data }, { status: 201 });
}
