import { NextResponse } from "next/server";
import { brevoGet, BrevoError, listEmailCampaigns, section, type Section } from "@/lib/brevo";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { summarize, toRow, type CampaignSummary } from "@/lib/brevo-campaigns";
import { monthlyTrend, fillDays, istDate, dateWindows, sumAggregates, type TrendBucket, type DailyRow } from "@/lib/brevo-shape";

// Cross-channel Brevo reporting: email campaign trend, transactional email,
// SMS, and WhatsApp (report-only). Read-only. Middleware gates /api/*.
//
// GET /api/brevo/reports?days=7|30|90[&fresh=1]
export const dynamic = "force-dynamic";

type Days = 7 | 30 | 90;
const parseDays = (raw: string | null): Days => (raw === "7" ? 7 : raw === "90" ? 90 : 30);

type SmtpAggregate = Record<string, number>;
type WaEvent = { event: string; date: string; contactNumber?: string; messageId?: string };

export type ReportsResponse = {
  days: Days;
  range: { start: string; end: string };
  campaigns: Section<{ summary: CampaignSummary; trend: TrendBucket[] }>;
  transactional: Section<{ totals: SmtpAggregate; daily: DailyRow[] }>;
  sms: Section<{ totals: SmtpAggregate; daily: DailyRow[] }>;
  whatsapp: Section<{ counts: Record<string, number>; total: number }>;
  // Brevo's own revenue attribution (needs Brevo eCommerce activated).
  brevoRevenue: Section<{ totals: Record<string, unknown>; results: Record<string, unknown>[] }>;
  // Shopify orders whose UTM tags say they came from a Brevo email.
  emailOrders: Section<{ orders: number; revenue: number; byCampaign: { campaign: string; orders: number; revenue: number }[]; totalOrders: number; untracked: number }>;
  // Webhook events received in the window (brevo_events).
  engagement: Section<{ total: number; byEvent: Record<string, number>; topLinks: { url: string; clicks: number }[] }>;
  fetchedAt: string;
};

const EMAIL_UTM = /brevo|sendinblue/i;

