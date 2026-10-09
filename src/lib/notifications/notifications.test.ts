import { describe, it, expect } from "vitest";
import { accessOf } from "@/lib/access";
import { buildAttention, type AttentionInput } from "@/lib/metrics/attention";
import { buildNotifications, connectorLabel, istDay, FEED_LIMIT, type NotificationSources } from "./feed";
import {
  applyNotifPatch,
  DEFAULT_PREFS,
  freshAlerts,
  ID_CAP,
  isUnread,
  readNotifState,
  shortId,
  shouldRing,
  timeAgo,
  visibleItems,
  type NotifState,
} from "./state";

const NOW = new Date("2026-10-09T10:00:00.000Z"); // 15:30 IST
const iso = (minsAgo: number) => new Date(NOW.getTime() - minsAgo * 60_000).toISOString();

const admin = accessOf({ email: "boss@promunch.in", app_metadata: { role: "admin" } });
const support = accessOf({ email: "asha@promunch.in", app_metadata: { role: "agent", modules: ["inbox"] } });
const marketer = accessOf({ email: "priya@promunch.in", app_metadata: { role: "agent", modules: ["wa_marketing"] } });

function sources(over: Partial<NotificationSources> = {}, att: Partial<AttentionInput> = {}): NotificationSources {
  const input: AttentionInput = {
    now: NOW,
    amazonInventory: [],
    amazonFinanceItems: [],
    codOrders: [],
    tickets: [],
    emailDrafts: [],
    pausedCampaigns: [],
    ...att,
  };
  return {
    now: NOW,
    attention: buildAttention(input),
    attentionInput: input,
    chats: [],
    newTickets: [],
    b2bReplies: [],
    creatorDrafts: [],
    creatorEvents: [],
    connectorErrors: [],
    templateEvents: [],
    waHealth: null,
    failedCampaigns: [],
    ...over,
  };
}

const chat = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  wa_id: "919800000000",
  status: "human",
  assigned_to: null,
  last_inbound_at: iso(5),
  last_message_direction: "inbound",
  last_message_snippet: "Where is my order?",
  contact: { name: "Ravi", phone: "+91 98000 00000" },
  ...o,
});

