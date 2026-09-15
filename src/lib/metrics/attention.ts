// Pure aggregator for /api/metrics/attention — the "needs attention" feed
// that powers the Needs Attention page, the Home attention panel, and the
// sidebar/tab-bar badge counts. READ-ONLY: this module (and its route) must
// never send a message or call an edge function, only read rows and shape
// them into items. The route only fetches rows (already filtered to the
// candidate set each source cares about) and calls buildAttention(); all
// the money/date/sort logic lives here so it is unit-testable without a DB.

export type AttentionGroup = "money" | "customers" | "marketing";
export type AttentionSeverity = "crit" | "warn" | "info";

export type AttentionItem = {
  id: string;
  group: AttentionGroup;
  severity: AttentionSeverity;
  title: string;
  context: string;
  amount?: number;
  amountLabel?: string;
  href: string;
  cta: string;
  count?: number;
  // ISO timestamp of the oldest underlying record this item summarizes
  // (e.g. the earliest sale feeding a stock-out, the oldest COD order, the
  // oldest open ticket). Used only as the final sort tiebreak — oldest first.
  since?: string;
};

export type AttentionHub = "Today" | "Sales" | "Inbox" | "Marketing" | "Partners" | "System";

export type Attention = {
  items: AttentionItem[];
  counts: {
    open: number;
    byHub: Record<AttentionHub, number>;
    // COD needs-call order count and (tickets + drafts) count — the shell
    // needs these as raw counts, not item counts, for its badges.
    orders: number;
    inbox: number;
  };
};

// ---- Row inputs --------------------------------------------------------
// Every row type below is exactly what the route selects from Supabase,
// already filtered by the route's query to the candidate set (e.g. only
// wa_threads rows with ticket_status in open/pending, archived_at null).
// buildAttention does the money/date/threshold logic, not the WHERE clause.

export type AmazonInventoryRow = {
  seller_sku: string;
  product_name: string | null;
  fulfillable_quantity: number | string | null;
  inbound_shipped: number | string | null;
};

// amazon_finance_item_events rows for the trailing 30 days, any event_type
// (the aggregator itself only uses event_type === "Shipment" rows for units
// sold and average net per unit, per Task 0.4's resolved decision).
export type AmazonFinanceItemRow = {
  seller_sku: string | null;
  event_type: string | null;
  posted_date: string | null;
  quantity: number | string | null;
  net: number | string | null;
};

export type CodOrderRow = {
  shopify_id: string | number;
  total_price: number | string | null;
  shopify_created_at: string | null;
};

export type TicketRow = {
  id: string;
  ticket_opened_at: string | null;
};

export type EmailDraftRow = {
  id: string;
};

// Candidate campaigns: status === 'sending' with resume_at set (the real
// "deferred by Meta's daily marketing cap" signal — see report for why this
// isn't a 'paused' status + 131049 last_error, which don't exist in schema).
export type PausedCampaignRow = {
  id: string;
  name: string;
  resume_at: string | null;
};

export type AttentionInput = {
  now: Date;
  amazonInventory: AmazonInventoryRow[];
  amazonFinanceItems: AmazonFinanceItemRow[];
  codOrders: CodOrderRow[];
  tickets: TicketRow[];
  emailDrafts: EmailDraftRow[];
  pausedCampaigns: PausedCampaignRow[];
};

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

// Plain-words age for a "context" string — "oldest 3d", "oldest 6h",
// "oldest 40m". No fractional units, no error-code style formatting.
function formatAge(ms: number): string {
  if (ms < 0) return "0m";
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ms / HOUR_MS);
  if (hours >= 1) return `${hours}h`;
  const mins = Math.max(0, Math.floor(ms / MIN_MS));
  return `${mins}m`;
}

