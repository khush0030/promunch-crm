"use client";
import { CheckCircle2, RefreshCw, Shield, Upload, UserPlus } from "lucide-react";

const teamMembers = [
  { name: "Khush Mutha", email: "khush@promunch.com", role: "Admin", initials: "KM" },
  { name: "Priya Sharma", email: "priya@promunch.com", role: "Member", initials: "PS" },
];

export default function SettingsPage() {
  return (
    <div style={{ padding: "32px", maxWidth: "900px" }}>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#f4f4f5", letterSpacing: "-0.5px" }}>Settings</h1>
        <p style={{ color: "#71717a", marginTop: "4px", fontSize: "14px" }}>
          Manage your ProMunch CRM integrations and preferences
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Shopify Connection */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: "rgba(149, 191, 71, 0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "20px" }}>🛍</span>
              </div>
              <div>
                <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5" }}>Shopify Connection</h2>
                <p style={{ fontSize: "13px", color: "#71717a", marginTop: "2px" }}>Sync orders, customers and products</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 14px", borderRadius: "8px", backgroundColor: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.25)" }}>
              <CheckCircle2 size={15} color="#10b981" />
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#10b981" }}>Connected</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "20px" }}>
            <div style={{ padding: "14px", backgroundColor: "#1c1c1f", borderRadius: "8px", border: "1px solid #27272a" }}>
              <div style={{ fontSize: "11px", color: "#71717a", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Store URL</div>
              <div style={{ fontSize: "13px", color: "#f4f4f5", fontWeight: 500 }}>promunch.myshopify.com</div>
            </div>
            <div style={{ padding: "14px", backgroundColor: "#1c1c1f", borderRadius: "8px", border: "1px solid #27272a" }}>
              <div style={{ fontSize: "11px", color: "#71717a", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Last Sync</div>
              <div style={{ fontSize: "13px", color: "#f4f4f5", fontWeight: 500 }}>Today, 11:42 AM</div>
            </div>
            <div style={{ padding: "14px", backgroundColor: "#1c1c1f", borderRadius: "8px", border: "1px solid #27272a" }}>
              <div style={{ fontSize: "11px", color: "#71717a", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Synced Contacts</div>
              <div style={{ fontSize: "13px", color: "#f4f4f5", fontWeight: 500 }}>12,450</div>
            </div>
          </div>

          <button style={{ display: "flex", alignItems: "center", gap: "8px", padding: "9px 18px", borderRadius: "8px", border: "1px solid #27272a", backgroundColor: "#1c1c1f", color: "#a1a1aa", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}>
            <RefreshCw size={14} />
            Reconnect
          </button>
        </div>

        {/* Email Sending */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: "rgba(59, 130, 246, 0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "20px" }}>✉️</span>
            </div>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5" }}>Email Sending</h2>
              <p style={{ fontSize: "13px", color: "#71717a", marginTop: "2px" }}>Configure your sending identity and domain</p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
            {[
              { label: "Email Provider", value: "SendGrid" },
              { label: "From Name", value: "PROMUNCH" },
              { label: "From Email", value: "hello@promunch.in" },
              { label: "Reply-To", value: "support@promunch.in" },
            ].map((f) => (
              <div key={f.label}>
                <label style={{ fontSize: "12px", color: "#71717a", fontWeight: 500, marginBottom: "6px", display: "block" }}>{f.label}</label>
                <input
                  defaultValue={f.value}
                  readOnly
                  style={{ width: "100%", padding: "10px 14px", backgroundColor: "#1c1c1f", border: "1px solid #27272a", borderRadius: "8px", color: "#f4f4f5", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
                />
              </div>
            ))}
          </div>

          {/* Domain Auth */}
          <div style={{ padding: "16px", backgroundColor: "#1c1c1f", borderRadius: "8px", border: "1px solid #27272a" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <Shield size={15} color="#10b981" />
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#f4f4f5" }}>Domain Authentication</span>
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              {[
                { label: "SPF", status: "Verified" },
                { label: "DKIM", status: "Verified" },
                { label: "DMARC", status: "Verified" },
              ].map((d) => (
                <div key={d.label} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 14px", borderRadius: "6px", backgroundColor: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                  <CheckCircle2 size={13} color="#10b981" />
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#10b981" }}>{d.label}</span>
                  <span style={{ fontSize: "11px", color: "#71717a" }}>✓</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Brand Settings */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: "rgba(124, 58, 237, 0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "20px" }}>🎨</span>
            </div>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5" }}>Brand Settings</h2>
              <p style={{ fontSize: "13px", color: "#71717a", marginTop: "2px" }}>Customise your email branding</p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
            <div>
              <label style={{ fontSize: "12px", color: "#71717a", fontWeight: 500, marginBottom: "6px", display: "block" }}>Brand Name</label>
              <input
                defaultValue="PROMUNCH"
                style={{ width: "100%", padding: "10px 14px", backgroundColor: "#1c1c1f", border: "1px solid #27272a", borderRadius: "8px", color: "#f4f4f5", fontSize: "14px", fontWeight: 600, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "12px", color: "#71717a", fontWeight: 500, marginBottom: "6px", display: "block" }}>Primary Colour</label>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 14px", backgroundColor: "#1c1c1f", border: "1px solid #27272a", borderRadius: "8px" }}>
                <div style={{ width: "24px", height: "24px", borderRadius: "6px", background: "linear-gradient(135deg, #7c3aed, #4f46e5)", flexShrink: 0 }} />
                <span style={{ fontSize: "14px", color: "#f4f4f5", fontFamily: "monospace" }}>#7c3aed</span>
              </div>
            </div>
            <div>
              <label style={{ fontSize: "12px", color: "#71717a", fontWeight: 500, marginBottom: "6px", display: "block" }}>Logo</label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "9px 14px", backgroundColor: "#1c1c1f", border: "1px dashed #3f3f46", borderRadius: "8px", cursor: "pointer" }}>
                <Upload size={15} color="#71717a" />
                <span style={{ fontSize: "13px", color: "#71717a" }}>Upload logo</span>
              </div>
            </div>
          </div>
        </div>

        {/* Team Members */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: "rgba(245, 158, 11, 0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "20px" }}>👥</span>
              </div>
              <div>
                <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5" }}>Team Members</h2>
                <p style={{ fontSize: "13px", color: "#71717a", marginTop: "2px" }}>Manage access and roles</p>
              </div>
            </div>
            <button style={{ display: "flex", alignItems: "center", gap: "8px", padding: "9px 16px", borderRadius: "8px", background: "linear-gradient(135deg, #7c3aed, #4f46e5)", border: "none", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
              <UserPlus size={14} />
              Invite
            </button>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #27272a" }}>
                {["Member", "Email", "Role", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.5px", paddingBottom: "10px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teamMembers.map((m, i) => (
                <tr key={i} style={{ borderBottom: i < teamMembers.length - 1 ? "1px solid #27272a" : "none" }}>
                  <td style={{ padding: "14px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "linear-gradient(135deg, #7c3aed, #4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                        {m.initials}
                      </div>
                      <span style={{ fontSize: "14px", fontWeight: 600, color: "#f4f4f5" }}>{m.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "14px 8px", fontSize: "13px", color: "#a1a1aa" }}>{m.email}</td>
                  <td style={{ padding: "14px 8px" }}>
                    <span style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: 600, backgroundColor: m.role === "Admin" ? "rgba(124, 58, 237, 0.15)" : "rgba(59, 130, 246, 0.15)", color: m.role === "Admin" ? "#a78bfa" : "#60a5fa" }}>
                      {m.role}
                    </span>
                  </td>
                  <td style={{ padding: "14px 0", textAlign: "right" }}>
                    {m.role !== "Admin" && (
                      <button style={{ fontSize: "12px", color: "#71717a", backgroundColor: "transparent", border: "none", cursor: "pointer" }}>Remove</button>
                    )}
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
