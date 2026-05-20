"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const dateRanges = ["Last 7 Days", "Last 30 Days", "Last 90 Days"];
const rangeDays: Record<string, number> = {
  "Last 7 Days": 7,
  "Last 30 Days": 30,
  "Last 90 Days": 90,
};

type TopMetric = {
  label: string;
  value: string;
  iconBg: string;
  iconColor: string;
  iconPath: React.ReactNode;
  deltaText: string;
};

type CampaignPerf = {
  name: string;
  sent: string;
  openRate: string;
  clickRate: string;
  revenue: string;
};

type FlowPerf = {
  name: string;
  trigger: string;
  revenue: string;
  conversion: string;
};

type EmailHealthRow = {
  label: string;
  value: string;
  pct: number;
  color: string;
  iconPath: React.ReactNode;
};

type Growth = {
  newSubs: number;
  unsubscribed: number;
  net: number;
  totalActive: number;
};

const ICON_REVENUE = (
  <>
    <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </>
);
const ICON_MAIL = (
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </>
);
const ICON_TREND = (
  <>
    <path d="M3 17 9 11l4 4 8-8" />
    <path d="M17 7h4v4" />
  </>
);
const ICON_USERS = (
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
  </>
);
const ICON_CHECK = <path d="M20 6 9 17l-5-5" />;
const ICON_WARN = (
  <>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </>
);
const ICON_SHIELD = <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
const ICON_UNSUB = (
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="m17 8 4 4-4 4" />
  </>
);

