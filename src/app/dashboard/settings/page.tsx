"use client";
import {
  ShoppingBag,
  Mail,
  Palette,
  Users,
  CheckCircle2,
  Unlink,
  UserPlus,
} from "lucide-react";

const teamMembers = [
  { name: "Khush Mutha", email: "khush@promunch.in", role: "Admin", initials: "KM", color: "#B91C4A" },
];

export default function SettingsPage() {
  return (
    <div style={{ padding: "32px" }}>
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#111827", letterSpacing: "-0.5px" }}>Settings</h1>
        <p style={{ color: "#6b7280", marginTop: "4px", fontSize: "14px" }}>
          Manage your PROMUNCH CRM configuration
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

        {/* Shopify Connection */}
        <div style={{ backgroundColor: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: "rgba(16,185,129,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ShoppingBag size={20} color="#10b981" />
            </div>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#111827" }}>Shopify Connection</h2>
              <p style={{ fontSize: "13px", color: "#6b7280" }}>Sync your Shopify store data</p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "16px", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Store URL</div>
              <div style={{ fontSize: "14px", color: "#111827", fontWeight: 500 }}>promunch.myshopify.com</div>
            </div>
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Status</div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <CheckCircle2 size={16} color="#10b981" />
                <span style={{ fontSize: "14px", color: "#10b981", fontWeight: 600 }}>Connected</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Last Sync</div>
              <div style={{ fontSize: "14px", color: "#4b5563" }}>2 minutes ago</div>
            </div>
            <button
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid rgba(239,68,68,0.3)",
                backgroundColor: "rgba(239,68,68,0.08)",
                color: "#ef4444",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Unlink size={14} />
              Disconnect
            </button>
          </div>
        </div>

        {/* Email Sending */}
        <div style={{ backgroundColor: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: "rgba(0,180,216,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Mail size={20} color="#00B4D8" />
            </div>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#111827" }}>Email Sending</h2>
              <p style={{ fontSize: "13px", color: "#6b7280" }}>Configure your email provider and sender details</p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "20px" }}>
            {[
              { label: "Provider", value: "SendGrid" },
              { label: "From Name", value: "PROMUNCH" },
              { label: "From Email", value: "hello@promunch.in" },
            ].map((item) => (
              <div key={item.label}>
                <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>{item.label}</div>
                <div
                  style={{
                    padding: "10px 14px",
                    backgroundColor: "#e5e7eb",
                    borderRadius: "8px",
                    fontSize: "14px",
                    color: "#111827",
                    border: "1px solid #d1d5db",
                  }}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>Domain Authentication</div>
            <div style={{ display: "flex", gap: "12px" }}>
              {[
                { label: "SPF", ok: true },
                { label: "DKIM", ok: true },
                { label: "DMARC", ok: true },
              ].map((auth) => (
                <div
                  key={auth.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 14px",
                    borderRadius: "8px",
                    backgroundColor: "rgba(16,185,129,0.1)",
                    border: "1px solid rgba(16,185,129,0.25)",
                  }}
                >
                  <CheckCircle2 size={14} color="#10b981" />
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#10b981" }}>{auth.label} ✓</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Brand Settings */}
        <div style={{ backgroundColor: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: "rgba(185,28,74,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Palette size={20} color="#B91C4A" />
            </div>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#111827" }}>Brand Settings</h2>
              <p style={{ fontSize: "13px", color: "#6b7280" }}>Customise your brand appearance</p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Brand Name</div>
              <div style={{ padding: "10px 14px", backgroundColor: "#e5e7eb", borderRadius: "8px", fontSize: "14px", fontWeight: 700, color: "#111827", border: "1px solid #d1d5db", letterSpacing: "1px" }}>
                PROMUNCH
              </div>
            </div>
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Primary Colour</div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", backgroundColor: "#e5e7eb", borderRadius: "8px", border: "1px solid #d1d5db" }}>
                <div style={{ width: "24px", height: "24px", borderRadius: "6px", backgroundColor: "#B91C4A", flexShrink: 0 }} />
                <span style={{ fontSize: "13px", color: "#111827", fontFamily: "monospace" }}>#B91C4A</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Logo</div>
              <div
                style={{
                  padding: "10px 14px",
                  backgroundColor: "#e5e7eb",
                  borderRadius: "8px",
                  border: "2px dashed #d1d5db",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "46px",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: "12px", color: "#9ca3af" }}>Click to upload logo</span>
              </div>
            </div>
          </div>
        </div>

        {/* Team Members */}
        <div style={{ backgroundColor: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: "rgba(245,183,49,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Users size={20} color="#F5B731" />
              </div>
              <div>
                <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#111827" }}>Team Members</h2>
                <p style={{ fontSize: "13px", color: "#6b7280" }}>Manage access to PROMUNCH CRM</p>
              </div>
            </div>
            <button
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                backgroundColor: "#e5e7eb",
                color: "#111827",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <UserPlus size={14} />
              Invite Member
            </button>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                {["Member", "Email", "Role"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", paddingBottom: "10px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teamMembers.map((member, i) => (
                <tr key={i} style={{ borderBottom: i < teamMembers.length - 1 ? "1px solid #e5e7eb" : "none" }}>
                  <td style={{ padding: "14px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div
                        style={{
                          width: "36px",
                          height: "36px",
                          borderRadius: "50%",
                          backgroundColor: member.color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "13px",
                          fontWeight: 700,
                          color: "#fff",
                          flexShrink: 0,
                        }}
                      >
                        {member.initials}
                      </div>
                      <span style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>{member.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "14px 8px", fontSize: "13px", color: "#4b5563" }}>{member.email}</td>
                  <td style={{ padding: "14px 0" }}>
                    <span
                      style={{
                        padding: "3px 12px",
                        borderRadius: "20px",
                        fontSize: "12px",
                        fontWeight: 600,
                        backgroundColor: member.role === "Admin" ? "rgba(185,28,74,0.15)" : "rgba(113,113,122,0.15)",
                        color: member.role === "Admin" ? "#B91C4A" : "#4b5563",
                      }}
                    >
                      {member.role}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
