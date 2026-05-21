import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// WhatsApp status meter feed — connection health, uptime %, inbound/outbound
// liveness. Built from connector_events heartbeats (wa-health cron) + wa_messages.
export const dynamic = "force-dynamic";

export async function GET() {
  const now = Date.now();
  const d1 = new Date(now - 24 * 3600_000).toISOString();
  const d7 = new Date(now - 7 * 24 * 3600_000).toISOString();

  // up/down heartbeats from the wa-health cron
  const { data: health } = await supabaseAdmin
    .from("connector_events")
    .select("event, created_at")
    .eq("connector", "whatsapp")
    .in("event", ["health_ok", "health_down"])
    .gte("created_at", d7)
    .order("created_at", { ascending: false });
  const heals = health ?? [];
  const latest = heals[0] ?? null;
  const status = !latest ? "unknown" : latest.event === "health_ok" ? "up" : "down";

  const uptime = (since: string): number | null => {
    const rows = heals.filter((h) => h.created_at >= since);
    if (rows.length === 0) return null;
    const ok = rows.filter((h) => h.event === "health_ok").length;
    return Math.round((ok / rows.length) * 1000) / 10;
  };

  const last = async (col: string, filters: Record<string, string>) => {
    let q = supabaseAdmin.from("wa_messages").select("created_at");
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
    return (data as { created_at: string } | null)?.created_at ?? null;
  };

  const lastInboundAt = await last("created_at", { direction: "inbound" });
  const lastOutboundAt = await last("created_at", { direction: "outbound", status: "sent" });

  const { data: lastEvt } = await supabaseAdmin
    .from("connector_events")
    .select("created_at")
    .eq("connector", "whatsapp")
    .eq("event", "webhook_received")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: failedOut } = await supabaseAdmin
    .from("wa_messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "outbound")
    .eq("status", "failed")
    .gte("created_at", d1);

  const { count: aiReplies } = await supabaseAdmin
    .from("wa_messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "outbound")
    .eq("sent_by", "bot")
    .gte("created_at", d1);

  return NextResponse.json({
    status,
    uptime24h: uptime(d1),
    uptime7d: uptime(d7),
    checks24h: heals.filter((h) => h.created_at >= d1).length,
    lastCheckAt: latest?.created_at ?? null,
    lastWebhookAt: lastEvt?.created_at ?? null,
    lastInboundAt,
    lastOutboundAt,
    failedOutbound24h: failedOut ?? 0,
    aiReplies24h: aiReplies ?? 0,
  });
}
