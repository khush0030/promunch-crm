"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";

const statusPill: Record<string, { cls: string; label: string }> = {
  active: { cls: "green", label: "Active" },
  draft: { cls: "grey", label: "Draft" },
  paused: { cls: "amber", label: "Paused" },
};

const triggerLabels: Record<string, string> = {
  checkout_abandoned: "Customer abandons checkout",
  order_placed: "Customer places an order",
  customer_created: "New customer created",
  segment_entry: "Customer enters a segment",
  date_based: "Date-based trigger",
};

type FlowRow = {
  id: string;
  name: string;
  status: string;
  trigger: string;
  triggerType: string;
  emails: number;
  revenue: number;
  totalEntered: number;
  totalConverted: number;
  conversion: string;
};

export default function FlowsPage() {
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await supabase
        .from("flows")
        .select("*")
        .order("created_at", { ascending: false });
      const rows = res.data || [];
      const mapped: FlowRow[] = rows.map((f) => {
        const stepCount = Array.isArray(f.steps) ? f.steps.length : 0;
        const conv = f.total_entered > 0 ? ((f.total_converted / f.total_entered) * 100).toFixed(1) + "%" : "";
        return {
          id: f.id,
          name: f.name,
          status: f.status || "draft",
          trigger: triggerLabels[f.trigger_type] || f.trigger_type || "",
          triggerType: f.trigger_type || "",
          emails: stepCount,
          revenue: Number(f.revenue_attributed) || 0,
          totalEntered: f.total_entered || 0,
          totalConverted: f.total_converted || 0,
          conversion: conv,
        };
      });
      setFlows(mapped);
      setLoaded(true);
    }
    load();
  }, []);

  const statusCounts = [
    { cls: "green", label: "Active", count: flows.filter((f) => f.status === "active").length },
    { cls: "grey", label: "Draft", count: flows.filter((f) => f.status === "draft").length },
    { cls: "amber", label: "Paused", count: flows.filter((f) => f.status === "paused").length },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Flows</h1>
          <div className="sub">Automated email sequences triggered by customer behaviour</div>
        </div>
        <button type="button" className="btn primary">
          <Plus size={14} /> Create flow
        </button>
      </div>

      {flows.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {statusCounts.map((s) => (
            <span key={s.label} className={`pill ${s.cls}`}>
              {s.count} {s.label}
            </span>
          ))}
        </div>
      )}

      {flows.length > 0 ? (
        <div className="grid-2">
          {flows.map((flow) => {
            const sp = statusPill[flow.status] || statusPill.draft;
            return (
              <Link
                key={flow.id}
                href={`/dashboard/flows/${flow.id}`}
                className="card card-pad"
                style={{ textDecoration: "none", cursor: "pointer" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <div className="card-title" style={{ fontSize: 15 }}>
                      {flow.name}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <span className={`pill ${sp.cls}`}>{sp.label}</span>
                    </div>
                  </div>
                </div>

                <div className="card-sub" style={{ marginBottom: 14 }}>
                  Trigger: {flow.trigger}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 24,
                    paddingTop: 12,
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        marginBottom: 4,
                        fontWeight: 500,
                      }}
                    >
                      Emails
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{flow.emails}</div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        marginBottom: 4,
                        fontWeight: 500,
                      }}
                    >
                      Revenue
                    </div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: flow.revenue > 0 ? "var(--green)" : "var(--text-3)",
                      }}
                    >
                      {flow.revenue > 0 ? `₹${flow.revenue.toLocaleString()}` : "₹0"}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        marginBottom: 4,
                        fontWeight: 500,
                      }}
                    >
                      Conversion
                    </div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: flow.conversion !== "" ? "var(--amber)" : "var(--text-3)",
                      }}
                    >
                      {flow.conversion || "—"}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <>
          <div className="empty">
            <div className="ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="6" cy="6" r="2.5" />
                <circle cx="6" cy="18" r="2.5" />
                <circle cx="18" cy="12" r="2.5" />
                <path d="M8.5 6H14a3 3 0 0 1 3 3v.5M8.5 18H14a3 3 0 0 0 3-3v-.5" />
              </svg>
            </div>
            <h3>{loaded ? "No flows yet" : "Loading…"}</h3>
            {loaded && <p>Create automated flows like abandoned-cart recovery, welcome series, or post-purchase upsells.</p>}
            {loaded && (
              <button type="button" className="btn primary">
                <Plus size={14} /> Create flow
              </button>
            )}
          </div>
          {loaded && (
            <div className="grid-3" style={{ marginTop: 18 }}>
              <div className="card card-pad">
                <div className="card-title">Abandoned cart</div>
                <div className="card-sub" style={{ marginTop: 6 }}>
                  Recover checkouts left behind. Recommended first flow.
                </div>
              </div>
              <div className="card card-pad">
                <div className="card-title">Welcome series</div>
                <div className="card-sub" style={{ marginTop: 6 }}>
                  Greet new subscribers and introduce PROMUNCH.
                </div>
              </div>
              <div className="card card-pad">
                <div className="card-title">Post-purchase</div>
                <div className="card-sub" style={{ marginTop: 6 }}>
                  Thank buyers and drive the second order.
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
