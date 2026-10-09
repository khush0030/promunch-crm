// Notification centre feed (the header bell). PURE: the route
// (/api/notifications) only SELECTs rows and calls buildNotifications(); all
// wording, grouping, ids, dates and per-area filtering live here so they are
// unit-tested without a DB. Nothing here sends anything: it is an in-app list.
//
// Two groups:
//   needs_you - work waiting on a person (COD calls, chats, tickets, drafts,
//               B2B replies, creator drafts/updates, stock, template approved)
//   issues    - system problems to fix (connector errors in the last 24h,
//               WhatsApp down, failed campaigns, templates rejected by Meta)
//
// Every item has a STABLE id: the same underlying state yields the same id on
// every poll, and new state (a newer COD order, a new reply) yields a new id.
// The client uses "id not seen on the previous poll" to decide when to ping.

import type { Attention, AttentionInput } from "@/lib/metrics/attention";
import { canUse, type Access, type ModuleKey } from "@/lib/access";

export type NotifCategory = "needs_you" | "issues";
export type NotifSeverity = "crit" | "warn" | "info";
export type NotifKind =
  | "cod"
  | "chat"
  | "ticket"
  | "email_drafts"
  | "stock"
  | "campaign_paused"
  | "b2b_reply"
  | "creator_draft"
  | "creator_update"
  | "template_approved"
  | "connector_error"
  | "whatsapp_down"
  | "campaign_failed"
  | "template_rejected";

export type NotificationItem = {
  id: string;
  category: NotifCategory;
  kind: NotifKind;
  area: ModuleKey;
  severity: NotifSeverity;
  title: string;
  body: string;
  href: string;
  created_at: string;
};

// ---- Row inputs (exactly what the route selects) --------------------------

export type ChatRow = {
  id: string;
  status: string | null;
  assigned_to: string | null;
  last_inbound_at: string | null;
  last_message_direction: string | null;
  last_message_snippet: string | null;
  contact: { name: string | null; phone: string | null } | null;
  wa_id?: string | null;
};

export type NewTicketRow = {
  id: string;
  ticket_number: number | null;
  ticket_subject: string | null;
  ticket_category: string | null;
  ticket_priority: string | null;
  ticket_assignee: string | null;
  ticket_opened_at: string | null;
};

export type B2bReplyRow = {
  id: string;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  received_at: string;
};

export type CreatorDraftRow = {
  id: string;
  deal_id: string;
  version: number | null;
  submitted_at: string;
  handle: string | null;
};

export type CreatorEventRow = {
  id: string;
  deal_id: string | null;
  type: string;
  summary: string;
  created_at: string;
  handle: string | null;
};

export type ConnectorEventRow = {
  id: string;
  connector: string;
  level: string;
  event: string;
  message: string | null;
  created_at: string;
};