function oldestTs(rows: { ts: string | null }[]): string | null {
  let oldest: string | null = null;
  for (const r of rows) {
    if (!r.ts) continue;
    if (!oldest || r.ts < oldest) oldest = r.ts;
  }
  return oldest;
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = { crit: 0, warn: 1, info: 2 };

// Amazon listing titles run to 150+ characters of keywords. Keep the part
// before the first comma, pipe or bracket, and cap it, so a row reads as a
// product name rather than a search listing.
export function shortProductName(name: string | null | undefined): string {
  if (!name) return "";
  const head = name.split(/[,|(\-]/)[0].trim();
  return head.length > 48 ? head.slice(0, 45).trimEnd() + "…" : head;
}

export function buildAttention(input: AttentionInput): Attention {
  const { now } = input;
  const items: AttentionItem[] = [];

  // ---- 1. Amazon stock-outs + low-stock (group: money) -----------------
  // Per-SKU 30-day units sold + average net per unit, both from Shipment
  // events in amazon_finance_item_events (mirrors the real per-unit
  // economics the Amazon page already computes in src/app/api/amazon/route.ts,
  // which sources both figures from this table — see task report).
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const skuAgg = new Map<string, { units30: number; net30: number; since: string }>();
  for (const ev of input.amazonFinanceItems) {
    if (!ev.seller_sku) continue;
    if (ev.event_type !== "Shipment") continue;
    if (!ev.posted_date || ev.posted_date < since30) continue;
    const agg = skuAgg.get(ev.seller_sku) ?? { units30: 0, net30: 0, since: ev.posted_date };
    agg.units30 += num(ev.quantity);
    agg.net30 += num(ev.net);
    if (ev.posted_date < agg.since) agg.since = ev.posted_date;
    skuAgg.set(ev.seller_sku, agg);
  }

  const lowStock: { sku: string; title: string; daysCover: number; since: string }[] = [];
  for (const inv of input.amazonInventory) {
    const fulfillable = num(inv.fulfillable_quantity);
    const agg = skuAgg.get(inv.seller_sku);
    const units30 = agg?.units30 ?? 0;
    if (units30 <= 0) continue; // no recent sales velocity, nothing to flag
    const velocity = units30 / 30;
    const title = shortProductName(inv.product_name) || inv.seller_sku;

    if (fulfillable === 0) {
      const avgNetPerUnit = agg!.net30 / units30;
      const lostPerDay = velocity * avgNetPerUnit;
      items.push({
        id: `amazon-stockout-${inv.seller_sku}`,
        group: "money",
        severity: "crit",
        title: `${title} is out of stock on Amazon`,
        context: `${units30} sold in the last 30 days`,
        amount: round2(lostPerDay),
        amountLabel: "per day",
        href: "/dashboard/sales/amazon?tab=stock",
        cta: "Restock",
        since: agg!.since,
      });
      continue;
    }

    const daysCover = fulfillable / velocity;
    if (daysCover >= 1 && daysCover < 10) {
      lowStock.push({ sku: inv.seller_sku, title, daysCover, since: agg!.since });
    }
  }

  if (lowStock.length > 0) {
    lowStock.sort((a, b) => a.daysCover - b.daysCover);
    const soonest = Math.round(lowStock[0].daysCover);
    const oldestLowStock = lowStock.reduce((min, s) => (s.since < min ? s.since : min), lowStock[0].since);
    items.push({
      id: "amazon-low-stock",
      group: "money",
      severity: "warn",
      title: `${lowStock.length} Amazon SKU${lowStock.length === 1 ? "" : "s"} running low on stock`,
      context: `soonest runs out in ${soonest} day${soonest === 1 ? "" : "s"}`,
      count: lowStock.length,
      href: "/dashboard/sales/amazon?tab=stock",
      cta: "Restock",
      since: oldestLowStock,
    });
  }

  // ---- 2. COD needs-call orders (group: money) --------------------------
  if (input.codOrders.length > 0) {
    const sum = input.codOrders.reduce((s, o) => s + num(o.total_price), 0);
    const oldest = oldestTs(input.codOrders.map((o) => ({ ts: o.shopify_created_at })));
    const age = oldest ? formatAge(now.getTime() - new Date(oldest).getTime()) : "unknown";
    items.push({
      id: "cod-needs-call",
      group: "money",
      severity: "crit",
      title: `${input.codOrders.length} COD order${input.codOrders.length === 1 ? "" : "s"} waiting on a confirmation call`,
      context: `oldest ${age}`,
      amount: round2(sum),
      amountLabel: "on hold",
      count: input.codOrders.length,
      href: "/dashboard/sales/orders",
      cta: "Call list",
      since: oldest ?? undefined,
    });
  }

  // ---- 3. WhatsApp tickets open > 4h (group: customers) -----------------
  if (input.tickets.length > 0) {
    const oldest = oldestTs(input.tickets.map((t) => ({ ts: t.ticket_opened_at })));
    const age = oldest ? formatAge(now.getTime() - new Date(oldest).getTime()) : "unknown";
    items.push({
      id: "wa-tickets-open",
      group: "customers",
      severity: "warn",
      title: `${input.tickets.length} WhatsApp ticket${input.tickets.length === 1 ? "" : "s"} waiting over 4 hours`,
      context: `oldest ${age}`,
      count: input.tickets.length,
      href: "/dashboard/whatsapp?tab=tickets",
      cta: "Tickets",
      since: oldest ?? undefined,
    });
  }

  // ---- 4. Pending email drafts (group: customers) ------------------------
  if (input.emailDrafts.length > 0) {
    items.push({
      id: "email-drafts-pending",
      group: "customers",
      severity: "info",
      title: `${input.emailDrafts.length} email draft${input.emailDrafts.length === 1 ? "" : "s"} waiting for review`,
      context: "Ready to send once you approve",
      count: input.emailDrafts.length,
      href: "/dashboard/support-emails",
      cta: "Review",
    });
  }

  // ---- 5. Campaigns paused by Meta's marketing cap (group: marketing) ---
  const nowMs = now.getTime();
  for (const c of input.pausedCampaigns) {
    if (!c.resume_at) continue;
    if (new Date(c.resume_at).getTime() <= nowMs) continue; // already due to resume
    items.push({
      id: `campaign-paused-${c.id}`,
      group: "marketing",
      severity: "info",
      title: c.name,
      context: "Paused by Meta's daily marketing limit",
      href: "/dashboard/whatsapp?tab=campaigns",
      cta: "View",
    });
  }

  // ---- Sort: amount desc (items without an amount after), then severity,
  // then age (oldest `since` first) as the final tiebreak. -----------------
  items.sort((a, b) => {
    const aHas = a.amount != null;
    const bHas = b.amount != null;
    if (aHas && bHas && a.amount !== b.amount) return b.amount! - a.amount!;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    // Items with a known age sort before ones without (nothing to compare
    // an unknown age against); between two known ages, oldest (smallest
    // ISO timestamp) first.
    if (a.since && b.since && a.since !== b.since) return a.since < b.since ? -1 : 1;
    if (a.since && !b.since) return -1;
    if (!a.since && b.since) return 1;
    return 0;
  });

  // ---- Counts -------------------------------------------------------------
  const amazonItemCount = items.filter((i) => i.id.startsWith("amazon-")).length;
  const codItemCount = items.filter((i) => i.id === "cod-needs-call").length;
  const ticketItemCount = items.filter((i) => i.id === "wa-tickets-open").length;
  const draftItemCount = items.filter((i) => i.id === "email-drafts-pending").length;
  const campaignItemCount = items.filter((i) => i.id.startsWith("campaign-paused-")).length;

  const byHub: Record<AttentionHub, number> = {
    Today: items.length,
    Sales: amazonItemCount + codItemCount,
    Inbox: ticketItemCount + draftItemCount,
    Marketing: campaignItemCount,
    Partners: 0,
    System: 0,
  };

  return {
    items,
    counts: {
      open: items.length,
      byHub,
      orders: input.codOrders.length,
      inbox: input.tickets.length + input.emailDrafts.length,
    },
  };
}
