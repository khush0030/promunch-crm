"use client";
import Link from "next/link";
import { ChevronLeft, MapPin, Phone, Mail, Calendar, Tag, X, ShoppingBag, GitBranch } from "lucide-react";

const mockContact = {
  name: "Priya Sharma",
  email: "priya.s@yahoo.com",
  phone: "+1 (555) 842-9371",
  location: "San Francisco, CA",
  since: "August 2024",
  totalOrders: 12,
  ltv: "₹684.20",
  aov: "₹57.02",
  lastPurchase: "Mar 15, 2026",
};

const orders = [
  { id: "#PM-4821", products: "Chocolate Protein Bar (x3), Whey Protein 1kg", value: "₹82.40", status: "Delivered", date: "Mar 15, 2026" },
  { id: "#PM-4612", products: "Mixed Snack Box, Energy Bars (x6)", value: "₹64.80", status: "Delivered", date: "Feb 28, 2026" },
  { id: "#PM-4401", products: "Peanut Butter Protein Bar (x5)", value: "₹44.99", status: "Delivered", date: "Feb 10, 2026" },
  { id: "#PM-4188", products: "Whey Protein 2kg, Creatine 300g", value: "₹124.50", status: "Delivered", date: "Jan 22, 2026" },
  { id: "#PM-3942", products: "Vegan Protein Bar (x4), Electrolyte Mix", value: "₹56.20", status: "Delivered", date: "Jan 5, 2026" },
];

const emailTimeline = [
  { campaign: "Flash Sale — Weekend", status: "Clicked", date: "Mar 13, 2026" },
  { campaign: "Weekly Newsletter #42", status: "Opened", date: "Mar 10, 2026" },
  { campaign: "New Flavor Announcement", status: "Opened", date: "Mar 5, 2026" },
  { campaign: "Abandoned Cart Recovery", status: "Clicked", date: "Feb 25, 2026" },
  { campaign: "Weekly Newsletter #41", status: "Opened", date: "Mar 3, 2026" },
  { campaign: "VIP Exclusive Deal", status: "Clicked", date: "Feb 18, 2026" },
  { campaign: "Post-Purchase Follow-up", status: "Opened", date: "Feb 11, 2026" },
  { campaign: "Weekly Newsletter #38", status: "Sent", date: "Feb 10, 2026" },
  { campaign: "Win-Back Attempt", status: "Sent", date: "Jan 30, 2026" },
  { campaign: "New Year Promo", status: "Opened", date: "Jan 2, 2026" },
];

const statusColors: Record<string, { bg: string; color: string }> = {
  Clicked: { bg: "rgba(185, 28, 74, 0.15)", color: "#E8658B" },
  Opened: { bg: "rgba(16, 185, 129, 0.15)", color: "#10b981" },
  Sent: { bg: "rgba(113, 113, 122, 0.15)", color: "#a1a1aa" },
};

const flowHistory = [
  { name: "Welcome Series", status: "Completed", date: "Aug 2024", emails: 4 },
  { name: "Post-Purchase Thank You", status: "Completed", date: "Sep 2024", emails: 2 },
  { name: "Abandoned Cart Recovery", status: "Completed", date: "Feb 2026", emails: 2 },
  { name: "VIP Customer Flow", status: "Active", date: "Jan 2026", emails: 1 },
];

const tags = ["VIP", "Protein Lover", "Repeat Buyer", "Snack Fan", "High LTV"];

