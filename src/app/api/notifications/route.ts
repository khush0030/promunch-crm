import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadAttention } from "@/lib/metrics/attention-load";
import { accessOf } from "@/lib/access";
import {
  buildNotifications,
  type B2bReplyRow,
  type ChatRow,
  type ConnectorEventRow,
  type CreatorDraftRow,
  type CreatorEventRow,
  type FailedCampaignRow,
  type NewTicketRow,
  type NotificationSources,
} from "@/lib/notifications/feed";
import { isUnread, readNotifState, visibleItems } from "@/lib/notifications/state";
import { meOrNull } from "../me/caller";

// Notification centre feed for the header bell. READ-ONLY: SELECTs only,
// never a send or an edge-function call. Session-gated (mapped open in
// lib/access.ts) and filtered here to the areas the caller can open.
//
// Rows shared by every teammate are cached in-process for 30s; the per-user
// part (my chats, my areas, read state) is applied per request. Every query
// is a small LIMIT on an indexed time column.
export const dynamic = "force-dynamic";

const TTL_MS = 30_000;
type Shared = Omit<NotificationSources, "now" | "attention" | "attentionInput">;
let shared: { at: number; data: Shared } | null = null;

const HOUR = 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

async function rows<T>(label: string, q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  try {
    const { data, error } = await q;
    if (error) {
      console.error(`[notifications] ${label}:`, error.message);
      return [];
    }
    return (Array.isArray(data) ? data : []) as T[];
  } catch (e) {
    console.error(`[notifications] ${label}:`, e);
    return [];
  }
}

type Rel<T> = T | T[] | null | undefined;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

async function loadShared(): Promise<Shared> {
  if (shared && Date.now() - shared.at < TTL_MS) return shared.data;

  const [chatsRaw, newTickets, b2bReplies, draftsRaw, eventsRaw, connectorErrors, templateEvents, health, failedCampaigns] =
    await Promise.all([
      rows<ChatRow & { contact: Rel<{ name: string | null; phone: string | null }> }>(
        "wa_threads (chats)",
        supabaseAdmin
          .from("wa_threads")
          .select("id, wa_id, status, assigned_to, last_inbound_at, last_message_direction, last_message_snippet, contact:wa_contacts(name, phone)")
          .is("archived_at", null)
          .eq("last_message_direction", "inbound")
          .gte("last_inbound_at", ago(24 * HOUR))
          .or("status.eq.human,assigned_to.not.is.null")
          .order("last_inbound_at", { ascending: false })
          .limit(20),
      ),
      rows<NewTicketRow>(
        "wa_threads (new tickets)",
        supabaseAdmin
          .from("wa_threads")
          .select("id, ticket_number, ticket_subject, ticket_category, ticket_priority, ticket_assignee, ticket_opened_at")
          .in("ticket_status", ["open", "pending"])
          .is("archived_at", null)
          .gte("ticket_opened_at", ago(24 * HOUR))
          .order("ticket_opened_at", { ascending: false })
          .limit(15),
      ),
      rows<B2bReplyRow>(
        "outreach_replies",
        supabaseAdmin
          .from("outreach_replies")
          .select("id, from_name, from_email, subject, received_at")
          .gte("received_at", ago(72 * HOUR))
          .order("received_at", { ascending: false })
          .limit(8),
      ),
      rows<{ id: string; deal_id: string; version: number | null; submitted_at: string; deal: Rel<{ influencer: Rel<{ handle: string | null }> }> }>(
        "influencer_drafts",
        supabaseAdmin
          .from("influencer_drafts")
          .select("id, deal_id, version, submitted_at, deal:influencer_deals(influencer:influencers(handle))")
          .eq("review_status", "pending")
          .gte("submitted_at", ago(7 * 24 * HOUR))
          .order("submitted_at", { ascending: false })
          .limit(8),
      ),
      rows<{ id: string; deal_id: string | null; type: string; summary: string; created_at: string; influencer: Rel<{ handle: string | null }> }>(
        "influencer_events",
        supabaseAdmin
          .from("influencer_events")
          .select("id, deal_id, type, summary, created_at, influencer:influencers(handle)")
          .eq("actor", "creator")
          .gte("created_at", ago(72 * HOUR))
          .order("created_at", { ascending: false })
          .limit(8),
      ),
      rows<ConnectorEventRow>(
        "connector_events (errors)",
        supabaseAdmin
          .from("connector_events")
          .select("id, connector, level, event, message, created_at")
          .eq("level", "error")
          .gte("created_at", ago(24 * HOUR))
          .order("created_at", { ascending: false })
          .limit(60),
      ),
      rows<ConnectorEventRow>(
        "connector_events (templates)",
        supabaseAdmin
          .from("connector_events")
          .select("id, connector, level, event, message, created_at")
          .eq("connector", "whatsapp")
          .eq("event", "template_status")
          .gte("created_at", ago(72 * HOUR))
          .order("created_at", { ascending: false })
          .limit(20),
      ),
      rows<ConnectorEventRow>(
        "connector_events (wa health)",
        supabaseAdmin
          .from("connector_events")
          .select("id, connector, level, event, message, created_at")
          .eq("connector", "whatsapp")
          .in("event", ["health_ok", "health_down"])
          .gte("created_at", ago(24 * HOUR))
          .order("created_at", { ascending: false })
          .limit(1),
      ),
      rows<FailedCampaignRow>(
        "wa_campaigns (failed)",
        supabaseAdmin
          .from("wa_campaigns")
          .select("id, name, last_error, created_at, started_at, completed_at")
          .eq("status", "failed")
          .gte("created_at", ago(30 * 24 * HOUR))
          .order("created_at", { ascending: false })
          .limit(5),
      ),
    ]);

  const data: Shared = {
    chats: chatsRaw.map((c) => ({ ...c, contact: one(c.contact) })),
    newTickets,
    b2bReplies,
    creatorDrafts: draftsRaw.map<CreatorDraftRow>((d) => ({
      id: d.id,
      deal_id: d.deal_id,
      version: d.version,
      submitted_at: d.submitted_at,
      handle: one(one(d.deal)?.influencer)?.handle ?? null,
    })),
    creatorEvents: eventsRaw.map<CreatorEventRow>((e) => ({
      id: e.id,
      deal_id: e.deal_id,
      type: e.type,
      summary: e.summary,
      created_at: e.created_at,
      handle: one(e.influencer)?.handle ?? null,
    })),
    connectorErrors,
    templateEvents,
    waHealth: health[0] ?? null,
    failedCampaigns,
  };
  shared = { at: Date.now(), data };
  return data;
}

export async function GET() {
  const me = await meOrNull();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [{ body: attention, input }, data] = await Promise.all([loadAttention(), loadShared()]);
  const now = new Date();
  const state = readNotifState(me.user_metadata as Record<string, unknown>);
  const all = buildNotifications(
    { now, attention, attentionInput: input, ...data },
    { email: me.email ?? null, access: accessOf(me) },
  );
  const items = visibleItems(all, state).map((i) => ({ ...i, unread: isUnread(i, state) }));

  return NextResponse.json(
    {
      generated_at: now.toISOString(),
      items,
      unread: items.filter((i) => i.unread).length,
      seen_at: state.seen_at,
      prefs: state.prefs,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
