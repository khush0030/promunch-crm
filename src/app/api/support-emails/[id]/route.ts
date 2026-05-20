import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const { data: thread, error: tErr } = await supabaseAdmin
    .from("email_threads")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [draftsRes, sentRes] = await Promise.all([
    supabaseAdmin
      .from("draft_revisions")
      .select("*")
      .eq("email_thread_id", id)
      .order("revision", { ascending: true }),
    supabaseAdmin
      .from("sent_replies")
      .select("*")
      .eq("email_thread_id", id)
      .order("sent_at", { ascending: false }),
  ]);

  return NextResponse.json({
    thread,
    drafts: draftsRes.data || [],
    sent: sentRes.data || [],
  });
}
