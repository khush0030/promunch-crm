import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { parseRules } from "@/lib/email-studio/segments";
import { countAudience } from "@/lib/email-studio/audience-server";
import { caller, isResponse, bad, migrationHint } from "@/lib/email-studio/route-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  const { id } = await params;
  const body = await parseBody<{ name?: string; rules?: unknown }>(req);
  if (!body) return bad("invalid JSON body");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 120);
    if (!name) return bad("name cannot be empty");
    patch.name = name;
  }
  if (body.rules !== undefined) {
    const rules = parseRules(body.rules);
    patch.rules = rules;
    patch.last_count = (await countAudience(rules)).count;
    patch.counted_at = new Date().toISOString();
  }
  const { data, error } = await supabase.from("email_segments").update(patch).eq("id", id).select().maybeSingle();
  if (error) return bad(migrationHint(error.message), 500);
  if (!data) return bad("not found", 404);
  return NextResponse.json({ segment: data });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  const { id } = await params;
  const { count } = await supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("segment_id", id).in("status", ["scheduled", "sending"]);
  if (count) return bad("A scheduled campaign uses this audience. Change that campaign first.", 409);
  const { error } = await supabase.from("email_segments").delete().eq("id", id);
  if (error) return bad(migrationHint(error.message), 500);
  return NextResponse.json({ ok: true });
}
