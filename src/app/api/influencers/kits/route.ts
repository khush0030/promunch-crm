import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, readJson, requireUser } from "@/lib/influencers/db";
import { kitFields } from "@/lib/influencers/kits";

export const dynamic = "force-dynamic";

// ?active=1 lists only active kits (the Add collab picker).
export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  let q = supabaseAdmin.from("influencer_kits").select("*").order("created_at", { ascending: true });
  if (req.nextUrl.searchParams.get("active") === "1") q = q.eq("active", true);
  const { data, error } = await q;
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ kits: data ?? [] });
}

export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const body = await readJson(req);
  if (!body) return jsonError("bad json");
  const { fields, error } = kitFields(body, true);
  if (error) return jsonError(error);
  const { data, error: insErr } = await supabaseAdmin.from("influencer_kits").insert(fields).select("*").single();
  if (insErr) return jsonError(insErr.message, 500);
  return NextResponse.json({ kit: data }, { status: 201 });
}
