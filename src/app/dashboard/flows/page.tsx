"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ShoppingCart, Heart, Gift, RefreshCw, Eye, Cake, TrendingUp, Star, Truck, MessageSquare } from "lucide-react";
import { supabase } from "@/lib/supabase";

const triggerIcons: Record<string, { icon: typeof ShoppingCart; color: string; bg: string }> = {
  checkout_abandoned: { icon: ShoppingCart, color: "#E87339", bg: "rgba(232, 115, 57, 0.1)" },
  order_placed: { icon: Gift, color: "#10b981", bg: "rgba(16, 185, 129, 0.1)" },
  customer_created: { icon: Heart, color: "#B91C4A", bg: "rgba(185, 28, 74, 0.1)" },
  segment_entry: { icon: Star, color: "#F5B731", bg: "rgba(245, 183, 49, 0.1)" },
  date_based: { icon: Cake, color: "#00B4D8", bg: "rgba(0, 180, 216, 0.1)" },
};

const fallbackIcons = [TrendingUp, RefreshCw, Eye, Truck, MessageSquare];
const fallbackColors = ["#10b981", "#F5B731", "#6b7280", "#4b5563", "#00B4D8"];

const statusStyle: Record<string, { bg: string; color: string }> = {
  active: { bg: "rgba(16, 185, 129, 0.15)", color: "#10b981" },
  draft: { bg: "rgba(113, 113, 122, 0.15)", color: "#4b5563" },
  paused: { bg: "rgba(245, 183, 49, 0.15)", color: "#F5B731" },
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
  icon: typeof ShoppingCart;
  color: string;
  bg: string;
};

export default function FlowsPage() {
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await supabase.from("flows").select("*").order("created_at", { ascending: false });
      const rows = res.data || [];
      const mapped: FlowRow[] = rows.map((f, i) => {
        const meta = triggerIcons[f.trigger_type] || {
          icon: fallbackIcons[i % fallbackIcons.length],
          color: fallbackColors[i % fallbackColors.length],
          bg: "rgba(161, 161, 170, 0.1)",
        };
        const stepCount = Array.isArray(f.steps) ? f.steps.length : 0;
        const conv = f.total_entered > 0
          ? ((f.total_converted / f.total_entered) * 100).toFixed(1) + "%"
          : "";
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
          icon: meta.icon,
          color: meta.color,
          bg: meta.bg,
        };
      });
      setFlows(mapped);
      setLoaded(true);
    }
    load();
  }, []);

  return (
    <div style={{ padding: "32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#111827", letterSpacing: "-0.5px" }}>Flows</h1>
          <p style={{ color: "#6b7280", marginTop: "4px", fontSize: "14px" }}>
            Automated email sequences triggered by customer behaviour
          </p>
        </div>
        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 18px",
            background: "linear-gradient(135deg, #B91C4A, #9b1740)",
            border: "none",
            borderRadius: "9px",
            color: "#fff",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Plus size={16} />
          Create Flow
        </button>
      </div>

      {flows.length > 0 && (
        <div style={{ display: "flex", gap: "12px", marginBottom: "28px" }}>
          {[
            { label: "Active", count: flows.filter(f => f.status === "active").length, color: "#10b981", bg: "rgba(16,185,129,0.1)" },
            { label: "Draft", count: flows.filter(f => f.status === "draft").length, color: "#4b5563", bg: "rgba(113,113,122,0.1)" },
            { label: "Paused", count: flows.filter(f => f.status === "paused").length, color: "#F5B731", bg: "rgba(245,183,49,0.1)" },
          ].map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 14px", backgroundColor: s.bg, borderRadius: "20px" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: s.color }} />
              <span style={{ fontSize: "13px", fontWeight: 600, color: s.color }}>{s.count} {s.label}</span>
            </div>
          ))}
        </div>
      )}

      {flows.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          {flows.map((flow) => {
            const ss = statusStyle[flow.status] || statusStyle.draft;
            return (
              <Link key={flow.id} href={`/dashboard/flows/${flow.id}`} style={{ textDecoration: "none" }}>
                <div
                  style={{
                    backgroundColor: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "12px",
                    padding: "20px",
                    cursor: "pointer",
                    transition: "border-color 0.15s",
                    position: "relative",
                    overflow: "hidden",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#d1d5db")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e5e7eb")}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div
                        style={{
                          width: "44px",
                          height: "44px",
                          borderRadius: "10px",
                          backgroundColor: flow.bg,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <flow.icon size={20} color={flow.color} />
                      </div>
                      <div>
                        <div style={{ fontSize: "15px", fontWeight: 700, color: "#111827" }}>{flow.name}</div>
                        <span
                          style={{
                            display: "inline-block",
                            marginTop: "4px",
                            padding: "2px 10px",
                            borderRadius: "20px",
                            fontSize: "11px",
                            fontWeight: 600,
                            backgroundColor: ss.bg,
                            color: ss.color,
                          }}
                        >
                          {flow.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p style={{ fontSize: "12px", color: "#6b7280", marginBottom: "16px", lineHeight: "1.5" }}>
                    Trigger: {flow.trigger}
                  </p>

                  <div style={{ display: "flex", gap: "20px", paddingTop: "14px", borderTop: "1px solid #e5e7eb" }}>
                    <div>
                      <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "2px" }}>Emails</div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>{flow.emails}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "2px" }}>Revenue</div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: flow.revenue > 0 ? "#10b981" : "#9ca3af" }}>
                        {flow.revenue > 0 ? `₹${flow.revenue.toLocaleString()}` : "₹0"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "2px" }}>Conversion</div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: flow.conversion !== "" ? "#F5B731" : "#9ca3af" }}>
                        {flow.conversion}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      right: 0,
                      width: "80px",
                      height: "80px",
                      background: `radial-gradient(circle at 100% 100%, ${flow.bg}, transparent)`,
                      pointerEvents: "none",
                    }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "64px 24px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "15px", color: "#4b5563", fontWeight: 600, marginBottom: "8px" }}>
            {loaded ? "No flows yet" : ""}
          </div>
          {loaded && (
            <div style={{ fontSize: "13px", color: "#6b7280", maxWidth: "360px", margin: "0 auto" }}>
              Create automated flows like abandoned-cart recovery, welcome series, or post-purchase upsells.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
