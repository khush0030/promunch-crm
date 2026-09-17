// Pure shaping for the Brevo hub (health, campaign detail, reports). No IO so
// it stays unit-testable; routes under src/app/api/brevo/ fetch and call these.

import type { BrevoGlobalStats } from "@/lib/brevo-campaigns";

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
// Capped at 100: Brevo can report more unique opens than delivered on tiny
// sends (forwards, proxy opens), which would read as nonsense.
const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, (part / whole) * 100) : null);

// ---- health -----------------------------------------------------------------

export type BrevoAccount = {
  companyName?: string;
  email?: string;
  plan?: { type: string; credits?: number; creditsType?: string; startDate?: string; endDate?: string }[];
  planVerticals?: { planCategory?: string; planType?: string; name?: string }[];
  relay?: { enabled?: boolean };
};
export type BrevoSender = { id: number; name: string; email: string; active: boolean };
export type DnsRecord = { type: string; value: string; host_name: string; status: boolean };
export type BrevoDomainConfig = {
  domain: string;
  verified: boolean;
  authenticated: boolean;
  dns_records?: Record<string, DnsRecord | null>;
};
export type BrevoWebhook = { id: number; url: string; type: string; events: string[]; description?: string; channel?: string };

export type HealthIssue = { tone: "crit" | "warn" | "info"; title: string; body: string };

export type PlanLine = { label: string; credits: number | null; creditsType: string | null; endDate: string | null; daysLeft: number | null };

export function planLines(account: BrevoAccount, now: Date): PlanLine[] {
  const verticals = account.planVerticals ?? [];
  return (account.plan ?? []).map((p, i) => {
    const end = p.endDate ? Date.parse(p.endDate) : NaN;
    const v = verticals[i];
    return {
      label: v?.name ? `${v.planCategory ?? ""} ${v.name}`.trim() : p.type,
      credits: typeof p.credits === "number" ? p.credits : null,
      creditsType: p.creditsType ?? null,
      endDate: p.endDate ?? null,
      daysLeft: Number.isNaN(end) ? null : Math.ceil((end - now.getTime()) / 86_400_000),
    };
  });
}

const DNS_LABEL: Record<string, string> = {
  dkim_record: "DKIM",
  dkim1Record: "DKIM 1",
  dkim2Record: "DKIM 2",
  brevo_code: "Brevo code",
  dmarc_record: "DMARC",
  spf_record: "SPF",
};

export type DnsRow = { key: string; label: string; type: string; host: string; value: string; ok: boolean };

export function dnsRows(cfg: BrevoDomainConfig): DnsRow[] {
  return Object.entries(cfg.dns_records ?? {})
    .filter((e): e is [string, DnsRecord] => e[1] != null)
    .map(([key, r]) => ({ key, label: DNS_LABEL[key] ?? key, type: r.type, host: r.host_name, value: r.value, ok: r.status === true }));
}

export function healthIssues(input: {
  plans: PlanLine[];
  senders: BrevoSender[];
  domains: BrevoDomainConfig[];
  webhooks: BrevoWebhook[] | null;
}): HealthIssue[] {
  const issues: HealthIssue[] = [];
  for (const p of input.plans) {
    if (p.daysLeft != null && p.daysLeft <= 3) {
      issues.push({
        tone: p.daysLeft < 0 ? "crit" : "warn",
        title: p.daysLeft < 0 ? `${p.label} period ended` : `${p.label} renews in ${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"}`,
        body: "Check billing in Brevo so campaign sends are not blocked.",
      });
    }
    if (p.credits != null && p.credits < 500 && p.creditsType === "sendLimit") {
      issues.push({ tone: "warn", title: `Only ${p.credits} email credits left`, body: "A campaign bigger than this will stop part-way." });
    }
  }
  for (const d of input.domains) {
    if (!d.authenticated || !d.verified) {
      issues.push({ tone: "crit", title: `${d.domain} is not authenticated`, body: "Emails from this domain are likely to land in spam. Fix the DNS records below." });
    }
    for (const r of dnsRows(d)) {
      if (!r.ok) issues.push({ tone: "crit", title: `${d.domain}: ${r.label} record failing`, body: `Add ${r.type} ${r.host} → ${r.value} at the DNS provider.` });
      if (r.key === "dmarc_record" && r.ok && /p=none/i.test(r.value)) {
        issues.push({
          tone: "info",
          title: `${d.domain}: DMARC policy is "none"`,
          body: "Mail is authenticated, but spoofed mail is not rejected. Move to p=quarantine once sending is stable.",
        });
      }
    }
  }
  for (const s of input.senders) {
    if (!s.active) issues.push({ tone: "warn", title: `Sender ${s.email} is inactive`, body: "Verify it in Brevo before using it on a campaign." });
  }
  if (input.webhooks != null && input.webhooks.length === 0) {
    issues.push({ tone: "info", title: "No webhooks registered", body: "Unsubscribes and bounces in Brevo are not reaching the CRM yet." });
  }
  return issues;
}

