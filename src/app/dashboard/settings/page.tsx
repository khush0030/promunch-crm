"use client";
import { CheckCircle2, Plus, UserPlus } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";

const teamMembers = [
  { name: "Khush Mutha", email: "khush@promunch.in", role: "Admin" },
];

export default function SettingsPage() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">Manage your PROMUNCH CRM configuration</div>
        </div>
      </div>

      <div className="card card-pad section">
        <div className="conn-row">
          <div className="conn-logo" style={{ background: "var(--green-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.9">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div className="card-title">Shopify connection</div>
            <div className="card-sub">Sync your Shopify store data</div>
          </div>
          <button
            type="button"
            className="btn"
            style={{ color: "var(--accent)", borderColor: "var(--accent-soft)" }}
          >
            Disconnect
          </button>
        </div>
        <div className="meta-grid">
          <div>
            <div className="k">Store URL</div>
            <div className="v">promunch.myshopify.com</div>
          </div>
          <div>
            <div className="k">Status</div>
            <div className="v">
              <span className="pill green">
                <CheckCircle2 size={11} /> Connected
              </span>
            </div>
          </div>
          <div>
            <div className="k">Last sync</div>
            <div className="v">2 minutes ago</div>
          </div>
        </div>
      </div>

      <div className="card card-pad section">
        <div className="conn-row">
          <div className="conn-logo" style={{ background: "var(--accent-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.9">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div className="card-title">Email sending</div>
            <div className="card-sub">Configure your email provider and sender details</div>
          </div>
        </div>
        <div className="grid-3" style={{ marginTop: 18 }}>
          <div className="field">
            <label>Provider</label>
            <input className="input" defaultValue="Resend" title="Provider" />
          </div>
          <div className="field">
            <label>From name</label>
            <input className="input" defaultValue="PROMUNCH" title="From name" />
          </div>
          <div className="field">
            <label>From email</label>
            <input className="input" defaultValue="hello@promunch.in" title="From email" />
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            Domain authentication
          </div>
          <span className="pill green">
            <CheckCircle2 size={11} /> SPF
          </span>
          <span className="pill green" style={{ marginLeft: 6 }}>
            <CheckCircle2 size={11} /> DKIM
          </span>
          <span className="pill green" style={{ marginLeft: 6 }}>
            <CheckCircle2 size={11} /> DMARC
          </span>
        </div>
      </div>

      <div className="card card-pad section">
        <div className="conn-row">
          <div className="conn-logo" style={{ background: "var(--blue-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.9">
              <circle cx="13.5" cy="6.5" r="2.5" />
              <circle cx="6.5" cy="12" r="2.5" />
              <circle cx="16.5" cy="14" r="2.5" />
              <circle cx="8.5" cy="19" r="2.5" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div className="card-title">Brand settings</div>
            <div className="card-sub">Customise your brand appearance</div>
          </div>
        </div>
        <div className="grid-3" style={{ marginTop: 18 }}>
          <div className="field">
            <label>Brand name</label>
            <input className="input" defaultValue="PROMUNCH" title="Brand name" />
          </div>
          <div className="field">
            <label>Primary colour</label>
            <input className="input mono" defaultValue="#B9303F" title="Primary colour" />
          </div>
          <div className="field">
            <label>Logo</label>
            <div
              className="input"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--text-3)",
                cursor: "pointer",
                background: "var(--card-bg)",
                borderStyle: "dashed",
              }}
            >
              <Plus size={14} /> Click to upload logo
            </div>
          </div>
        </div>
      </div>

      <div className="card card-pad section">
        <div className="conn-row">
          <div className="conn-logo" style={{ background: "var(--amber-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="1.9">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div className="card-title">Team members</div>
            <div className="card-sub">Manage access to PROMUNCH CRM</div>
          </div>
          <button type="button" className="btn">
            <UserPlus size={14} /> Invite member
          </button>
        </div>
        <table className="tbl" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>Member</th>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {teamMembers.map((m) => (
              <tr key={m.email}>
                <td>
                  <div className="cell-main">
                    <Avatar name={m.name} size={26} />
                    <span className="nm">{m.name}</span>
                  </div>
                </td>
                <td className="muted">{m.email}</td>
                <td>
                  <span className="pill accent">{m.role}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