describe("buildNotifications", () => {
  it("returns nothing when nothing is going on", () => {
    expect(buildNotifications(sources(), { email: "boss@promunch.in", access: admin })).toEqual([]);
  });

  it("COD orders: one item dated by the newest order; a new order changes the id", () => {
    const a = buildNotifications(
      sources({}, { codOrders: [{ shopify_id: 1, total_price: "499", shopify_created_at: iso(120) }] }),
      { email: null, access: admin },
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "cod", category: "needs_you", area: "sales", severity: "crit", href: "/dashboard/sales/orders", created_at: iso(120) });
    const b = buildNotifications(
      sources({}, {
        codOrders: [
          { shopify_id: 1, total_price: "499", shopify_created_at: iso(120) },
          { shopify_id: 2, total_price: "299", shopify_created_at: iso(3) },
        ],
      }),
      { email: null, access: admin },
    );
    expect(b[0].id).not.toBe(a[0].id);
    expect(b[0].created_at).toBe(iso(3));
    expect(b[0].title).toMatch(/^2 COD orders/);
  });

  it("chats: Human mode for everyone with the Inbox, assigned-to-me only for me", () => {
    const src = sources({
      chats: [
        chat("t1"),
        chat("t2", { status: "bot", assigned_to: "asha@promunch.in" }),
        chat("t3", { status: "bot", assigned_to: "someone@promunch.in" }),
        chat("t4", { last_message_direction: "outbound" }),
        chat("t5", { last_inbound_at: iso(60 * 30) }), // older than 24h
      ],
    });
    const mine = buildNotifications(src, { email: "Asha@promunch.in", access: support });
    expect(mine.map((i) => i.id.split(":")[1]).sort()).toEqual(["t1", "t2"]);
    const t2 = mine.find((i) => i.id.startsWith("chat:t2"))!;
    expect(t2.title).toMatch(/assigned to you/);
    expect(t2.href).toBe("/dashboard/inbox/wa-t2");
    // A marketer has no Inbox: no chats at all.
    expect(buildNotifications(src, { email: "priya@promunch.in", access: marketer })).toEqual([]);
  });

  it("new tickets: unassigned or mine, urgent is red", () => {
    const src = sources({
      newTickets: [
        { id: "a", ticket_number: 41, ticket_subject: "Damaged pack", ticket_category: null, ticket_priority: "urgent", ticket_assignee: null, ticket_opened_at: iso(10) },
        { id: "b", ticket_number: 42, ticket_subject: null, ticket_category: "refund", ticket_priority: "normal", ticket_assignee: "asha@promunch.in", ticket_opened_at: iso(20) },
        { id: "c", ticket_number: 43, ticket_subject: "x", ticket_category: null, ticket_priority: null, ticket_assignee: "other@promunch.in", ticket_opened_at: iso(30) },
      ],
    });
    const out = buildNotifications(src, { email: "asha@promunch.in", access: support });
    expect(out.map((i) => i.title)).toEqual(["New ticket #41: Damaged pack", "Ticket assigned to you #42: refund"]);
    expect(out[0].severity).toBe("crit");
  });

  it("connector errors: grouped per connector + error, plain words, daily id, token errors are red", () => {
    const err = (id: string, connector: string, event: string, mins: number, message: string) => ({ id, connector, level: "error", event, message, created_at: iso(mins) });
    const src = sources({
      connectorErrors: [
        err("1", "shopify", "webhook_failed", 5, "HMAC mismatch"),
        err("2", "shopify", "webhook_failed", 50, "HMAC mismatch"),
        err("3", "gmail_pipeline", "token_refresh_failed", 15, "invalid_grant: Token has been expired or revoked."),
        err("4", "b2b_outreach", "send_failed", 25, "Resend 422"),
        err("5", "shopify", "webhook_failed", 60 * 26, "old"), // outside 24h
      ],
    });
    const out = buildNotifications(src, { email: null, access: admin });
    expect(out).toHaveLength(3);
    const shop = out.find((i) => i.id.startsWith("issue:shopify:"))!;
    expect(shop).toMatchObject({ category: "issues", severity: "warn", area: "system", created_at: iso(5), body: "HMAC mismatch" });
    expect(shop.title).toBe("Shopify failed 2 times in the last 24 hours");
    expect(shop.id).toBe(`issue:shopify:webhook_failed:${istDay(NOW)}`);
    const gmail = out.find((i) => i.id.startsWith("issue:gmail_pipeline"))!;
    expect(gmail.severity).toBe("crit");
    expect(gmail.title).toMatch(/login expired/);
    const b2b = out.find((i) => i.id.startsWith("issue:b2b_outreach"))!;
    expect(b2b).toMatchObject({ area: "partners", href: "/dashboard/leads?tab=setup" });
    // A support agent (Inbox only) sees none of these system issues.
    expect(buildNotifications(src, { email: null, access: support })).toEqual([]);
  });

  it("template status: rejected is an issue, approved is good news; newest per template", () => {
    const ev = (id: string, mins: number, message: string) => ({ id, connector: "whatsapp", level: "info", event: "template_status", message, created_at: iso(mins) });
    const out = buildNotifications(
      sources({
        templateEvents: [
          ev("e1", 30, "Template 'diwali_offer' → PENDING."),
          ev("e2", 10, "Template 'diwali_offer' → REJECTED: Promotional content in utility."),
          ev("e3", 20, "Template 'restock' → APPROVED."),
          ev("e4", 90, "Template 'restock' → REJECTED: old"),
        ],
      }),
      { email: null, access: marketer },
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ category: "issues", kind: "template_rejected", title: 'Meta rejected template "diwali_offer"', body: "Promotional content in utility." });
    expect(out[1]).toMatchObject({ category: "needs_you", kind: "template_approved" });
  });

  it("failed campaigns within 7 days and WhatsApp down", () => {
    const out = buildNotifications(
      sources({
        failedCampaigns: [
          { id: "c1", name: "Edamame launch", last_error: "#132012 header missing", created_at: iso(300), started_at: iso(200), completed_at: iso(100) },
          { id: "c2", name: "Old", last_error: null, created_at: iso(60 * 24 * 10), started_at: null, completed_at: null },
        ],
        waHealth: { id: "h", connector: "whatsapp", level: "error", event: "health_down", message: null, created_at: iso(2) },
      }),
      { email: null, access: admin },
    );
    expect(out.map((i) => i.kind)).toEqual(["whatsapp_down", "campaign_failed"]);
    expect(out[1]).toMatchObject({ href: "/dashboard/whatsapp/campaigns/c1", created_at: iso(100) });
  });

  it("B2B replies and creator drafts/updates go to the partners area", () => {
    const src = sources({
      b2bReplies: [{ id: "r1", from_name: "Anita (Foodhall)", from_email: "a@x.in", subject: "Re: PROMUNCH for your stores", received_at: iso(7) }],
      creatorDrafts: [{ id: "d1", deal_id: "deal1", version: 2, submitted_at: iso(8), handle: "fitwithmeera" }],
      creatorEvents: [
        { id: "ev1", deal_id: "deal1", type: "draft_submitted", summary: "Draft v2", created_at: iso(8), handle: "fitwithmeera" },
        { id: "ev2", deal_id: "deal1", type: "brief_ack", summary: "Acknowledged the brief", created_at: iso(9), handle: "fitwithmeera" },
      ],
    });
    const out = buildNotifications(src, { email: null, access: admin });
    expect(out.map((i) => i.kind)).toEqual(["b2b_reply", "creator_draft", "creator_update"]);
    expect(out[1].href).toBe("/dashboard/influencers?deal=deal1");
    expect(buildNotifications(src, { email: null, access: marketer })).toEqual([]);
  });

  it("stock reminders are dated once per India day", () => {
    const input: Partial<AttentionInput> = {
      amazonInventory: [{ seller_sku: "S1", product_name: "Crunchies", fulfillable_quantity: 0, inbound_shipped: 0 }],
      amazonFinanceItems: [{ seller_sku: "S1", event_type: "Shipment", posted_date: iso(60 * 24), quantity: 30, net: 3000 }],
    };
    const out = buildNotifications(sources({}, input), { email: null, access: admin });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(`amazon-stockouts:${istDay(NOW)}:1`);
    expect(out[0].created_at).toBe("2026-10-09T03:30:00.000Z"); // 09:00 IST
  });

  it("newest first and capped", () => {
    const chats = Array.from({ length: 60 }, (_, n) => chat(`t${n}`, { last_inbound_at: iso(n + 1) }));
    const out = buildNotifications(sources({ chats }), { email: null, access: admin });
    expect(out).toHaveLength(FEED_LIMIT);
    expect(out[0].id).toBe(`chat:t0:${iso(1)}`);
  });

  it("connector labels are plain words", () => {
    expect(connectorLabel("gmail_pipeline")).toBe("Support mailbox (Gmail)");
    expect(connectorLabel("new_thing")).toBe("New thing");
  });
});

