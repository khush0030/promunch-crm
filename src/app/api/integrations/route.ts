import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Integration health endpoint.
// Reads connector_events (written by the Supabase edge functions) plus a few
// live tables, derives a status per connector, and returns a recent event log.
// Powers the Integrations page and the dashboard "connector down" banner.

export const dynamic = "force-dynamic";

type Status = "healthy" | "degraded" | "down" | "unknown";

type ConnectorEvent = {
  id: string;
  connector: string;
  level: "info" | "warn" | "error";
  event: string;
  message: string | null;
  detail: Record<string, unknown> | null;
  ref: string | null;
  created_at: string;
};

const RANK: Record<Status, number> = { healthy: 0, unknown: 1, degraded: 2, down: 3 };
const worst = (a: Status, b: Status): Status => (RANK[a] >= RANK[b] ? a : b);

function ageHours(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

// Generic status from a connector's recent events (newest first).
function statusFromEvents(events: ConnectorEvent[]): Status {
  if (events.length === 0) return "unknown";
  const newest = events[0];
  if (newest.level === "error") return "down";
  if (newest.level === "warn") return "degraded";
  const errIn24h = events.some(
    (e) => e.level === "error" && (ageHours(e.created_at) ?? 99) < 24,
  );
  return errIn24h ? "degraded" : "healthy";
}

export async function GET() {
  const since7d = new Date(Date.now() - 7 * 86400_000).toISOString();
  const since24h = new Date(Date.now() - 86400_000).toISOString();

  const [eventsRes, watchRes, failedRes, recentEmailRes, lastReceivedRes, shopifyRes] =
    await Promise.all([
      supabaseAdmin
        .from("connector_events")
        .select("*")
        .gte("created_at", since7d)
        .order("created_at", { ascending: false })
        .limit(300),
      supabaseAdmin.from("gmail_watch").select("*").limit(1).maybeSingle(),
      supabaseAdmin
        .from("email_threads")
        .select("id", { count: "exact", head: true })
        .eq("draft_status", "failed"),
      supabaseAdmin
        .from("email_threads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since24h),
      supabaseAdmin
        .from("email_logs")
        .select("created_at")
        .eq("event_type", "received")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("shopify_orders")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const events: ConnectorEvent[] = (eventsRes.data as ConnectorEvent[]) || [];
  const byConnector = (id: string) => events.filter((e) => e.connector === id);
  const lastError = (id: string) => byConnector(id).find((e) => e.level === "error") || null;

  const failedDrafts = failedRes.count ?? 0;
  const emailsLast24h = recentEmailRes.count ?? 0;
  const lastReceivedAt = lastReceivedRes.data?.created_at ?? null;
  const watch = watchRes.data as
    | { expiration: string | null; last_renewed_at: string | null }
    | null;
  const lastShopifyOrderAt = shopifyRes.data?.created_at ?? null;

  const connectors: {
    id: string;
    label: string;
    description: string;
    status: Status;
    headline: string;
    lastError: { message: string | null; at: string } | null;
    lastEventAt: string | null;
    metrics: { label: string; value: string }[];
  }[] = [];

  // 1. Gmail intake -----------------------------------------------------------
  {
    const ev = byConnector("gmail_pipeline").concat(byConnector("gmail_watch"))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    let status = statusFromEvents(ev);
    const watchAgeH = ageHours(watch?.expiration);
    const watchExpired = watchAgeH != null && watchAgeH > 0;
    const err = lastError("gmail_pipeline") || lastError("gmail_watch");

    let headline = "Receiving new emails normally.";
    if (!watch?.expiration) {
      status = worst(status, "degraded");
      headline = "No Gmail push watch on record — relying on the 2-minute poll only.";
    } else if (watchExpired) {
      status = "down";
      headline = "Gmail push watch has EXPIRED — new emails will not arrive until it is renewed.";
    } else if (watchAgeH != null && watchAgeH > -48) {
      status = worst(status, "degraded");
      headline = "Gmail push watch expires within 48h — renewal cron should refresh it.";
    }
    // If unhealthy for a reason other than watch expiry, show the real error.
    if (err && !watchExpired && (status === "down" || status === "degraded")) {
      headline = err.message || headline;
    }
    connectors.push({
      id: "gmail_pipeline",
      label: "Email intake (Gmail)",
      description: "Pulls new mail from hello@promunch.in into the CRM.",
      status,
      headline,
      lastError: err ? { message: err.message, at: err.created_at } : null,
      lastEventAt: ev[0]?.created_at ?? lastReceivedAt,
      metrics: [
        { label: "Emails received (24h)", value: String(emailsLast24h) },
        {
          label: "Watch expires",
          value: watch?.expiration
            ? new Date(watch.expiration).toLocaleString("en-IN")
            : "—",
        },
        {
          label: "Last email received",
          value: lastReceivedAt ? new Date(lastReceivedAt).toLocaleString("en-IN") : "—",
        },
      ],
    });
  }

  // 2. AI drafting (Claude) ---------------------------------------------------
  {
    const ev = byConnector("anthropic");
    let status = statusFromEvents(ev);
    const err = lastError("anthropic");
    let headline = "AI drafting is working.";
    if (status === "unknown") {
      headline = "No support emails have needed a draft in the last 7 days.";
    } else if (ev[0]?.event === "draft_recovered") {
      status = "healthy";
      headline = "AI drafting recovered and is working.";
    } else if (ev[0]?.event === "credits_exhausted") {
      status = "down";
      headline =
        "Anthropic API is out of credits — emails are still delivered to Slack without a draft. Top up at console.anthropic.com.";
    } else if (ev[0]?.level === "error") {
      status = "down";
      headline = err?.message || "AI drafting is failing.";
    }
    connectors.push({
      id: "anthropic",
      label: "AI drafting (Claude)",
      description: "Generates the suggested reply for each support email.",
      status,
      headline,
      lastError: err ? { message: err.message, at: err.created_at } : null,
      lastEventAt: ev[0]?.created_at ?? null,
      metrics: [{ label: "Emails awaiting a draft", value: String(failedDrafts) }],
    });
  }

  // 3. AI Email -> Slack ------------------------------------------------------
  {
    const ev = byConnector("email_slack");
    let status = statusFromEvents(ev);
    const err = lastError("email_slack");
    let headline = "Support emails are posting to Slack.";
    if (status === "unknown")
      headline = "No support emails have been posted to Slack in the last 7 days.";
    if (status === "down") headline = err?.message || "Failed to post emails to Slack.";
    if (failedDrafts > 0 && status !== "down") {
      status = worst(status, "degraded");
      headline = `${failedDrafts} email${failedDrafts === 1 ? "" : "s"} posted to Slack without an AI draft (drafting unavailable). They auto-retry every 2 min.`;
    }
    connectors.push({
      id: "email_slack",
      label: "AI Email → Slack",
      description: "Posts each support email + AI draft to the Slack channel.",
      status,
      headline,
      lastError: err ? { message: err.message, at: err.created_at } : null,
      lastEventAt: ev[0]?.created_at ?? null,
      metrics: [
        { label: "Emails awaiting a draft", value: String(failedDrafts) },
        { label: "Emails received (24h)", value: String(emailsLast24h) },
      ],
    });
  }

  // 4. Shopify Orders -> Slack ------------------------------------------------
  {
    const ev = byConnector("shopify_slack");
    const status = statusFromEvents(ev);
    const err = lastError("shopify_slack");
    let headline = "Shopify order alerts are posting to Slack.";
    if (status === "down") headline = err?.message || "Failed to post Shopify orders to Slack.";
    else if (status === "unknown")
      headline = "No order webhooks received yet — waiting for the first Shopify order.";
    connectors.push({
      id: "shopify_slack",
      label: "Shopify Orders → Slack",
      description: "Posts each new Shopify order to the Slack channel.",
      status,
      headline,
      lastError: err ? { message: err.message, at: err.created_at } : null,
      lastEventAt: ev[0]?.created_at ?? lastShopifyOrderAt,
      metrics: [
        {
          label: "Last order",
          value: lastShopifyOrderAt
            ? new Date(lastShopifyOrderAt).toLocaleString("en-IN")
            : "—",
        },
      ],
    });
  }

  const overall = connectors.reduce<Status>((acc, c) => worst(acc, c.status), "healthy");

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    overall,
    connectors,
    events: events.slice(0, 60),
  });
}