export default function ContactDetailPage() {
  return (
    <div style={{ padding: "32px" }}>
      {/* Back */}
      <Link href="/dashboard/contacts">
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#71717a", fontSize: "14px", marginBottom: "24px", cursor: "pointer" }}>
          <ChevronLeft size={16} />
          Back to Contacts
        </div>
      </Link>

      {/* Profile Header */}
      <div
        style={{
          backgroundColor: "#18181b",
          border: "1px solid #27272a",
          borderRadius: "12px",
          padding: "28px",
          marginBottom: "20px",
          display: "flex",
          gap: "24px",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: "72px",
            height: "72px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, #B91C4A, #8B1539)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "28px",
            fontWeight: 700,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          PS
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#f4f4f5" }}>{mockContact.name}</h1>
            <span style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: 600, backgroundColor: "rgba(185, 28, 74, 0.15)", color: "#E8658B" }}>
              VIP
            </span>
          </div>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#a1a1aa", fontSize: "13px" }}>
              <Mail size={14} />
              {mockContact.email}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#a1a1aa", fontSize: "13px" }}>
              <Phone size={14} />
              {mockContact.phone}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#a1a1aa", fontSize: "13px" }}>
              <MapPin size={14} />
              {mockContact.location}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#a1a1aa", fontSize: "13px" }}>
              <Calendar size={14} />
              Customer since {mockContact.since}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "20px" }}>
        {[
          { label: "Total Orders", value: mockContact.totalOrders, sub: "all time", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.1)" },
          { label: "Total Spent (LTV)", value: mockContact.ltv, sub: "lifetime value", color: "#10b981", bg: "rgba(16, 185, 129, 0.1)" },
          { label: "Avg Order Value", value: mockContact.aov, sub: "per order", color: "#B91C4A", bg: "rgba(185, 28, 74, 0.1)" },
          { label: "Last Purchase", value: "Mar 15", sub: "2026", color: "#F5B731", bg: "rgba(245, 183, 49, 0.1)" },
        ].map((s) => (
          <div key={s.label} style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "20px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "8px", backgroundColor: s.bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "12px" }}>
              <ShoppingBag size={18} color={s.color} />
            </div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: "#f4f4f5" }}>{s.value}</div>
            <div style={{ fontSize: "12px", color: "#71717a", marginTop: "4px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
        {/* Order History */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5", marginBottom: "20px" }}>Order History</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Order ID", "Products", "Value", "Status", "Date"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "0 0 10px 0", fontSize: "11px", fontWeight: 600, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid #27272a" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <tr key={i} style={{ borderBottom: i < orders.length - 1 ? "1px solid #27272a" : "none" }}>
                  <td style={{ padding: "12px 0", fontSize: "12px", fontWeight: 600, color: "#B91C4A" }}>{o.id}</td>
                  <td style={{ padding: "12px 8px", fontSize: "12px", color: "#a1a1aa", maxWidth: "200px" }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.products}</div>
                  </td>
                  <td style={{ padding: "12px 8px", fontSize: "13px", color: "#10b981", fontWeight: 600 }}>{o.value}</td>
                  <td style={{ padding: "12px 8px" }}>
                    <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "20px", backgroundColor: "rgba(16, 185, 129, 0.15)", color: "#10b981", fontWeight: 600 }}>
                      {o.status}
                    </span>
                  </td>
                  <td style={{ padding: "12px 0", fontSize: "12px", color: "#71717a" }}>{o.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Email Timeline */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5", marginBottom: "20px" }}>Email Engagement</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {emailTimeline.map((e, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: statusColors[e.status]?.color, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", color: "#f4f4f5" }}>{e.campaign}</div>
                  <div style={{ fontSize: "11px", color: "#52525b" }}>{e.date}</div>
                </div>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "20px",
                    fontSize: "11px",
                    fontWeight: 600,
                    backgroundColor: statusColors[e.status]?.bg,
                    color: statusColors[e.status]?.color,
                  }}
                >
                  {e.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Tags */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <Tag size={16} color="#B91C4A" />
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5" }}>Tags</h2>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {tags.map((tag) => (
              <div
                key={tag}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 12px",
                  backgroundColor: "#27272a",
                  borderRadius: "8px",
                  fontSize: "13px",
                  color: "#a1a1aa",
                }}
              >
                {tag}
                <X size={12} color="#71717a" style={{ cursor: "pointer" }} />
              </div>
            ))}
            <button
              style={{
                padding: "6px 12px",
                backgroundColor: "rgba(185, 28, 74, 0.1)",
                border: "1px dashed #B91C4A",
                borderRadius: "8px",
                fontSize: "13px",
                color: "#B91C4A",
                cursor: "pointer",
              }}
            >
              + Add Tag
            </button>
          </div>
        </div>

        {/* Flow History */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <GitBranch size={16} color="#B91C4A" />
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5" }}>Flow History</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {flowHistory.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px", backgroundColor: "#1c1c1f", borderRadius: "8px" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#f4f4f5" }}>{f.name}</div>
                  <div style={{ fontSize: "11px", color: "#71717a" }}>{f.date} · {f.emails} emails</div>
                </div>
                <span
                  style={{
                    padding: "3px 10px",
                    borderRadius: "20px",
                    fontSize: "11px",
                    fontWeight: 600,
                    backgroundColor: f.status === "Active" ? "rgba(16, 185, 129, 0.15)" : "rgba(113, 113, 122, 0.15)",
                    color: f.status === "Active" ? "#10b981" : "#a1a1aa",
                  }}
                >
                  {f.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