export type FailedCampaignRow = {
  id: string;
  name: string;
  last_error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type NotificationSources = {
  now: Date;
  attention: Attention;
  attentionInput: Pick<AttentionInput, "codOrders" | "tickets" | "emailDrafts">;
  chats: ChatRow[];
  newTickets: NewTicketRow[];
  b2bReplies: B2bReplyRow[];
  creatorDrafts: CreatorDraftRow[];
  creatorEvents: CreatorEventRow[];
  // level = 'error' rows from the last 24h.
  connectorErrors: ConnectorEventRow[];
  // whatsapp template_status rows from the last 3 days.
  templateEvents: ConnectorEventRow[];
  // newest whatsapp health_ok / health_down heartbeat, if any.
  waHealth: ConnectorEventRow | null;
  failedCampaigns: FailedCampaignRow[];
};

export type Viewer = { email: string | null; access: Access };

export const FEED_LIMIT = 40;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = 330 * 60 * 1000;

// ---- helpers --------------------------------------------------------------

function clip(s: string | null | undefined, n = 140): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

// Calendar day in India (the team's day), e.g. "2026-10-09".
export function istDay(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
// 09:00 IST of the given IST day, as an ISO timestamp. Daily-reminder items
// (stock, paused campaigns) are dated here so they surface once a day.
function istMorning(d: Date): string {
  const day = istDay(d);
  return new Date(Date.parse(`${day}T09:00:00.000Z`) - IST_OFFSET_MS).toISOString();
}
function dailyStamp(now: Date): string {
  const morning = istMorning(now);
  // Before 09:00 IST the reminder belongs to yesterday's morning.
  return Date.parse(morning) <= now.getTime() ? morning : new Date(Date.parse(morning) - DAY_MS).toISOString();
}

function newest(values: (string | null | undefined)[]): string | null {
  let out: string | null = null;
  for (const v of values) if (v && (!out || v > out)) out = v;
  return out;
}

function within(ts: string | null | undefined, now: Date, ms: number): boolean {
  if (!ts) return false;
  const t = Date.parse(ts);
  return Number.isFinite(t) && now.getTime() - t <= ms;
}

const sameEmail = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// Plain names for connector ids (connector_events.connector).
const CONNECTOR_LABEL: Record<string, string> = {
  shopify: "Shopify",
  shopify_wa: "Order WhatsApp messages",
  shopify_slack: "Order alerts",
  whatsapp: "WhatsApp",
  gmail_pipeline: "Support mailbox (Gmail)",
  gmail_watch: "Gmail inbox watch",
  anthropic: "AI drafting",
  openai: "AI replies",
  email_slack: "Support email alerts",
  b2b_outreach: "B2B outreach emails",
  instagram: "Instagram",
  deal_scan: "Deal scanner",
  breeze: "Breeze checkout",
  reputation: "Reputation tracking",
  amazon: "Amazon",
  resend: "Email sending",
};

export function connectorLabel(id: string): string {
  return CONNECTOR_LABEL[id] ?? id.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// Where to go to fix a connector, and who can see it.
function connectorTarget(id: string): { href: string; area: ModuleKey } {
  switch (id) {
    case "b2b_outreach":
      return { href: "/dashboard/leads?tab=setup", area: "partners" };
    case "deal_scan":
      return { href: "/dashboard/deals", area: "partners" };
    case "reputation":
      return { href: "/dashboard/reputation", area: "reputation" };
    default:
      return { href: "/dashboard/settings#connections", area: "system" };
  }
}

const TOKEN_RE = /token|expired|unauthori[sz]ed|invalid_grant|\b190\b|oauth|permission denied|401/i;

// Events that are a status line, not a failure, even if logged at error.
const NOT_AN_ISSUE = new Set(["template_status", "health_ok"]);

// ---- builder --------------------------------------------------------------

export function buildNotifications(src: NotificationSources, viewer: Viewer): NotificationItem[] {
  const { now } = src;
  const nowIso = now.toISOString();
  const items: NotificationItem[] = [];
  const me = viewer.email;

  // ---- From the Needs you aggregator (attention.ts) ----------------------
  for (const a of src.attention.items) {
    if (a.id === "cod-needs-call") {
      const last = newest(src.attentionInput.codOrders.map((o) => o.shopify_created_at)) ?? nowIso;
      items.push({
        id: `cod:${src.attentionInput.codOrders.length}:${last}`,
        category: "needs_you",
        kind: "cod",
        area: "sales",
        severity: "crit",
        title: a.title,
        body: `Confirm or cancel so they can ship, ${a.context}.`,
        href: "/dashboard/sales/orders",
        created_at: last,
      });
    } else if (a.id === "wa-tickets-open") {
      const opened = newest(src.attentionInput.tickets.map((t) => t.ticket_opened_at));
      // The moment the newest of them crossed the 4 hour line.
      const at = opened ? new Date(Date.parse(opened) + 4 * HOUR_MS).toISOString() : nowIso;
      items.push({
        id: `tickets-overdue:${src.attentionInput.tickets.length}:${opened ?? "x"}`,
        category: "needs_you",
        kind: "ticket",
        area: "inbox",
        severity: "warn",
        title: a.title,
        body: `Customers are waiting, ${a.context}.`,
        href: "/dashboard/inbox/tickets",
        created_at: at > nowIso ? nowIso : at,
      });
    } else if (a.id === "email-drafts-pending") {
      const last = newest(src.attentionInput.emailDrafts.map((d) => d.created_at)) ?? dailyStamp(now);
      items.push({
        id: `email-drafts:${src.attentionInput.emailDrafts.length}:${last}`,
        category: "needs_you",
        kind: "email_drafts",
        area: "inbox",
        severity: "info",
        title: a.title,
        body: "AI wrote replies to support emails. Check and send them.",
        href: "/dashboard/inbox/email",
        created_at: last,
      });
    } else if (a.id === "amazon-stockouts" || a.id === "amazon-low-stock") {
      const stamp = dailyStamp(now);
      items.push({
        id: `${a.id}:${istDay(new Date(stamp))}:${a.count ?? 1}`,
        category: "needs_you",
        kind: "stock",
        area: "sales",
        severity: a.severity,
        title: a.title,
        body: a.context.charAt(0).toUpperCase() + a.context.slice(1) + ".",
        href: a.href,
        created_at: stamp,
      });
    } else if (a.id.startsWith("campaign-paused-")) {
      const stamp = dailyStamp(now);
      items.push({
        id: `${a.id}:${istDay(new Date(stamp))}`,
        category: "needs_you",
        kind: "campaign_paused",
        area: "wa_marketing",
        severity: "info",
        title: `Campaign "${clip(a.title, 60)}" is paused for today`,
        body: "Meta's daily marketing limit was reached. It picks up again on its own.",
        href: a.href,
        created_at: stamp,
      });
    }
  }

  // ---- Chats waiting on a human: Human mode, or assigned to me -----------
  for (const c of src.chats) {
    if (c.last_message_direction !== "inbound" || !c.last_inbound_at) continue;
    if (!within(c.last_inbound_at, now, DAY_MS)) continue;
    const mine = sameEmail(c.assigned_to, me);
    if (c.status !== "human" && !mine) continue;
    const who = c.contact?.name || c.contact?.phone || c.wa_id || "A customer";
    items.push({
      id: `chat:${c.id}:${c.last_inbound_at}`,
      category: "needs_you",
      kind: "chat",
      area: "inbox",
      severity: "warn",
      title: mine ? `${who} wrote in a chat assigned to you` : `${who} is waiting for a reply on WhatsApp`,
      body: clip(c.last_message_snippet) || "New message",
      href: `/dashboard/inbox/wa-${encodeURIComponent(c.id)}`,
      created_at: c.last_inbound_at,
    });
  }

  // ---- New tickets (last 24h) that are mine or nobody's -------------------
  for (const t of src.newTickets) {
    if (!t.ticket_opened_at || !within(t.ticket_opened_at, now, DAY_MS)) continue;
    const mine = sameEmail(t.ticket_assignee, me);
    if (t.ticket_assignee && !mine) continue;
    const what = t.ticket_subject || t.ticket_category || "customer issue";
    const urgent = t.ticket_priority === "urgent" || t.ticket_priority === "high";
    items.push({
      id: `ticket:${t.id}:${t.ticket_opened_at}`,
      category: "needs_you",
      kind: "ticket",
      area: "inbox",
      severity: urgent ? "crit" : "warn",
      title: `${mine ? "Ticket assigned to you" : "New ticket"}${t.ticket_number ? ` #${t.ticket_number}` : ""}: ${clip(what, 70)}`,
      body: mine ? "You own this one." : "Nobody has picked it up yet.",
      href: `/dashboard/inbox/wa-${encodeURIComponent(t.id)}`,
      created_at: t.ticket_opened_at,
    });
  }

  // ---- B2B replies --------------------------------------------------------
  for (const r of src.b2bReplies) {
    const who = r.from_name || r.from_email || "A lead";
    items.push({
      id: `b2b-reply:${r.id}`,
      category: "needs_you",
      kind: "b2b_reply",
      area: "partners",
      severity: "info",
      title: `${clip(who, 50)} replied to your B2B email`,
      body: clip(r.subject) || "Open the reply to answer.",
      href: "/dashboard/leads?tab=replies",
      created_at: r.received_at,
    });
  }

  // ---- Creators -----------------------------------------------------------
  for (const d of src.creatorDrafts) {
    const who = d.handle ? `@${d.handle}` : "A creator";
    items.push({
      id: `creator-draft:${d.id}`,
      category: "needs_you",
      kind: "creator_draft",
      area: "partners",
      severity: "warn",
      title: `${who} sent a draft to review${d.version ? ` (version ${d.version})` : ""}`,
      body: "Approve it or ask for changes.",
      href: `/dashboard/influencers?deal=${encodeURIComponent(d.deal_id)}`,
      created_at: d.submitted_at,
    });
  }
  for (const e of src.creatorEvents) {
    if (e.type === "draft_submitted") continue; // covered by the draft item
    const who = e.handle ? `@${e.handle}` : "A creator";
    items.push({
      id: `creator-event:${e.id}`,
      category: "needs_you",
      kind: "creator_update",
      area: "partners",
      severity: "info",
      title: `Update from ${who}`,
      body: clip(e.summary) || "Open the collab to see what changed.",
      href: e.deal_id ? `/dashboard/influencers?deal=${encodeURIComponent(e.deal_id)}` : "/dashboard/influencers",
      created_at: e.created_at,
    });
  }

  // ---- Template status changes (from wa-webhook's template_status log) ----
  // Newest event per template name only.
  const seenTpl = new Set<string>();
  for (const ev of [...src.templateEvents].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
    const m = (ev.message ?? "").match(/^Template '([^']*)' → ([A-Z_]+)(?::\s*(.*))?/);
    if (!m) continue;
    const [, name, status, reason] = m;
    if (seenTpl.has(name)) continue;
    seenTpl.add(name);
    const href = "/dashboard/whatsapp?tab=templates";
    if (status === "APPROVED" || status === "REINSTATED") {
      items.push({
        id: `tpl:${ev.id}`,
        category: "needs_you",
        kind: "template_approved",
        area: "wa_marketing",
        severity: "info",
        title: `Template "${clip(name, 60)}" is approved`,
        body: "Meta approved it. It is ready to use in campaigns.",
        href,
        created_at: ev.created_at,
      });
    } else if (status === "REJECTED" || ["PAUSED", "DISABLED", "FLAGGED", "LIMIT_EXCEEDED"].includes(status)) {
      const rejected = status === "REJECTED";
      items.push({
        id: `tpl:${ev.id}`,
        category: "issues",
        kind: "template_rejected",
        area: "wa_marketing",
        severity: rejected ? "warn" : "crit",
        title: rejected
          ? `Meta rejected template "${clip(name, 60)}"`
          : `Meta ${status === "FLAGGED" ? "flagged" : "paused"} template "${clip(name, 60)}"`,
        body: clip(reason) || "Open it to edit and send it again.",
        href,
        created_at: ev.created_at,
      });
    }
  }

  // ---- WhatsApp down (newest heartbeat says so) ---------------------------
  if (src.waHealth && src.waHealth.event === "health_down" && within(src.waHealth.created_at, now, DAY_MS)) {
    items.push({
      id: `wa-down:${istDay(new Date(src.waHealth.created_at))}`,
      category: "issues",
      kind: "whatsapp_down",
      area: "system",
      severity: "crit",
      title: "WhatsApp is not connected",
      body: clip(src.waHealth.message) || "Messages may not be going out. The access token may have expired.",
      href: "/dashboard/settings#connections",
      created_at: src.waHealth.created_at,
    });
  }

  // ---- Connector errors (last 24h), one item per connector + error ---------
  const groups = new Map<string, ConnectorEventRow[]>();
  for (const e of src.connectorErrors) {
    if (e.level !== "error" || NOT_AN_ISSUE.has(e.event)) continue;
    if (!within(e.created_at, now, DAY_MS)) continue;
    const k = `${e.connector}|${e.event}`;
    const g = groups.get(k);
    if (g) g.push(e);
    else groups.set(k, [e]);
  }
  for (const [k, rows] of groups) {
    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const latest = rows[0];
    const [connector, event] = k.split("|");
    const label = connectorLabel(connector);
    const token = TOKEN_RE.test(`${event} ${latest.message ?? ""}`);
    const { href, area } = connectorTarget(connector);
    items.push({
      // One id per connector + error + day: a connector that keeps failing
      // pings once a day, not on every retry.
      id: `issue:${connector}:${event}:${istDay(new Date(latest.created_at))}`,
      category: "issues",
      kind: "connector_error",
      area,
      severity: token || rows.length >= 5 ? "crit" : "warn",
      title: token
        ? `${label}: login expired or access was removed`
        : `${label} failed ${rows.length === 1 ? "once" : `${rows.length} times`} in the last 24 hours`,
      body: clip(latest.message) || event.replace(/_/g, " "),
      href,
      created_at: latest.created_at,
    });
  }

  // ---- Failed campaigns (last 7 days) -------------------------------------
  for (const c of src.failedCampaigns) {
    const at = c.completed_at || c.started_at || c.created_at;
    if (!within(at, now, 7 * DAY_MS)) continue;
    items.push({
      id: `campaign-failed:${c.id}`,
      category: "issues",
      kind: "campaign_failed",
      area: "wa_marketing",
      severity: "crit",
      title: `WhatsApp campaign "${clip(c.name, 60)}" failed`,
      body: clip(c.last_error) || "Open the campaign to see why.",
      href: `/dashboard/whatsapp/campaigns/${encodeURIComponent(c.id)}`,
      created_at: at,
    });
  }

  // ---- Per-area filter, de-dup, newest first ------------------------------
  const seen = new Set<string>();
  return items
    .filter((i) => canUse(viewer.access, i.area))
    .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
    .sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at < b.created_at ? 1 : -1))
    .slice(0, FEED_LIMIT);
}
