// Ask Maya → Saved answers: list + save.
// GET  -> { available, saved }  (available:false until migration
//         supabase/migrations/20261009120000_assistant_saved_answers.sql is
//         applied by hand; the page then hides Save)
// POST { name?, question, answer?, conversation_id?, shared? } -> { saved }
// Session-gated here and by the middleware; mapped to Home & Ask Maya under
// /api/assistant in src/lib/access.ts. Writes only assistant_saved_answers.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isMissingTable, parseSavedAnswer, visibleTo, type SavedAnswer } from "@/lib/assistant/saved";

export const dynamic = "force-dynamic";

async function sessionUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from("assistant_saved_answers")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ available: false, saved: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ available: true, saved: visibleTo((data ?? []) as SavedAnswer[], user.email ?? null) });
}

export async function POST(req: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const parsed = parseSavedAnswer(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("assistant_saved_answers")
    .insert({ ...parsed.row, created_by: user.email ?? null })
    .select()
    .single();
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: "Saved answers are not set up yet.", available: false }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: data }, { status: 201 });
}
