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

  // Authoritative Shopify snapshot (live revenue windows + exact customer count).
  // The contacts/orders tables are mirrors that can drift; this is the source of
  // truth, so the headline revenue + customer KPIs read from it when available.
  const [liveStats, setLiveStats] = useState<
    {
      revenue: Record<string, number>;
      orders: Record<string, number>;
      customers: number | null;
      aov_all: number;
      bestSellers: { name: string; sku: string | null; url: string | null; units: number; revenue: number }[];
    } | null
  >(null);
  useEffect(() => {
    fetch("/api/shopify/stats")
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) setLiveStats({
          revenue: d.revenue, orders: d.orders, customers: d.customers,
          aov_all: d.aov_all ?? 0, bestSellers: d.bestSellers ?? [],
        });
      })
      .catch(() => {});
  }, []);

  // Amazon gross sales (SP-API mirror) — feeds the "Amazon" and "all channels"
  // revenue KPIs. The API caps finance events at 90 days, so "all" maps to d90.
  const [amazonStats, setAmazonStats] = useState<{
    gross: Record<string, number>;
  } | null>(null);
  useEffect(() => {
    fetch("/api/amazon")
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.financials) setAmazonStats({
          gross: {
            today: d.financials.today?.gross ?? 0,
            d7: d.financials.d7?.gross ?? 0,
            d30: d.financials.d30?.gross ?? 0,
            d90: d.financials.d90?.gross ?? 0,
          },
        });
      })
      .catch(() => {});
  }, []);

  async function load(opts?: { silent?: boolean }) {
    if (!opts?.silent) setRefreshing(true);
    try {
      const sinceIso = sinceForPeriod(period);

      // Orders: filter by placed_at (fallback to created_at)
      let ordersQ = supabase.from("orders").select("total_amount, placed_at, created_at");
      if (sinceIso) ordersQ = ordersQ.gte("placed_at", sinceIso);
      // Exact contact counts — the contacts table exceeds PostgREST's 1000-row
      // cap, so fetching rows and counting them in JS silently maxes at 1000
      // (that's the "1,000 total contacts" bug). Use head+count queries instead.
      const contactCount = async (status?: string, since?: string | null) => {
        let q = supabase.from("contacts").select("id", { count: "exact", head: true });
        if (status) q = q.eq("status", status);
        if (since) q = q.gte("created_at", since);
        const { count } = await q;
        return count ?? 0;
      };

      const [
        totalContacts, activeCount, inactiveCount, bouncedCount, unsubCount, newSubsCount,
        campaignsRes, flowsRes, ordersRes, ordersEverRes,
      ] = await Promise.all([
        contactCount(),
        contactCount("active"),
        contactCount("inactive"),
        contactCount("bounced"),
        contactCount("unsubscribed"),
        sinceIso ? contactCount(undefined, sinceIso) : contactCount(),
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

      const total = totalContacts;
      const newSubs = newSubsCount;

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

  // Live Shopify values for the selected period (90d isn't in the snapshot, so
  // it falls back to the mirror-table figures).
  const statKey: Record<Period, string | null> = { today: "today", "7d": "d7", "30d": "d30", "90d": "d90", all: "all" };
  const liveRevenue = liveStats && statKey[period] ? liveStats.revenue[statKey[period]!] : null;
  const liveOrders = liveStats && statKey[period] ? liveStats.orders[statKey[period]!] : null;

  // Amazon gross for the selected period. The API only carries 90 days, so 90d
  // and "all" both read the d90 bucket (best available).
  const amazonKey: Record<Period, string> = { today: "today", "7d": "d7", "30d": "d30", "90d": "d90", all: "d90" };
  const amazonRevenue = amazonStats ? (amazonStats.gross[amazonKey[period]] ?? 0) : null;
  // Shopify figure for the period (live mirror, else the orders-table KPI).
  const shopifyRevenue = liveRevenue ?? kpis.revenue;
  // Total across every connected channel.
  const totalRevenue = shopifyRevenue + (amazonRevenue ?? 0);

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
            <div className="value">{inr(liveRevenue ?? kpis.revenue)}</div>
            <div className={`delta ${(liveOrders ?? kpis.ordersCount) > 0 ? "up" : "flat"}`}>
              {(liveOrders ?? kpis.ordersCount) > 0
                ? `${(liveOrders ?? kpis.ordersCount).toLocaleString("en-IN")} order${(liveOrders ?? kpis.ordersCount) === 1 ? "" : "s"} in range`
                : "No orders in range"}
            </div>
          </div>
        ) : (
          <ConnectTile label="Revenue" />
        )}

        <div className="kpi">
          <div className="ico" style={{ background: "var(--amber-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </div>
          <div className="label">
            Amazon revenue ·{" "}
            <span className="muted">{period === "all" || period === "90d" ? "last 90d" : period_label}</span>
          </div>
          <div className="value">{amazonRevenue != null ? inr(amazonRevenue) : "—"}</div>
          <div className={`delta ${amazonRevenue && amazonRevenue > 0 ? "up" : "flat"}`}>
            {amazonRevenue == null
              ? "Loading…"
              : amazonRevenue > 0
              ? "Gross sales · SP-API"
              : "No Amazon sales in range"}
          </div>
        </div>

        <div className="kpi">
          <div className="ico" style={{ background: "var(--green-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2">
              <path d="M3 3v18h18" />
              <path d="m7 14 4-4 4 4 4-6" />
            </svg>
          </div>
          <div className="label">
            Total revenue · <span className="muted">all channels · {period_label}</span>
          </div>
          <div className="value">{inr(totalRevenue)}</div>
          <div className={`delta ${totalRevenue > 0 ? "up" : "flat"}`}>
            {totalRevenue > 0
              ? `Shopify ${inr(shopifyRevenue)} + Amazon ${inr(amazonRevenue ?? 0)}`
              : "No revenue in range"}
          </div>
        </div>
      </div>

      {/* Store totals + best sellers — live from Shopify */}
      <div className="grid-2 section">
        <div className="card card-pad">
          <div className="card-title">Best sellers</div>
          <div className="card-sub">Top products all-time, by revenue</div>
          {liveStats?.bestSellers && liveStats.bestSellers.length > 0 ? (
            <table className="tbl" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Units</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {liveStats.bestSellers.slice(0, 8).map((p, i) => (
                  <tr key={i}>
                    <td>
                      {p.url ? (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200, fontWeight: 500, color: "var(--accent)", textDecoration: "none" }}
                          title={p.name}
                        >
                          {p.name}
                        </a>
                      ) : (
                        <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200, fontWeight: 500 }} title={p.name}>
                          {p.name}
                        </div>
                      )}
                    </td>
                    <td className="num">{p.units.toLocaleString("en-IN")}</td>
                    <td className="num" style={{ color: "var(--green)", fontWeight: 500 }}>{inr(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ textAlign: "center", color: "var(--text-3)", fontSize: 12.5, padding: "42px 0" }}>
              {liveStats ? "No product data yet" : "Loading…"}
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="card-title">Store totals</div>
          <div className="card-sub">Live from Shopify, all-time</div>
          <div style={{ marginTop: 10 }}>
            <div className="stat-line">
              <span>Total orders</span>
              <span className="v">{liveStats ? (liveStats.orders.all ?? 0).toLocaleString("en-IN") : "…"}</span>
            </div>
            <div className="stat-line">
              <span>Total revenue</span>
              <span className="v" style={{ color: "var(--green)" }}>{liveStats ? inr(liveStats.revenue.all ?? 0) : "…"}</span>
            </div>
            <div className="stat-line">
              <span>Customers</span>
              <span className="v">{liveStats?.customers != null ? liveStats.customers.toLocaleString("en-IN") : "…"}</span>
            </div>
            <div className="stat-line">
              <span>Avg order value</span>
              <span className="v">{liveStats ? inr(liveStats.aov_all ?? 0) : "…"}</span>
            </div>
          </div>
        </div>
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
