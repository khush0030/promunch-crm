import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  amazonConn, gmailConn, instagramConn, openaiConn, resendConn, shopifyConn, summarize, voiceConn, whatsappConn,
  type ConnEvent, type Connection,
} from "@/lib/connections";

// Settings → Connections (read-only). One row per service with a live status
// from data we already store; no provider is called except the read-only
// wa-meta-info lookup for the WhatsApp quality rating (best effort, short
// timeout). Session-gated by the middleware; mapped to the Settings area via
// the /api/settings prefix in src/lib/access.ts. Never returns secret values.

export const dynamic = "force-dynamic";

type EvRow = ConnEvent & { connector: string };

async function waQuality(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/functions/v1/wa-meta-info`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const edge = Array.isArray(j?.phoneNumbers?.data) ? j.phoneNumbers.data[0] : null;
    return j?.phone?.quality_rating ?? edge?.quality_rating ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const now = Date.now();
  const since7d = new Date(now - 7 * 86_400_000).toISOString();
  const since24h = new Date(now - 86_400_000).toISOString();
  const db = supabaseAdmin;

  const [
    eventsRes, lastOrderRes, waInRes, waOutRes, waSentRes, waFailedRes, amazonRes, emailSentRes, emailSent24Res,
    emailFailed24Res, watchRes, lastMailRes, flowRes, lastCallRes, calls24Res, notStarted24Res, igRes, awaitingRes, quality,
  ] = await Promise.all([
    db.from("connector_events").select("connector, level, event, message, created_at").gte("created_at", since7d)
      .order("created_at", { ascending: false }).limit(500),
    db.from("shopify_orders").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("wa_messages").select("created_at").eq("direction", "inbound").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("wa_messages").select("created_at").eq("direction", "outbound").in("status", ["sent", "delivered", "read"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("wa_messages").select("id", { count: "exact", head: true }).eq("direction", "outbound")
      .in("status", ["sent", "delivered", "read"]).gte("created_at", since24h),
    db.from("wa_messages").select("id", { count: "exact", head: true }).eq("direction", "outbound").eq("status", "failed")
      .gte("created_at", since24h),
    db.from("amazon_sync_state").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("email_sends").select("sent_at").not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("email_sends").select("id", { count: "exact", head: true }).gte("sent_at", since24h),
    db.from("email_sends").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since24h),
    db.from("gmail_watch").select("expiration").limit(1).maybeSingle(),
    db.from("email_logs").select("created_at").eq("event_type", "received").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("wa_flow_settings").select("voice_call_enabled, cod_voice_enabled").eq("id", 1).maybeSingle(),
    db.from("voice_calls").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("voice_calls").select("id", { count: "exact", head: true }).gte("created_at", since24h),
    db.from("voice_calls").select("id", { count: "exact", head: true }).eq("status", "start_failed").gte("created_at", since24h),
    db.from("ig_settings").select("paused").eq("id", 1).maybeSingle(),
    db.from("email_threads").select("id", { count: "exact", head: true }).eq("draft_status", "failed"),
    waQuality(),
  ]);

  const events = ((eventsRes.data ?? []) as EvRow[]);
  const ev = (...ids: string[]) => events.filter((e) => ids.includes(e.connector));

  const flow = flowRes.data as { voice_call_enabled?: boolean | null; cod_voice_enabled?: boolean | null } | null;
  const connections: Connection[] = [
    shopifyConn({ lastOrderAt: lastOrderRes.data?.created_at ?? null, events: ev("shopify") }, now),
    whatsappConn({
      events: ev("whatsapp"),
      lastInboundAt: waInRes.data?.created_at ?? null,
      lastOutboundAt: waOutRes.data?.created_at ?? null,
      sent24h: waSentRes.count ?? 0,
      failed24h: waFailedRes.count ?? 0,
      quality,
    }, now),
    amazonConn({ lastSyncAt: amazonRes.error ? null : amazonRes.data?.updated_at ?? null }, now),
    resendConn({
      lastSentAt: emailSentRes.error ? null : emailSentRes.data?.sent_at ?? null,
      sent24h: emailSent24Res.count ?? 0,
      failed24h: emailFailed24Res.count ?? 0,
    }),
    gmailConn({
      events: ev("gmail_pipeline", "gmail_watch"),
      watch: (watchRes.data as { expiration: string | null } | null) ?? null,
      lastReceivedAt: lastMailRes.data?.created_at ?? null,
    }, now),
    voiceConn({
      codOn: flow?.cod_voice_enabled ?? null,
      cartOn: flow?.voice_call_enabled ?? null,
      lastCallAt: lastCallRes.data?.created_at ?? null,
      calls24h: calls24Res.count ?? 0,
      notStarted24h: notStarted24Res.count ?? 0,
    }),
    instagramConn({ paused: (igRes.data as { paused?: boolean | null } | null)?.paused ?? null, events: ev("instagram") }, now),
    openaiConn({ events: ev("anthropic"), awaitingDraft: awaitingRes.count ?? 0 }, now),
  ];

  return NextResponse.json({ generatedAt: new Date(now).toISOString(), summary: summarize(connections), connections });
}
