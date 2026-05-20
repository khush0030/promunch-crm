"use client";
import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";

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
  revenue: string;
  subscribers: string;
  openRate: string;
  flowRevenue: string;
  revenueDelta: string;
  subscribersDelta: string;
  flowRevenueDelta: string;
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [listHealth, setListHealth] = useState<ListHealth | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function loadData() {
      const [contactsRes, campaignsRes, flowsRes, ordersRes] = await Promise.all([
        supabase.from("contacts").select("id, status"),
        supabase.from("campaigns").select("*").order("created_at", { ascending: false }).limit(5),
        supabase.from("flows").select("*").eq("status", "active"),
        supabase.from("orders").select("total_amount, status"),
      ]);

      const contactRows = contactsRes.data || [];
      const totalContacts = contactRows.length;
      const activeCount = contactRows.filter((c) => c.status === "active").length;
      const inactiveCount = contactRows.filter((c) => c.status === "inactive").length;
      const bouncedCount = contactRows.filter((c) => c.status === "bounced").length;
      const unsubCount = contactRows.filter((c) => c.status === "unsubscribed").length;

      const orderRows = ordersRes.data || [];
      const totalRevenue = orderRows.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

      const campaignRows = campaignsRes.data || [];
      const totalSent = campaignRows.reduce((s, c) => s + (c.total_sent || 0), 0);
      const totalOpened = campaignRows.reduce((s, c) => s + (c.total_opened || 0), 0);
      const flowRevenue = (flowsRes.data || []).reduce(
        (s, f) => s + (Number(f.revenue_attributed) || 0),
        0
      );
      const openRatePct = totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) + "%" : "0%";

      setKpis({
        revenue: `₹${totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
        subscribers: totalContacts.toLocaleString("en-IN"),
        openRate: openRatePct,
        flowRevenue: `₹${flowRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
        revenueDelta: totalRevenue > 0 ? "▲ this period" : "No orders yet",
        subscribersDelta:
          totalContacts > 0 ? `▲ ${totalContacts.toLocaleString("en-IN")} this period` : "—",
        flowRevenueDelta: flowRevenue > 0 ? "▲ this period" : "No flows live yet",
      });

      setCampaigns(
        campaignRows.map((c) => ({
          name: c.name,
          sent: c.total_sent > 0 ? c.total_sent.toLocaleString() : "0",
          openRate:
            c.total_sent > 0 ? ((c.total_opened / c.total_sent) * 100).toFixed(1) + "%" : "0%",
          clickRate:
            c.total_sent > 0 ? ((c.total_clicked / c.total_sent) * 100).toFixed(1) + "%" : "0%",
          revenue: c.revenue_attributed > 0 ? `₹${Number(c.revenue_attributed).toLocaleString()}` : "₹0",
        }))
      );

      setFlows(
        (flowsRes.data || []).slice(0, 4).map((f) => ({
          name: f.name,
          revenue:
            f.revenue_attributed > 0 ? `₹${Number(f.revenue_attributed).toLocaleString()}` : "₹0",
        }))
      );

      setListHealth({
        total: totalContacts,
        active: activeCount,
        inactive: inactiveCount,
        bounced: bouncedCount,
        unsubscribed: unsubCount,
      });
      setLoaded(true);
    }
    loadData();
  }, []);

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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">Overview of your CRM activity · last 30 days</div>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => window.location.reload()}
          aria-label="Sync now"
        >
          <RefreshCw size={14} /> Sync now
        </button>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="ico" style={{ background: "var(--green-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2">
              <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <div className="label">Total revenue</div>
          <div className="value">{kpis.revenue}</div>
          <div className={`delta ${kpis.revenue !== "₹0" ? "up" : "flat"}`}>{kpis.revenueDelta}</div>
        </div>

        <div className="kpi">
          <div className="ico" style={{ background: "var(--blue-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
            </svg>
          </div>
          <div className="label">Active subscribers</div>
          <div className="value">{kpis.subscribers}</div>
          <div className={`delta ${kpis.subscribers !== "0" ? "up" : "flat"}`}>
            {kpis.subscribersDelta}
          </div>
        </div>

        <div className="kpi">
          <div className="ico" style={{ background: "var(--accent-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
          </div>
          <div className="label">Email open rate</div>
          <div className="value">{kpis.openRate}</div>
          <div className={`delta ${kpis.openRate !== "0%" ? "up" : "flat"}`}>
            {kpis.openRate !== "0%" ? "▲ vs prev. period" : "No campaigns sent yet"}
          </div>
        </div>

        <div className="kpi">
          <div className="ico" style={{ background: "var(--amber-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2">
              <path d="M3 17 9 11l4 4 8-8" />
              <path d="M17 7h4v4" />
            </svg>
          </div>
          <div className="label">Flow revenue</div>
          <div className="value">{kpis.flowRevenue}</div>
          <div className={`delta ${kpis.flowRevenue !== "₹0" ? "up" : "flat"}`}>
            {kpis.flowRevenueDelta}
          </div>
        </div>
      </div>

      {listHealth && listHealth.total > 0 && (
        <div className="grid-2 section">
          <div className="card card-pad">
            <div className="card-title">List health</div>
            <div className="card-sub">{listHealth.total.toLocaleString("en-IN")} total contacts</div>
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
              <div className="legend-row">
                <div className="legend-l">
                  <span className="dot" style={{ background: "var(--green)" }} />
                  Shopify · promunch.myshopify.com
                </div>
                <span className="pill green">
                  <span className="dot" style={{ background: "var(--green)" }} />
                  Synced
                </span>
              </div>
              <div className="legend-row">
                <div className="legend-l">
                  <span className="dot" style={{ background: "var(--amber)" }} />
                  Amazon Seller · SP-API
                </div>
                <span className="pill amber">Setup pending</span>
              </div>
              <div className="legend-row">
                <div className="legend-l">
                  <span className="dot" style={{ background: "var(--green)" }} />
                  Email · Resend
                </div>
                <span className="pill green">
                  <span className="dot" style={{ background: "var(--green)" }} />
                  Verified
                </span>
              </div>
              <div className="legend-row">
                <div className="legend-l">
                  <span className="dot" style={{ background: "var(--text-3)" }} />
                  WhatsApp Business
                </div>
                <span className="pill grey">Not connected</span>
              </div>
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
                  <div className="card-sub">Last 5 sends</div>
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
