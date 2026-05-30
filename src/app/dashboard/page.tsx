"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import ConnectorBanner from "@/components/ConnectorBanner";
import NeedsAttention from "@/components/NeedsAttention";

type Period = "today" | "7d" | "30d" | "90d" | "all";

const periodLabel: Record<Period, string> = {
  today: "today",
  "7d": "last 7 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
  all: "all time",
};

// Lower bound (ISO) for a period, or null for all-time. "today" = since local midnight.
function sinceForPeriod(period: Period): string | null {
  if (period === "all") return null;
  if (period === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 86400_000).toISOString();
}

// Human-readable "time since" for webhook freshness.
function relTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

interface CampaignRow {
  name: string;
  sent: string;
  openRate: string;
  clickRate: string;
  revenue: string;
}
interface FlowRow {
  name: string;
  revenue: string;
}
interface ListHealth {
  total: number;
  active: number;
  inactive: number;
  bounced: number;
  unsubscribed: number;
}
interface Kpis {
  revenue: number;
  ordersCount: number;
  activeSubscribers: number;
  newSubscribers: number;
  openRate: number;
  totalSent: number;
  flowRevenue: number;
}
type ChannelRow = {
  label: string;
  status: "ok" | "warn" | "off";
  detail?: string;
  pill?: string; // overrides default pill text (Connected / Configured / Not connected)
};

