// Pure shaping of Brevo email campaigns for the Marketing > Email (Brevo)
// page. No fetch here so it stays unit-testable; src/lib/brevo.ts does the IO.

export type BrevoGlobalStats = {
  sent?: number;
  delivered?: number;
  uniqueViews?: number;
  uniqueClicks?: number;
  unsubscriptions?: number;
  hardBounces?: number;
  softBounces?: number;
  complaints?: number;
  appleMppOpens?: number;
};

export type BrevoCampaign = {
  id: number;
  name: string;
  subject?: string;
  status: string;
  sentDate?: string;
  scheduledAt?: string;
  createdAt?: string;
  statistics?: { globalStats?: BrevoGlobalStats };
};

export type CampaignRow = {
  id: number;
  name: string;
  subject: string;
  status: string;
  // sentDate, else scheduledAt, else createdAt; null when Brevo gave none.
  date: string | null;
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  unsubscribes: number;
  bounces: number;
  complaints: number;
  // Rates are percentages of delivered; null when nothing was delivered.
  openRate: number | null;
  clickRate: number | null;
};

export type CampaignSummary = {
  windowDays: number;
  campaignsSent: number;
  delivered: number;
  openRate: number | null;
  clickRate: number | null;
  unsubscribes: number;
  bounces: number;
  // Share of opens that are Apple Mail Privacy Protection auto-opens.
  mppShare: number | null;
};

export type CampaignsResponse = {
  summary: CampaignSummary;
  campaigns: CampaignRow[];
  fetchedAt: string;
};

const n = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

export function toRow(c: BrevoCampaign): CampaignRow {
  const g = c.statistics?.globalStats ?? {};
  const delivered = n(g.delivered);
  const opens = n(g.uniqueViews);
  const clicks = n(g.uniqueClicks);
  return {
    id: c.id,
    name: c.name,
    subject: c.subject ?? "",
    status: c.status,
    date: c.sentDate || c.scheduledAt || c.createdAt || null,
    sent: n(g.sent),
    delivered,
    opens,
    clicks,
    unsubscribes: n(g.unsubscriptions),
    bounces: n(g.hardBounces) + n(g.softBounces),
    complaints: n(g.complaints),
    openRate: pct(opens, delivered),
    clickRate: pct(clicks, delivered),
  };
}

// Headline numbers across campaigns that actually delivered mail in the last
// `windowDays`. A campaign cancelled mid-send still counts: its mail went out.
export function summarize(campaigns: BrevoCampaign[], now: Date, windowDays = 90): CampaignSummary {
  const since = now.getTime() - windowDays * 86_400_000;
  let campaignsSent = 0, delivered = 0, opens = 0, clicks = 0, unsubscribes = 0, bounces = 0, mpp = 0;
  for (const c of campaigns) {
    const row = toRow(c);
    if (row.delivered === 0 || !row.date) continue;
    const t = Date.parse(row.date);
    if (Number.isNaN(t) || t < since) continue;
    campaignsSent += 1;
    delivered += row.delivered;
    opens += row.opens;
    clicks += row.clicks;
    unsubscribes += row.unsubscribes;
    bounces += row.bounces;
    mpp += n(c.statistics?.globalStats?.appleMppOpens);
  }
  return {
    windowDays,
    campaignsSent,
    delivered,
    openRate: pct(opens, delivered),
    clickRate: pct(clicks, delivered),
    unsubscribes,
    bounces,
    mppShare: pct(mpp, opens),
  };
}

// Newest first by date; undated rows last.
export function sortRows(rows: CampaignRow[]): CampaignRow[] {
  return [...rows].sort((a, b) => (b.date ? Date.parse(b.date) : -Infinity) - (a.date ? Date.parse(a.date) : -Infinity));
}
