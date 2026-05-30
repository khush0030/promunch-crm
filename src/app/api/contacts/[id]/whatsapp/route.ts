import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { findWaContactForCrm } from "@/lib/customer-link";

// WhatsApp activity for a CRM contact. Resolves the wa_contact through the
// unified matching layer, then returns the most recent thread + a tail of
// recent messages so the Contacts detail page can fold them into a single
// activity timeline (Phase 3 + 4).
export const dynamic = "force-dynamic";

type WaMessage = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  status: string;
  created_at: string;
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const { data: crm } = await supabaseAdmin
    .from("contacts")
    .select("id, email, phone, shopify_customer_id")
    .eq("id", id)
    .maybeSingle();

  if (!crm) {
    return NextResponse.json({ matched: false, messages: [] as WaMessage[] });
  }

  const wa = await findWaContactForCrm(crm);
  if (!wa) {
    return NextResponse.json({ matched: false, messages: [] as WaMessage[] });
  }

  const { data: threads } = await supabaseAdmin
    .from("wa_threads")
    .select(
      "id, wa_id, status, ticket_status, ticket_number, last_inbound_at, last_message_snippet"
    )
    .eq("contact_id", wa.id)
    .order("last_inbound_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const thread = threads?.[0] ?? null;

  let messages: WaMessage[] = [];
  if (thread) {
    const { data: msgs } = await supabaseAdmin
      .from("wa_messages")
      .select("id, direction, type, body, status, created_at")
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: false })
      .limit(15);
    messages = (msgs ?? []) as WaMessage[];
  }

  return NextResponse.json({
    matched: true,
    wa_id: wa.wa_id,
    name: wa.name,
    thread_id: thread?.id ?? null,
    last_inbound_at: thread?.last_inbound_at ?? null,
    last_snippet: thread?.last_message_snippet ?? null,
    messages,
  });
}