// ---- campaign detail --------------------------------------------------------

type ClickView = { clickers?: number; uniqueClicks?: number; viewed?: number; uniqueViews?: number; trackableViews?: number };

export type BrevoCampaignDetail = {
  id: number;
  name: string;
  subject?: string;
  previewText?: string;
  type?: string;
  status: string;
  tag?: string;
  sender?: { name?: string; email?: string };
  replyTo?: string;
  shareLink?: string;
  createdAt?: string;
  modifiedAt?: string;
  scheduledAt?: string;
  sentDate?: string;
  testSent?: boolean;
  abTesting?: boolean;
  recipients?: { lists?: number[]; exclusionLists?: number[]; segments?: number[]; excludedSegments?: number[] };
  statistics?: {
    globalStats?: BrevoGlobalStats & { viewed?: number; clickers?: number; trackableViews?: number; estimatedViews?: number; deferred?: number };
    campaignStats?: (BrevoGlobalStats & { listId: number; viewed?: number; clickers?: number; deferred?: number })[];
    linksStats?: Record<string, number>;
    statsByDomain?: Record<string, BrevoGlobalStats>;
    statsByDevice?: Record<string, Record<string, ClickView>>;
    statsByBrowser?: Record<string, ClickView>;
    remaining?: number;
  };
};

export type Funnel = {
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  unsubscribes: number;
  hardBounces: number;
  softBounces: number;
  complaints: number;
  mppOpens: number;
  deliveryRate: number | null;
  openRate: number | null;
  clickRate: number | null;
  clickToOpen: number | null;
  unsubRate: number | null;
};

export function funnel(g: (BrevoGlobalStats & Record<string, unknown>) | undefined): Funnel {
  const s = g ?? {};
  const sent = n(s.sent), delivered = n(s.delivered), opens = n(s.uniqueViews), clicks = n(s.uniqueClicks);
  return {
    sent,
    delivered,
    opens,
    clicks,
    unsubscribes: n(s.unsubscriptions),
    hardBounces: n(s.hardBounces),
    softBounces: n(s.softBounces),
    complaints: n(s.complaints),
    mppOpens: n(s.appleMppOpens),
    deliveryRate: pct(delivered, sent),
    openRate: pct(opens, delivered),
    clickRate: pct(clicks, delivered),
    clickToOpen: pct(clicks, opens),
    unsubRate: pct(n(s.unsubscriptions), delivered),
  };
}

export type BreakdownRow = { label: string; opens: number; clicks: number };

const DEVICE_LABEL: Record<string, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  tablet: "Tablet",
  unknown: "Unknown",
  androidmobile: "Android phone",
  iphone: "iPhone",
  androidtablet: "Android tablet",
  appleipad: "iPad",
  mac: "Mac",
  windows: "Windows",
  othersystem: "Other desktop",
};

const titleCase = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);

export function deviceRows(byDevice: Record<string, Record<string, ClickView>> | undefined): { groups: BreakdownRow[]; systems: BreakdownRow[] } {
  const groups: BreakdownRow[] = [];
  const systems: BreakdownRow[] = [];
  for (const [group, sys] of Object.entries(byDevice ?? {})) {
    let o = 0, c = 0;
    for (const [name, v] of Object.entries(sys ?? {})) {
      o += n(v.uniqueViews);
      c += n(v.uniqueClicks);
      systems.push({ label: DEVICE_LABEL[name.toLowerCase()] ?? titleCase(name), opens: n(v.uniqueViews), clicks: n(v.uniqueClicks) });
    }
    groups.push({ label: DEVICE_LABEL[group.toLowerCase()] ?? titleCase(group), opens: o, clicks: c });
  }
  const byOpens = (a: BreakdownRow, b: BreakdownRow) => b.opens - a.opens || b.clicks - a.clicks;
  return { groups: groups.sort(byOpens), systems: systems.filter((r) => r.opens || r.clicks).sort(byOpens) };
}

export function browserRows(byBrowser: Record<string, ClickView> | undefined): BreakdownRow[] {
  return Object.entries(byBrowser ?? {})
    .map(([k, v]) => ({ label: titleCase(k), opens: n(v.uniqueViews), clicks: n(v.uniqueClicks) }))
    .filter((r) => r.opens || r.clicks)
    .sort((a, b) => b.opens - a.opens || b.clicks - a.clicks);
}

export type LinkRow = { url: string; label: string; clicks: number };

