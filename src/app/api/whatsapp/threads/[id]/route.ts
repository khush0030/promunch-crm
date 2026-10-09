import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // ?peek=1 = the Inbox hub previewing a thread without opening it — skip the
  // unread_count reset so the badge doesn't clear until the agent actually
  // opens the conversation. Everything else about this response is identical.
  const peek = new URL(req.url).searchParams.get("peek") === "1";

  const { data: thread, error } = await supabaseAdmin
    .from("wa_threads")
    .select("*, contact:wa_contacts!inner(*)")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  // The NEWEST 500, returned oldest-first for the transcript. Reading
  // ascending with a limit used to cut off the latest messages on long chats.
  const { data: newestFirst } = await supabaseAdmin
    .from("wa_messages")
    .select("*")
    .eq("thread_id", id)
    .order("created_at", { ascending: false })
    .limit(500);
  const messages = (newestFirst ?? []).slice().reverse();

  // Voice calls with this customer, shown inline in the conversation.
  const { data: calls } = await supabaseAdmin
    .from("voice_calls")
    .select("id, purpose, order_ref, status, outcome, duration_s, link_sent_at, tool_action, created_at")
    .eq("wa_id", thread.wa_id)
    .order("created_at", { ascending: false })
    .limit(50);

  // mark read
  if (!peek) await supabaseAdmin.from("wa_threads").update({ unread_count: 0 }).eq("id", id);

  return NextResponse.json({ thread, messages, calls: (calls ?? []).slice().reverse() });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await parseBody(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  const allowed = [
    "status",
    "ticket_status",
    "ticket_priority",
    "ticket_category",
    "ticket_subject",
    "ticket_assignee",
    "assigned_to",
  ];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];
  // One owner per chat: the chat's "Assigned to" (assigned_to) and the
  // ticket's assignee (ticket_assignee) are the same person. Assigning from
  // anywhere (Live chats, a ticket, the Tickets list) writes both, so "Mine"
  // shows it everywhere. Ownership only; nothing here messages anyone.
  if ("assigned_to" in body && !("ticket_assignee" in body)) patch.ticket_assignee = body.assigned_to ?? null;
  if ("ticket_assignee" in body && !("assigned_to" in body)) patch.assigned_to = body.ticket_assignee ?? null;
  if (body.ticket_status === "resolved" || body.ticket_status === "closed") {
    patch.ticket_resolved_at = new Date().toISOString();
    // Resume the bot once the issue is handled. Opening a ticket flips the
    // thread to 'human' (bot goes silent so a person owns the conversation);
    // resolving it hands the customer back to the assistant — unless the agent
    // explicitly set a status in this same request (respect that).
    if (!("status" in body)) patch.status = "bot";
  }
  // archive / unarchive — hides the thread from the inbox, keeps all messages
  if ("archived" in body) {
    patch.archived_at = body.archived ? new Date().toISOString() : null;
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
