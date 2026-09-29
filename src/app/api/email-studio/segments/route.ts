import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { parseRules, PRESETS, describeRules } from "@/lib/email-studio/segments";
import { countAudience } from "@/lib/email-studio/audience-server";
import { caller, isResponse, bad, migrationHint } from "@/lib/email-studio/route-helpers";

// Saved audiences. Built-in presets are code; saved segments live in
// email_segments. Counts are always computed live with consent + suppression.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const { data, error } = await supabase
    .from("email_segments")
    .select("id, name, rules, last_count, counted_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);
  return NextResponse.json({
    presets: Object.entries(PRESETS).map(([key, p]) => ({ key, ...p, summary: describeRules(p.rules) })),
    saved: (data ?? []).map((s) => ({ ...s, summary: describeRules(parseRules(s.rules)) })),
    savedError: error ? migrationHint(error.message) : undefined,
  });
}

export async function POST(req: NextRequest) {
  const me = await caller();
  if (isResponse(me)) return me;
  const body = await parseBody<{ name?: string; rules?: unknown }>(req);
  if (!body) return bad("invalid JSON body");
  const name = String(body.name ?? "").trim().slice(0, 120);
  if (!name) return bad("Give the audience a name.");
  const rules = parseRules(body.rules);
  const { count } = await countAudience(rules);
  const { data, error } = await supabase
    .from("email_segments")
    .insert({ name, rules, last_count: count, counted_at: new Date().toISOString(), created_by: me.email })
    .select()
    .single();
  if (error) return bad(migrationHint(error.message), 500);
  return NextResponse.json({ segment: data }, { status: 201 });
}
