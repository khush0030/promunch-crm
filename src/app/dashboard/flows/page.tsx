"use client";
import Link from "next/link";
import { Plus, ShoppingCart, Heart, Gift, RefreshCw, Eye, Cake, TrendingUp, Star, Truck, MessageSquare } from "lucide-react";

const flows = [
  {
    id: "1",
    name: "Abandoned Cart Recovery",
    status: "Active",
    trigger: "Customer adds to cart but doesn't checkout",
    emails: 3,
    revenue: 8240,
    conversion: "18.2%",
    icon: ShoppingCart,
    color: "#E87339",
    bg: "rgba(232, 115, 57, 0.1)",
  },
  {
    id: "2",
    name: "Welcome Series",
    status: "Active",
    trigger: "New subscriber joins the list",
    emails: 4,
    revenue: 4120,
    conversion: "67% completion",
    icon: Heart,
    color: "#B91C4A",
    bg: "rgba(185, 28, 74, 0.1)",
  },
  {
    id: "3",
    name: "Post-Purchase Thank You",
    status: "Active",
    trigger: "Customer completes a purchase",
    emails: 2,
    revenue: 2890,
    conversion: "—",
    icon: Gift,
    color: "#10b981",
    bg: "rgba(16, 185, 129, 0.1)",
  },
  {
    id: "4",
    name: "Win-Back Campaign",
    status: "Active",
    trigger: "No purchase in last 90 days",
    emails: 3,
    revenue: 1940,
    conversion: "12.4%",
    icon: RefreshCw,
    color: "#F5B731",
    bg: "rgba(245, 183, 49, 0.1)",
  },
  {
    id: "5",
    name: "Browse Abandonment",
    status: "Draft",
    trigger: "Customer views product but doesn't add to cart",
    emails: 2,
    revenue: 0,
    conversion: "—",
    icon: Eye,
    color: "#71717a",
    bg: "rgba(113, 113, 122, 0.1)",
  },
  {
    id: "6",
    name: "Birthday Flow",
    status: "Active",
    trigger: "Customer birthday date",
    emails: 1,
    revenue: 680,
    conversion: "—",
    icon: Cake,
    color: "#00B4D8",
    bg: "rgba(0, 180, 216, 0.1)",
  },
  {
    id: "7",
    name: "Post-Purchase Upsell",
    status: "Active",
    trigger: "3 days after first purchase",
    emails: 2,
    revenue: 1350,
    conversion: "9.1%",
    icon: TrendingUp,
    color: "#10b981",
    bg: "rgba(16, 185, 129, 0.1)",
  },
  {
    id: "8",
    name: "VIP Customer Flow",
    status: "Paused",
    trigger: "Customer reaches ₹10,000 lifetime value",
    emails: 2,
    revenue: 520,
    conversion: "—",
    icon: Star,
    color: "#F5B731",
    bg: "rgba(245, 183, 49, 0.1)",
  },
  {
    id: "9",
    name: "Review Request",
    status: "Active",
    trigger: "7 days after delivery confirmed",
    emails: 2,
    revenue: 0,
    conversion: "—",
    icon: MessageSquare,
    color: "#00B4D8",
    bg: "rgba(0, 180, 216, 0.1)",
  },
  {
    id: "10",
    name: "Shipping Confirmation",
    status: "Active",
    trigger: "Order marked as shipped",
    emails: 1,
    revenue: 0,
    conversion: "—",
    icon: Truck,
    color: "#a1a1aa",
    bg: "rgba(161, 161, 170, 0.1)",
  },
];

const statusStyle: Record<string, { bg: string; color: string }> = {
  Active: { bg: "rgba(16, 185, 129, 0.15)", color: "#10b981" },
  Draft: { bg: "rgba(113, 113, 122, 0.15)", color: "#a1a1aa" },
  Paused: { bg: "rgba(245, 183, 49, 0.15)", color: "#F5B731" },
};

export default function FlowsPage() {
  return (
    <div style={{ padding: "32px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#f4f4f5", letterSpacing: "-0.5px" }}>Flows</h1>
          <p style={{ color: "#71717a", marginTop: "4px", fontSize: "14px" }}>
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

      {/* Summary pills */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "28px" }}>
        {[
          { label: "Active", count: flows.filter(f => f.status === "Active").length, color: "#10b981", bg: "rgba(16,185,129,0.1)" },
          { label: "Draft", count: flows.filter(f => f.status === "Draft").length, color: "#a1a1aa", bg: "rgba(113,113,122,0.1)" },
          { label: "Paused", count: flows.filter(f => f.status === "Paused").length, color: "#F5B731", bg: "rgba(245,183,49,0.1)" },
        ].map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 14px", backgroundColor: s.bg, borderRadius: "20px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: s.color }} />
            <span style={{ fontSize: "13px", fontWeight: 600, color: s.color }}>{s.count} {s.label}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {flows.map((flow) => {
          const ss = statusStyle[flow.status];
          return (
            <Link key={flow.id} href={`/dashboard/flows/${flow.id}`} style={{ textDecoration: "none" }}>
              <div
                style={{
                  backgroundColor: "#18181b",
                  border: "1px solid #27272a",
                  borderRadius: "12px",
                  padding: "20px",
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                  position: "relative",
                  overflow: "hidden",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#3f3f46")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#27272a")}
              >
                {/* Top row */}
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
                      <div style={{ fontSize: "15px", fontWeight: 700, color: "#f4f4f5" }}>{flow.name}</div>
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

                {/* Trigger */}
                <p style={{ fontSize: "12px", color: "#71717a", marginBottom: "16px", lineHeight: "1.5" }}>
                  Trigger: {flow.trigger}
                </p>

                {/* Stats row */}
                <div style={{ display: "flex", gap: "20px", paddingTop: "14px", borderTop: "1px solid #27272a" }}>
                  <div>
                    <div style={{ fontSize: "12px", color: "#52525b", marginBottom: "2px" }}>Emails</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#f4f4f5" }}>{flow.emails}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", color: "#52525b", marginBottom: "2px" }}>Revenue</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: flow.revenue > 0 ? "#10b981" : "#52525b" }}>
                      {flow.revenue > 0 ? `₹${flow.revenue.toLocaleString()}` : "₹0"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", color: "#52525b", marginBottom: "2px" }}>Conversion</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: flow.conversion !== "—" ? "#F5B731" : "#52525b" }}>
                      {flow.conversion}
                    </div>
                  </div>
                </div>

                {/* Background decoration */}
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
    </div>
  );
}
