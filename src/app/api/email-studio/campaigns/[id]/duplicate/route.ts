import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { utmSlug } from "@/lib/email-studio/server";
import { caller, isResponse, bad, migrationHint } from "@/lib/email-studio/route-helpers";

// Copy any campaign (including a sent one) into a fresh draft.
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  const { id } = await params;
  const { data: c } = await supabase
    .from("campaigns")
    .select("name, subject, preview_text, body_html, design, template_id, segment_id, audience_rules, segment_filter")
    .eq("id", id)
    .maybeSingle();
  if (!c) return bad("not found", 404);
  const name = `Copy of ${c.name ?? "campaign"}`.slice(0, 120);
  const { data, error } = await supabase
    .from("campaigns")
    .insert({ ...c, name, status: "draft", created_by: me.email })
    .select("id")
    .single();
  if (error || !data) return bad(migrationHint(error?.message ?? "copy failed"), 500);
  await supabase.from("campaigns").update({ utm_campaign: utmSlug(name, data.id) }).eq("id", data.id);
  return NextResponse.json({ id: data.id }, { status: 201 });
}