export default function AnalyticsPage() {
  const [activeRange, setActiveRange] = useState("Last 30 Days");
  const [topMetrics, setTopMetrics] = useState<TopMetric[]>([]);
  const [campaignPerf, setCampaignPerf] = useState<CampaignPerf[]>([]);
  const [flowPerf, setFlowPerf] = useState<FlowPerf[]>([]);
  const [emailHealth, setEmailHealth] = useState<EmailHealthRow[]>([]);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const days = rangeDays[activeRange];
      const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const [campaignsRes, flowsRes, contactsRes, eventsRes] = await Promise.all([
        supabase.from("campaigns").select("*").gte("created_at", sinceIso).order("revenue_attributed", { ascending: false }),
        supabase.from("flows").select("*").order("revenue_attributed", { ascending: false }),
        supabase.from("contacts").select("status, created_at"),
        supabase.from("email_events").select("event_type, created_at").gte("created_at", sinceIso),
      ]);

      const campaigns = campaignsRes.data || [];
      const totalSent = campaigns.reduce((s, c) => s + (c.total_sent || 0), 0);
      const totalRevenue = campaigns.reduce((s, c) => s + (Number(c.revenue_attributed) || 0), 0);
      const rpe = totalSent > 0 ? totalRevenue / totalSent : 0;

      const allContacts = contactsRes.data || [];
      const totalActive = allContacts.filter((c) => c.status === "active").length;
      const newSubs = allContacts.filter((c) => c.created_at && c.created_at >= sinceIso).length;
      const events = eventsRes.data || [];
      const unsubscribed = events.filter((e) => e.event_type === "unsubscribed").length;
      const delivered = events.filter((e) => e.event_type === "delivered").length;
      const bounced = events.filter((e) => e.event_type === "bounced").length;
      const totalEvts = events.length || 1;
      const listGrowthPct = totalActive > 0 ? ((newSubs - unsubscribed) / totalActive) * 100 : 0;

      setTopMetrics([
        {
          label: "Email revenue",
          value: totalRevenue > 0 ? `₹${totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "₹0",
          iconBg: "var(--green-soft)",
          iconColor: "var(--green)",
          iconPath: ICON_REVENUE,
          deltaText: totalRevenue > 0 ? "▲ this period" : "No sends in range",
        },
        {
          label: "Emails sent",
          value: totalSent > 0 ? totalSent.toLocaleString() : "0",
          iconBg: "var(--accent-soft)",
          iconColor: "var(--accent)",
          iconPath: ICON_MAIL,
          deltaText: totalSent > 0 ? "▲ this period" : "No campaigns yet",
        },
        {
          label: "Revenue per email",
          value: rpe > 0 ? `₹${rpe.toFixed(2)}` : "₹0",
          iconBg: "var(--amber-soft)",
          iconColor: "var(--amber)",
          iconPath: ICON_TREND,
          deltaText: rpe > 0 ? "▲ vs prev." : "—",
        },
        {
          label: "List growth",
          value: totalActive > 0 ? `${listGrowthPct >= 0 ? "+" : ""}${listGrowthPct.toFixed(1)}%` : "0%",
          iconBg: "var(--blue-soft)",
          iconColor: "var(--blue)",
          iconPath: ICON_USERS,
          deltaText: newSubs > 0 ? `▲ ${newSubs} net new` : "—",
        },
      ]);

      setCampaignPerf(
        campaigns.slice(0, 5).map((c) => ({
          name: c.name,
          sent: c.total_sent > 0 ? c.total_sent.toLocaleString() : "—",
          openRate: c.total_sent > 0 ? ((c.total_opened / c.total_sent) * 100).toFixed(1) + "%" : "—",
          clickRate: c.total_sent > 0 ? ((c.total_clicked / c.total_sent) * 100).toFixed(1) + "%" : "—",
          revenue: c.revenue_attributed > 0 ? `₹${Number(c.revenue_attributed).toLocaleString()}` : "—",
        }))
      );

      setFlowPerf(
        (flowsRes.data || []).slice(0, 5).map((f) => {
          const conv =
            f.total_entered > 0 ? ((f.total_converted / f.total_entered) * 100).toFixed(1) + "%" : "—";
          return {
            name: f.name,
            trigger: (f.trigger_type || "").replace(/_/g, " "),
            revenue:
              f.revenue_attributed > 0 ? `₹${Number(f.revenue_attributed).toLocaleString()}` : "—",
            conversion: conv,
          };
        })
      );

      const deliveryPct = events.length > 0 ? (delivered / totalEvts) * 100 : 0;
      const bouncePct = events.length > 0 ? (bounced / totalEvts) * 100 : 0;
      const unsubPct = events.length > 0 ? (unsubscribed / totalEvts) * 100 : 0;
      setEmailHealth([
        {
          label: "Delivery rate",
          value: events.length > 0 ? `${deliveryPct.toFixed(1)}%` : "—",
          pct: deliveryPct,
          color: "var(--green)",
          iconPath: ICON_CHECK,
        },
        {
          label: "Bounce rate",
          value: events.length > 0 ? `${bouncePct.toFixed(2)}%` : "—",
          pct: Math.min(100, bouncePct * 10),
          color: "var(--amber)",
          iconPath: ICON_WARN,
        },
        {
          label: "Spam rate",
          value: "—",
          pct: 0,
          color: "var(--blue)",
          iconPath: ICON_SHIELD,
        },
        {
          label: "Unsubscribe rate",
          value: events.length > 0 ? `${unsubPct.toFixed(2)}%` : "—",
          pct: Math.min(100, unsubPct * 10),
          color: "var(--text-3)",
          iconPath: ICON_UNSUB,
        },
      ]);

      setGrowth({ newSubs, unsubscribed, net: newSubs - unsubscribed, totalActive });
      setLoaded(true);
    }
    load();
  }, [activeRange]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <div className="sub">Performance overview for PROMUNCH email marketing</div>
        </div>
        <div className="chips">
          {dateRanges.map((r) => (
            <button
              key={r}
              type="button"
              className={`chip${activeRange === r ? " active" : ""}`}
              onClick={() => setActiveRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="kpi-grid">
        {topMetrics.map((m) => {
          const isFlat = m.deltaText.startsWith("No") || m.deltaText === "—";
          return (
            <div key={m.label} className="kpi">
              <div className="ico" style={{ background: m.iconBg }}>
                <svg viewBox="0 0 24 24" fill="none" stroke={m.iconColor} strokeWidth="2">
                  {m.iconPath}
                </svg>
              </div>
              <div className="label">{m.label}</div>
              <div className="value">{m.value}</div>
              <div className={`delta ${isFlat ? "flat" : "up"}`}>{m.deltaText}</div>
            </div>
          );
        })}
      </div>

      <div className="grid-2 section">
        <div className="card card-pad">
          <div className="card-title">Top campaigns</div>
          {campaignPerf.length > 0 ? (
            <table className="tbl" style={{ marginTop: 10 }}>
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
                {campaignPerf.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <div
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: 160,
                          fontWeight: 500,
                        }}
                      >
                        {c.name}
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
          ) : (
            <div style={{ textAlign: "center", color: "var(--text-3)", fontSize: 12.5, padding: "42px 0" }}>
              {loaded ? "No campaigns in this range" : "Loading…"}
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="card-title">Top flows</div>
          {flowPerf.length > 0 ? (
            <table className="tbl" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Flow</th>
                  <th>Trigger</th>
                  <th>Revenue</th>
                  <th>Conv.</th>
                </tr>
              </thead>
              <tbody>
                {flowPerf.map((f, i) => (
                  <tr key={i}>
                    <td>
                      <div
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: 130,
                          fontWeight: 500,
                        }}
                      >
                        {f.name}
                      </div>
                    </td>
                    <td className="muted" style={{ textTransform: "capitalize" }}>
                      {f.trigger}
                    </td>
                    <td className="num" style={{ color: "var(--green)", fontWeight: 500 }}>
                      {f.revenue}
                    </td>
                    <td className="num" style={{ color: "var(--amber)" }}>
                      {f.conversion}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ textAlign: "center", color: "var(--text-3)", fontSize: 12.5, padding: "42px 0" }}>
              {loaded ? "No flows yet" : "Loading…"}
            </div>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <div className="card-title">Email health</div>
          <div className="card-sub">Deliverability signals</div>
          <div className="health-grid" style={{ marginTop: 14 }}>
            {emailHealth.map((item) => (
              <div key={item.label} className="health-tile">
                <div className="top">
                  <svg viewBox="0 0 24 24" fill="none" stroke={item.color} strokeWidth="2">
                    {item.iconPath}
                  </svg>
                  <span>{item.label}</span>
                </div>
                <div className="big">{item.value}</div>
                <div className="bar">
                  <i style={{ width: `${item.pct}%`, background: item.color }} />
                </div>
              </div>
            ))}
          </div>
          {!loaded || emailHealth.every((h) => h.value === "—") ? (
            <div className="note">Health metrics populate after your first campaign is sent.</div>
          ) : null}
        </div>

        <div className="card card-pad">
          <div className="card-title">Subscriber growth</div>
          <div className="card-sub">This period</div>
          {growth ? (
            <>
              <div style={{ marginTop: 8 }}>
                <div className="stat-line">
                  <span>New subscribers</span>
                  <span className="v" style={{ color: "var(--green)" }}>
                    +{growth.newSubs}
                  </span>
                </div>
                <div className="stat-line">
                  <span>Unsubscribed</span>
                  <span className="v" style={{ color: "var(--accent)" }}>
                    −{growth.unsubscribed}
                  </span>
                </div>
                <div className="stat-line">
                  <span>Net growth</span>
                  <span className="v" style={{ color: growth.net >= 0 ? "var(--green)" : "var(--accent)" }}>
                    {growth.net >= 0 ? "+" : ""}
                    {growth.net}
                  </span>
                </div>
              </div>
              <div
                style={{
                  marginTop: 16,
                  background: "var(--green-soft)",
                  borderRadius: "var(--radius-sm)",
                  padding: 18,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 600,
                    letterSpacing: "-0.025em",
                    color: "var(--green)",
                  }}
                >
                  {growth.totalActive.toLocaleString("en-IN")}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>
                  Total active subscribers
                </div>
              </div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 13, marginTop: 14 }}>
              Loading…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
