import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Feeds the Dashboard "Needs attention" card. Server-side because wa_*/email_*
// tables are RLS-blocked for the browser client. Counts the things that need a
// human right now: failed WhatsApp sends, unresolved high-priority WhatsApp
// tickets, and urgent support emails still awaiting a reply.
export const dynamic = "force-dynamic";

export async function GET() {
  const since24h = new Date(Date.now() - 86400_000).toISOString();

  const [failedRes, waTicketRes, emailRes] = await Promise.all([
    supabaseAdmin
      .from("wa_messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "outbound")
      .eq("status", "failed")
      .gte("created_at", since24h),
    supabaseAdmin
      .from("wa_threads")
      .select("id", { count: "exact", head: true })
      .in("ticket_status", ["open", "pending"])
      .in("ticket_priority", ["high", "urgent"])
      .is("archived_at", null),
    supabaseAdmin
      .from("email_threads")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .in("urgency", ["high", "critical"]),
  ]);

  return NextResponse.json({
    failedWhatsApp: failedRes.count ?? 0,
    highPriorityWaTickets: waTicketRes.count ?? 0,
    urgentEmails: emailRes.count ?? 0,
  });
}