export function linkRows(links: Record<string, number> | undefined): LinkRow[] {
  return Object.entries(links ?? {})
    .map(([url, clicks]) => {
      let label = url;
      try {
        const u = new URL(url);
        label = decodeURIComponent(`${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`);
      } catch {
        /* keep raw */
      }
      return { url, label, clicks: n(clicks) };
    })
    .sort((a, b) => b.clicks - a.clicks || a.label.localeCompare(b.label));
}

export type DomainRow = { domain: string } & Funnel;

export function domainRows(byDomain: Record<string, BrevoGlobalStats> | undefined): DomainRow[] {
  return Object.entries(byDomain ?? {})
    .map(([domain, s]) => ({ domain, ...funnel(s as BrevoGlobalStats & Record<string, unknown>) }))
    .sort((a, b) => b.delivered - a.delivered);
}

export type ListRow = { listId: number; name: string } & Funnel;

export function listRows(
  perList: NonNullable<BrevoCampaignDetail["statistics"]>["campaignStats"],
  names: Map<number, string>,
): ListRow[] {
  return (perList ?? [])
    .map((s) => ({ listId: s.listId, name: names.get(s.listId) ?? `List #${s.listId}`, ...funnel(s as BrevoGlobalStats & Record<string, unknown>) }))
    .sort((a, b) => b.delivered - a.delivered);
}

// Brevo sometimes returns zeroed link/device breakdowns even when the campaign
// has clicks (seen on the Aug 2026 Rakhi sends). Pages use this to say so
// instead of showing an all-zero chart as if nobody clicked.
export function breakdownMissing(f: Funnel, rows: { opens?: number; clicks: number }[]): boolean {
  const any = rows.some((r) => (r.opens ?? 0) > 0 || r.clicks > 0);
  return !any && (f.opens > 0 || f.clicks > 0);
}

// ---- reports ----------------------------------------------------------------

export type TrendCampaign = { date: string | null; delivered: number; opens: number; clicks: number; unsubscribes: number; bounces: number };
export type TrendBucket = { key: string; label: string; campaigns: number; delivered: number; opens: number; clicks: number; unsubscribes: number; bounces: number; openRate: number | null; clickRate: number | null };

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Monthly buckets in IST for the last `months` months (oldest first), zero-filled.
export function monthlyTrend(rows: TrendCampaign[], now: Date, months = 6): TrendBucket[] {
  const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000);
  const nowIst = ist(now);
  const buckets: TrendBucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.push({ key, label: `${MONTH[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, campaigns: 0, delivered: 0, opens: 0, clicks: 0, unsubscribes: 0, bounces: 0, openRate: null, clickRate: null });
  }
  const index = new Map(buckets.map((b) => [b.key, b]));
  for (const r of rows) {
    if (!r.date || r.delivered === 0) continue;
    const t = Date.parse(r.date);
    if (Number.isNaN(t)) continue;
    const d = ist(new Date(t));
    const b = index.get(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    if (!b) continue;
    b.campaigns += 1;
    b.delivered += r.delivered;
    b.opens += r.opens;
    b.clicks += r.clicks;
    b.unsubscribes += r.unsubscribes;
    b.bounces += r.bounces;
  }
  for (const b of buckets) {
    b.openRate = pct(b.opens, b.delivered);
    b.clickRate = pct(b.clicks, b.delivered);
  }
  return buckets;
}

export type DailyRow = { date: string; [metric: string]: number | string };

// Brevo daily reports skip days with no activity; fill them so charts have a
// continuous axis. Dates are YYYY-MM-DD.
export function fillDays(rows: DailyRow[], start: string, end: string, metrics: string[]): DailyRow[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: DailyRow[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    const src = byDate.get(date);
    const row: DailyRow = { date };
    for (const m of metrics) row[m] = n(src?.[m]);
    out.push(row);
  }
  return out;
}

// Brevo transactional statistics accept at most 30 days per request. Splits
// [start, end] (YYYY-MM-DD, inclusive) into consecutive windows of <= 30 days.
export function dateWindows(start: string, end: string, maxDays = 30): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  const last = Date.parse(`${end}T00:00:00Z`);
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= last; t += maxDays * 86_400_000) {
    const e = Math.min(t + (maxDays - 1) * 86_400_000, last);
    out.push({ start: new Date(t).toISOString().slice(0, 10), end: new Date(e).toISOString().slice(0, 10) });
  }
  return out;
}

// Sums numeric fields of several aggregate reports; non-numeric fields dropped.
export function sumAggregates(parts: Record<string, unknown>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) if (typeof v === "number") out[k] = (out[k] ?? 0) + v;
  return out;
}

export function istDate(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