const base = (): NotifState => ({ seen_at: null, read: [], dismissed: [], prefs: { ...DEFAULT_PREFS } });

describe("notification state", () => {
  it("reads messy metadata safely", () => {
    expect(readNotifState(undefined)).toEqual(base());
    const s = readNotifState({ notifications: { seen_at: "nope", read: ["abc", 5, "UPPER"], prefs: { sound: false, popups: "yes", bogus: true } } });
    expect(s.seen_at).toBeNull();
    expect(s.read).toEqual(["abc"]);
    expect(s.prefs).toEqual({ ...DEFAULT_PREFS, sound: false });
  });

  it("mark all read uses the server clock and clears per-item reads", () => {
    const r = applyNotifPatch({ ...base(), read: [shortId("x")] }, { mark_all_read: true }, NOW);
    expect(r.ok && r.value.seen_at).toBe(NOW.toISOString());
    expect(r.ok && r.value.read).toEqual([]);
  });

  it("read / dismiss store short hashes, de-duped and capped", () => {
    const r = applyNotifPatch(base(), { read: ["a", "a"], dismiss: ["b"] }, NOW);
    expect(r.ok && r.value.read).toEqual([shortId("a")]);
    expect(r.ok && r.value.dismissed).toEqual([shortId("b")]);
    let s = base();
    for (let n = 0; n < 5; n++) {
      const step = applyNotifPatch(s, { read: Array.from({ length: 50 }, (_, i) => `id-${n}-${i}`) }, NOW);
      if (!step.ok) throw new Error(step.error);
      s = step.value;
    }
    expect(s.read).toHaveLength(ID_CAP);
    expect(s.read.at(-1)).toBe(shortId("id-4-49"));
  });

  it("validates the PATCH body", () => {
    const bad = (b: Record<string, unknown>) => applyNotifPatch(base(), b, NOW).ok;
    expect(bad({})).toBe(false);
    expect(bad({ mark_all_read: "yes" })).toBe(false);
    expect(bad({ read: "a" })).toBe(false);
    expect(bad({ read: [1] })).toBe(false);
    expect(bad({ read: Array.from({ length: 51 }, (_, i) => `x${i}`) })).toBe(false);
    expect(bad({ dismiss: ["x".repeat(201)] })).toBe(false);
    expect(bad({ prefs: [] })).toBe(false);
    expect(bad({ prefs: { sound: "off" } })).toBe(false);
    expect(bad({ prefs: { volume: true } })).toBe(false);
    expect(bad({ user_id: "someone-else" })).toBe(false);
    const ok = applyNotifPatch(base(), { prefs: { sound: false, issues: false } }, NOW);
    expect(ok.ok && ok.value.prefs).toEqual({ ...DEFAULT_PREFS, sound: false, issues: false });
  });

  it("unread = newer than seen_at, not read, not dismissed", () => {
    const item = { id: "chat:t1:x", created_at: iso(5) };
    expect(isUnread(item, base())).toBe(true);
    expect(isUnread(item, { ...base(), seen_at: iso(1) })).toBe(false);
    expect(isUnread(item, { ...base(), seen_at: iso(10) })).toBe(true);
    expect(isUnread(item, { ...base(), read: [shortId(item.id)] })).toBe(false);
    expect(visibleItems([item], { dismissed: [shortId(item.id)] })).toEqual([]);
  });

  it("fresh alerts: first poll is a baseline, then only new unread items in alerting groups", () => {
    const a = { id: "a", created_at: iso(5), category: "needs_you" as const };
    const b = { id: "b", created_at: iso(1), category: "issues" as const };
    const c = { id: "c", created_at: iso(2), category: "needs_you" as const };
    expect(freshAlerts(null, [a, b], base())).toEqual([]);
    expect(freshAlerts(new Set(["a"]), [a, b, c], base()).map((i) => i.id)).toEqual(["b", "c"]);
    const issuesOff = { ...base(), prefs: { ...DEFAULT_PREFS, issues: false } };
    expect(freshAlerts(new Set(["a"]), [a, b, c], issuesOff).map((i) => i.id)).toEqual(["c"]);
    // Already read (e.g. marked read in another tab) never rings.
    expect(freshAlerts(new Set(["a"]), [a, b], { ...base(), seen_at: iso(0) })).toEqual([]);
  });

  it("one sound per burst", () => {
    expect(shouldRing(null, 1000)).toBe(true);
    expect(shouldRing(1000, 5000)).toBe(false);
    expect(shouldRing(1000, 9000)).toBe(true);
  });

  it("time ago in plain words", () => {
    expect(timeAgo(iso(0), NOW)).toBe("Just now");
    expect(timeAgo(iso(12), NOW)).toBe("12m ago");
    expect(timeAgo(iso(180), NOW)).toBe("3h ago");
    expect(timeAgo(iso(60 * 30), NOW)).toBe("Yesterday");
    expect(timeAgo(iso(60 * 24 * 3), NOW)).toBe("3 days ago");
  });
});
