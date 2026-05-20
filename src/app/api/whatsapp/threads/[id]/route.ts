import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const { data: thread, error } = await supabaseAdmin
    .from("wa_threads")
    .select("*, contact:wa_contacts!inner(*)")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const { data: messages } = await supabaseAdmin
    .from("wa_messages")
    .select("*")
    .eq("thread_id", id)
    .order("created_at", { ascending: true })
    .limit(500);

  // mark read
  await supabaseAdmin.from("wa_threads").update({ unread_count: 0 }).eq("id", id);

  return NextResponse.json({ thread, messages: messages ?? [] });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const allowed = [
    "status",
    "ticket_status",
    "ticket_priority",
    "ticket_category",
    "ticket_subject",
    "ticket_assignee",
  ];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];
  if (body.ticket_status === "resolved" || body.ticket_status === "closed") {
    patch.ticket_resolved_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from("wa_threads")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ thread: data });
}