async function emailOrders(sinceIso: string) {
  const { data, error } = await supabaseAdmin
    .from("shopify_orders")
    .select("total_price, is_creator, first_utm_source, first_utm_medium, first_utm_campaign, last_utm_source, last_utm_medium, last_utm_campaign")
    .gte("shopify_created_at", sinceIso)
    .limit(5000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter((o) => !o.is_creator && Number(o.total_price) > 0.01);
  const byCampaign = new Map<string, { orders: number; revenue: number }>();
  let orders = 0, revenue = 0, untracked = 0;
  for (const o of rows) {
    if (!o.first_utm_source && !o.last_utm_source) untracked += 1;
    const fromEmail = EMAIL_UTM.test(`${o.last_utm_source ?? ""} ${o.first_utm_source ?? ""}`) || (o.last_utm_medium ?? o.first_utm_medium) === "email";
    if (!fromEmail) continue;
    const price = Number(o.total_price) || 0;
    orders += 1;
    revenue += price;
    const key = (o.last_utm_campaign ?? o.first_utm_campaign ?? "untagged") as string;
    const c = byCampaign.get(key) ?? { orders: 0, revenue: 0 };
    c.orders += 1;
    c.revenue += price;
    byCampaign.set(key, c);
  }
  return {
    orders,
    revenue: Math.round(revenue),
    byCampaign: [...byCampaign.entries()].map(([campaign, v]) => ({ campaign, orders: v.orders, revenue: Math.round(v.revenue) })).sort((a, b) => b.revenue - a.revenue),
    totalOrders: rows.length,
    untracked,
  };
}

async function engagement(sinceIso: string) {
  const { data, error } = await supabaseAdmin.from("brevo_events").select("event, url").gte("occurred_at", sinceIso).limit(50000);
  if (error) {
    if (/brevo_events/.test(error.message)) throw new BrevoError(403, "permission_denied", "Webhook ledger not set up yet: apply the Brevo migration and register webhooks (Health tab).");
    throw new Error(error.message);
  }
  const byEvent: Record<string, number> = {};
  const links = new Map<string, number>();
  for (const r of data ?? []) {
    byEvent[r.event as string] = (byEvent[r.event as string] ?? 0) + 1;
    if (r.event === "click" && r.url) links.set(r.url as string, (links.get(r.url as string) ?? 0) + 1);
  }
  return { total: data?.length ?? 0, byEvent, topLinks: [...links.entries()].map(([url, clicks]) => ({ url, clicks })).sort((a, b) => b.clicks - a.clicks).slice(0, 10) };
}

const SMTP_METRICS = ["requests", "delivered", "opens", "uniqueOpens", "clicks", "uniqueClicks", "hardBounces", "softBounces", "spamReports", "blocked", "invalid", "unsubscribed"];
const SMS_METRICS = ["requests", "delivered", "hardBounces", "softBounces", "blocked", "unsubscribed", "replied", "accepted", "rejected"];

const cache = new Map<Days, { at: number; body: ReportsResponse }>();
const CACHE_TTL_MS = 5 * 60_000;

// Brevo's transactional statistics allow 30 days per call: split, then merge.
async function windowed(base: string, start: string, end: string, metrics: string[]) {
  const windows = dateWindows(start, end);
  const parts = await Promise.all(
    windows.map((w) =>
      Promise.all([
        brevoGet<Record<string, unknown>>(`${base}/aggregatedReport?startDate=${w.start}&endDate=${w.end}`),
        brevoGet<{ reports?: DailyRow[] }>(`${base}/reports?startDate=${w.start}&endDate=${w.end}&sort=asc`),
      ]),
    ),
  );
  return {
    totals: sumAggregates(parts.map((p) => p[0])),
    daily: fillDays(parts.flatMap((p) => p[1].reports ?? []), start, end, metrics),
  };
}

// Brevo answers SMS statistics with a 500 "invalid_request" on accounts that
// have never set SMS up. That is "not set up", not an outage.
async function smsReport(start: string, end: string) {
  try {
    return await windowed("/transactionalSMS/statistics", start, end, SMS_METRICS);
  } catch (e) {
    if (e instanceof BrevoError && e.code === "invalid_request") {
      throw new BrevoError(403, "permission_denied", "SMS is not set up on this Brevo account yet (needs an SMS sender and credits).");
    }
    throw e;
  }
}

async function whatsappReport(days: Days) {
  const counts: Record<string, number> = {};
  let total = 0;
  for (let offset = 0; offset < 2500; offset += 500) {
    const { events } = await brevoGet<{ events?: WaEvent[] }>(`/whatsapp/statistics/events?days=${days}&limit=500&offset=${offset}`);
    for (const ev of events ?? []) {
      counts[ev.event] = (counts[ev.event] ?? 0) + 1;
      total += 1;
    }
    if ((events ?? []).length < 500) break;
  }
  return { counts, total };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = parseDays(url.searchParams.get("days"));
  const hit = cache.get(days);
  if (url.searchParams.get("fresh") !== "1" && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.body, { headers: { "x-cache": "hit" } });
  }
  const now = new Date();
  const end = istDate(now);
  const start = istDate(new Date(now.getTime() - (days - 1) * 86_400_000));

  const sinceIso = new Date(`${start}T00:00:00+05:30`).toISOString();
  const [campaigns, transactional, sms, whatsapp, brevoRevenue, emailOrdersRes, engagementRes] = await Promise.all([
    section(
      listEmailCampaigns().then((list) => ({
        summary: summarize(list, now, days),
        trend: monthlyTrend(list.map(toRow), now, 6),
      })),
    ),
    section(windowed("/smtp/statistics", start, end, SMTP_METRICS)),
    section(smsReport(start, end)),
    section(whatsappReport(days)),
    section(
      brevoGet<{ totals?: Record<string, unknown>; results?: Record<string, unknown>[] }>(
        `/ecommerce/attribution/metrics?periodFrom=${encodeURIComponent(sinceIso)}&periodTo=${encodeURIComponent(now.toISOString())}`,
      ).then((r) => ({ totals: r.totals ?? {}, results: r.results ?? [] })),
    ),
    section(emailOrders(sinceIso)),
    section(engagement(sinceIso)),
  ]);

  const body: ReportsResponse = {
    days,
    range: { start, end },
    campaigns,
    transactional,
    sms,
    whatsapp,
    brevoRevenue,
    emailOrders: emailOrdersRes,
    engagement: engagementRes,
    fetchedAt: now.toISOString(),
  };
  cache.set(days, { at: Date.now(), body });
  return NextResponse.json(body, { headers: { "x-cache": "miss" } });
}