// Live connection status — re-runs against the DB on a poll so the Channels
// card reflects reality without a manual sync.
async function detectChannels(): Promise<ChannelRow[]> {
  const ch: ChannelRow[] = [];
  // Shopify
  const { count: shopifyOrderCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("source", "shopify");
  ch.push(
    shopifyOrderCount && shopifyOrderCount > 0
      ? {
          label: "Shopify",
          status: "ok",
          detail: `${shopifyOrderCount.toLocaleString("en-IN")} orders synced`,
        }
      : { label: "Shopify", status: "off", detail: "Not connected" }
  );
  // Klaviyo
  const { count: klaviyoCount } = await supabase
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .not("klaviyo_id", "is", null);
  ch.push(
    klaviyoCount && klaviyoCount > 0
      ? {
          label: "Klaviyo",
          status: "ok",
          detail: `${klaviyoCount.toLocaleString("en-IN")} contacts imported`,
        }
      : { label: "Klaviyo", status: "off", detail: "Not connected" }
  );
  // Email
  ch.push({
    label: "Email (Resend)",
    status: process.env.NEXT_PUBLIC_RESEND_CONFIGURED === "true" ? "ok" : "warn",
    detail:
      process.env.NEXT_PUBLIC_RESEND_CONFIGURED === "true"
        ? "Configured"
        : "API key set server-side",
  });
  // WhatsApp — derive status from the same /api/whatsapp/health endpoint the
  // WhatsApp page's StatusMeter uses, so the Dashboard and WhatsApp page agree.
  // The inbox runs off wa_threads + the Cloud API, not the wa_contacts table.
  try {
    const r = await fetch("/api/whatsapp/health");
    const h = await r.json();
    if (h?.status === "up") {
      ch.push({
        label: "WhatsApp",
        status: "ok",
        detail:
          h.uptime24h != null ? `Operational · ${h.uptime24h}% uptime 24h` : "Operational",
      });
    } else if (h?.status === "down") {
      ch.push({
        label: "WhatsApp",
        status: "warn",
        detail: "Cloud API not responding",
        pill: "Degraded",
      });
    } else {
      throw new Error("health unknown");
    }
  } catch {
    // Fallback: any conversation thread means WhatsApp is live and handling messages.
    const { count: waThreadCount } = await supabase
      .from("wa_threads")
      .select("id", { count: "exact", head: true });
    ch.push(
      waThreadCount && waThreadCount > 0
        ? {
            label: "WhatsApp",
            status: "ok",
            detail: `${waThreadCount.toLocaleString("en-IN")} conversations`,
          }
        : { label: "WhatsApp", status: "off", detail: "Not connected" }
    );
  }
  // Nitro (NitroCommerce) webhook — health = events received + how recently
  const { count: nitroCount } = await supabase
    .from("nitro_events")
    .select("id", { count: "exact", head: true });
  const { data: lastNitro } = await supabase
    .from("nitro_events")
    .select("received_at, event_name")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (nitroCount && nitroCount > 0 && lastNitro?.received_at) {
    const ageMs = Date.now() - new Date(lastNitro.received_at).getTime();
    const fresh = ageMs < 24 * 3600_000;
    ch.push({
      label: "Nitro webhook",
      status: fresh ? "ok" : "warn",
      detail: `${nitroCount.toLocaleString("en-IN")} events · last ${relTime(ageMs)}`,
      pill: fresh ? "Live" : "No recent events",
    });
  } else {
    ch.push({
      label: "Nitro webhook",
      status: "off",
      detail: "No events received yet",
    });
  }
  return ch;
}

// Shown in place of a money KPI when no Shopify order has ever synced — a
// dead "₹0" invites a connection instead of looking like a real metric.
function ConnectTile({ label }: { label: string }) {
  return (
    <a href="/dashboard/integrations" className="kpi" style={{ display: "block" }}>
      <div className="ico" style={{ background: "var(--accent-soft)" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
          <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      </div>
      <div className="label">{label}</div>
      <div
        className="value"
        style={{ fontSize: 16, fontWeight: 600, color: "var(--accent)", letterSpacing: "-0.01em" }}
      >
        Connect Shopify →
      </div>
      <div className="delta flat">Appears once orders sync</div>
    </a>
  );
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("today");
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [listHealth, setListHealth] = useState<ListHealth | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // hasOrders = at least one order ever (not just in range). Drives the
  // "Connect Shopify" KPI cards. Defaults true so the real tiles don't flash.
  const [hasOrders, setHasOrders] = useState(true);

  async function load(opts?: { silent?: boolean }) {
    if (!opts?.silent) setRefreshing(true);
    try {
      const sinceIso = sinceForPeriod(period);

      // Orders: filter by placed_at (fallback to created_at)
      let ordersQ = supabase.from("orders").select("total_amount, placed_at, created_at");
      if (sinceIso) ordersQ = ordersQ.gte("placed_at", sinceIso);
      const [contactsRes, campaignsRes, flowsRes, ordersRes, ordersEverRes] =
        await Promise.all([
          supabase.from("contacts").select("id, status, created_at"),
          sinceIso
            ? supabase
                .from("campaigns")
                .select("*")
                .gte("created_at", sinceIso)
                .order("created_at", { ascending: false })
            : supabase
                .from("campaigns")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(5),
          supabase.from("flows").select("*").eq("status", "active"),
          ordersQ,
          // All-time order count — drives the "Connect Shopify" KPI cards.
          supabase.from("orders").select("id", { count: "exact", head: true }),
        ]);
      setHasOrders((ordersEverRes.count ?? 0) > 0);

      const contactRows = contactsRes.data || [];
      const activeCount = contactRows.filter((c) => c.status === "active").length;
      const inactiveCount = contactRows.filter((c) => c.status === "inactive").length;
      const bouncedCount = contactRows.filter((c) => c.status === "bounced").length;
      const unsubCount = contactRows.filter((c) => c.status === "unsubscribed").length;
      const total = contactRows.length;
      const newSubs = sinceIso
        ? contactRows.filter((c) => c.created_at && c.created_at >= sinceIso).length
        : total;

      const orderRows = ordersRes.data || [];
      const totalRevenue = orderRows.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

      const campaignRows = campaignsRes.data || [];
      const totalSent = campaignRows.reduce((s, c) => s + (c.total_sent || 0), 0);
      const totalOpened = campaignRows.reduce((s, c) => s + (c.total_opened || 0), 0);
      const flowRevenue = (flowsRes.data || []).reduce(
        (s, f) => s + (Number(f.revenue_attributed) || 0),
        0
      );

      setKpis({
        revenue: totalRevenue,
        ordersCount: orderRows.length,
        activeSubscribers: activeCount,
        newSubscribers: newSubs,
        openRate: totalSent > 0 ? (totalOpened / totalSent) * 100 : 0,
        totalSent,
        flowRevenue,
      });

      setCampaigns(
        campaignRows.slice(0, 5).map((c) => ({
          name: c.name,
          sent: c.total_sent > 0 ? c.total_sent.toLocaleString() : "0",
          openRate:
            c.total_sent > 0 ? ((c.total_opened / c.total_sent) * 100).toFixed(1) + "%" : "0%",
          clickRate:
            c.total_sent > 0 ? ((c.total_clicked / c.total_sent) * 100).toFixed(1) + "%" : "0%",
          revenue:
            c.revenue_attributed > 0
              ? `₹${Number(c.revenue_attributed).toLocaleString("en-IN")}`
              : "₹0",
        }))
      );

      setFlows(
        (flowsRes.data || []).slice(0, 4).map((f) => ({
          name: f.name,
          revenue:
            f.revenue_attributed > 0
              ? `₹${Number(f.revenue_attributed).toLocaleString("en-IN")}`
              : "₹0",
        }))
      );

      setListHealth({
        total,
        active: activeCount,
        inactive: inactiveCount,
        bounced: bouncedCount,
        unsubscribed: unsubCount,
      });

      setChannels(await detectChannels());

      setLoaded(true);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // Keep the dashboard live: silently re-pull KPIs (revenue for the selected
  // period — "today" by default), channels and lists every 30s and on focus.
  useEffect(() => {
    const refresh = () => load({ silent: true });
    const id = setInterval(refresh, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  if (!loaded || !kpis) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1>Dashboard</h1>
            <div className="sub">Loading…</div>
          </div>
        </div>
      </div>
    );
  }

  const activePct =
    listHealth && listHealth.total > 0 ? (listHealth.active / listHealth.total) * 100 : 0;

  const legendItems: { label: string; value: number; color: string }[] = listHealth
    ? [
        { label: "Active", value: listHealth.active, color: "var(--green)" },
        { label: "Inactive", value: listHealth.inactive, color: "var(--blue)" },
        { label: "Bounced", value: listHealth.bounced, color: "var(--accent)" },
        { label: "Unsubscribed", value: listHealth.unsubscribed, color: "var(--text-3)" },
      ]
    : [];

  const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const period_label = periodLabel[period];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">Overview of your CRM activity · {period_label}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="chips">
            {(Object.keys(periodLabel) as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                className={`chip${period === p ? " active" : ""}`}
                onClick={() => setPeriod(p)}
              >
                {p === "all"
                  ? "All time"
                  : p === "today"
                  ? "Today"
                  : `Last ${p.replace("d", " days")}`}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => load()}
            disabled={refreshing}
            aria-label="Refresh"
          >
            <RefreshCw size={14} /> {refreshing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      <ConnectorBanner />

      <NeedsAttention />

      <div className="kpi-grid">
        {hasOrders ? (
          <div className="kpi">
            <div className="ico" style={{ background: "var(--green-soft)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2">
                <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <div className="label">
              Revenue · <span className="muted">{period_label}</span>
            </div>
            <div className="value">{inr(kpis.revenue)}</div>
            <div className={`delta ${kpis.ordersCount > 0 ? "up" : "flat"}`}>
              {kpis.ordersCount > 0
                ? `${kpis.ordersCount.toLocaleString("en-IN")} order${kpis.ordersCount === 1 ? "" : "s"} in range`
                : "No orders in range"}
            </div>
          </div>
        ) : (
          <ConnectTile label="Revenue" />
        )}

        <div className="kpi">
          <div className="ico" style={{ background: "var(--blue-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
            </svg>
          </div>
          <div className="label">
            Active subscribers · <span className="muted">now</span>
          </div>
          <div className="value">{kpis.activeSubscribers.toLocaleString("en-IN")}</div>
          <div className={`delta ${kpis.newSubscribers > 0 ? "up" : "flat"}`}>
            {kpis.newSubscribers > 0
              ? `▲ ${kpis.newSubscribers.toLocaleString("en-IN")} new in ${period_label}`
              : `No new in ${period_label}`}
          </div>
        </div>

        <div className="kpi">
          <div className="ico" style={{ background: "var(--accent-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
          </div>
          <div className="label">
            Email open rate · <span className="muted">{period_label}</span>
          </div>
          <div className="value">
            {kpis.totalSent > 0 ? `${kpis.openRate.toFixed(1)}%` : "—"}
          </div>
          <div className={`delta ${kpis.totalSent > 0 ? "up" : "flat"}`}>
            {kpis.totalSent > 0
              ? `${kpis.totalSent.toLocaleString("en-IN")} email${kpis.totalSent === 1 ? "" : "s"} sent`
              : "No campaigns sent in range"}
          </div>
        </div>

        {hasOrders ? (
          <div className="kpi">
            <div className="ico" style={{ background: "var(--amber-soft)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2">
                <path d="M3 17 9 11l4 4 8-8" />
                <path d="M17 7h4v4" />
              </svg>
            </div>
            <div className="label">
              Flow revenue · <span className="muted">all time</span>
            </div>
            <div className="value">{inr(kpis.flowRevenue)}</div>
            <div className={`delta ${kpis.flowRevenue > 0 ? "up" : "flat"}`}>
              {kpis.flowRevenue > 0 ? "From active flows" : "No flow revenue yet"}
            </div>
          </div>
        ) : (
          <ConnectTile label="Flow revenue" />
        )}
      </div>

      {listHealth && listHealth.total > 0 && (
        <div className="grid-2 section">
          <div className="card card-pad">
            <div className="card-title">List health</div>
            <div className="card-sub">
              {listHealth.total.toLocaleString("en-IN")} total contacts
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 26,
                marginTop: 18,
              }}
            >
              <div
                className="donut"
                style={{
                  background: `conic-gradient(var(--green) 0 ${activePct}%, var(--hover-2) ${activePct}% 100%)`,
                }}
              >
                <div className="hole">
                  <b>{Math.round(activePct)}%</b>
                  <span>Active</span>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                {legendItems.map((it) => {
                  const pct =
                    listHealth.total > 0
                      ? ((it.value / listHealth.total) * 100).toFixed(0)
                      : "0";
                  return (
                    <div key={it.label} className="legend-row">
                      <div className="legend-l">
                        <span className="dot" style={{ background: it.color }} />
                        {it.label}
                      </div>
                      <div className="legend-r">
                        <b>{it.value.toLocaleString("en-IN")}</b>
                        {pct}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-title">Channels</div>
            <div className="card-sub">Connected data sources</div>
            <div style={{ marginTop: 16 }}>
              {channels.map((c) => (
                <div key={c.label} className="legend-row">
                  <div className="legend-l">
                    <span
                      className="dot"
                      style={{
                        background:
                          c.status === "ok"
                            ? "var(--green)"
                            : c.status === "warn"
                            ? "var(--amber)"
                            : "var(--text-3)",
                      }}
                    />
                    {c.label}
                    {c.detail && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {" "}· {c.detail}
                      </span>
                    )}
                  </div>
                  <span
                    className={`pill ${
                      c.status === "ok" ? "green" : c.status === "warn" ? "amber" : "grey"
                    }`}
                  >
                    {c.pill ??
                      (c.status === "ok"
                        ? "Connected"
                        : c.status === "warn"
                        ? "Configured"
                        : "Not connected")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {(campaigns.length > 0 || flows.length > 0) && (
        <div
          className={campaigns.length && flows.length ? "grid-2" : ""}
          style={{ marginTop: 16 }}
        >
          {campaigns.length > 0 && (
            <div className="card card-pad">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 14,
                }}
              >
                <div>
                  <div className="card-title">Recent campaigns</div>
                  <div className="card-sub">{period_label}</div>
                </div>
                <a
                  href="/dashboard/campaigns"
                  style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 500 }}
                >
                  View all →
                </a>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Sent</th>
                    <th>Open</th>
                    <th>Click</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c, i) => (
                    <tr key={i}>
                      <td>
                        <div className="cell-main">
                          <span className="nm">{c.name}</span>
                        </div>
                      </td>
                      <td className="num">{c.sent}</td>
                      <td className="num">{c.openRate}</td>
                      <td className="num">{c.clickRate}</td>
                      <td className="num" style={{ color: "var(--green)", fontWeight: 500 }}>
                        {c.revenue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {flows.length > 0 && (
            <div className="card card-pad">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 14,
                }}
              >
                <div>
                  <div className="card-title">Active flows</div>
                  <div className="card-sub">Earning automations</div>
                </div>
                <a
                  href="/dashboard/flows"
                  style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 500 }}
                >
                  View all →
                </a>
              </div>
              <div>
                {flows.map((f) => (
                  <div key={f.name} className="legend-row">
                    <div className="legend-l">
                      <span className="dot" style={{ background: "var(--accent)" }} />
                      {f.name}
                    </div>
                    <div className="legend-r">
                      <b style={{ color: "var(--green)" }}>{f.revenue}</b>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
