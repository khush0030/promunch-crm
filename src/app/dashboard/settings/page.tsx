"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Plus, UserPlus } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function SettingsPage() {
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [brand, setBrand] = useState({
    name: "PROMUNCH",
    color: "#B9303F",
    fromName: "PROMUNCH",
    fromEmail: "hello@promunch.in",
    provider: "Resend",
  });

  async function handleDisconnect() {
    if (!confirm("Disconnect the Shopify store? Imports and webhooks will stop.")) return;
    setDisconnectBusy(true);
    try {
      // Soft-disconnect: record an audit row. Hard config lives in env.
      await supabase.from("settings_audit").insert({ action: "shopify_disconnect" });
      toast.push({ kind: "info", text: "Shopify disconnect requested — env still configured." });
    } catch (e) {
      toast.push({
        kind: "error",
        text: `Disconnect failed: ${e instanceof Error ? e.message : "unknown"}`,
      });
    } finally {
      setDisconnectBusy(false);
    }
  }

  async function handleInvite() {
    const email = prompt("Email of the teammate to invite:");
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.push({ kind: "error", text: "That doesn't look like a valid email." });
      return;
    }
    setInviteBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      toast.push({ kind: "success", text: `Invite sent to ${email.trim()}.` });
    } catch (e) {
      toast.push({
        kind: "error",
        text: `Invite failed: ${e instanceof Error ? e.message : "unknown"}`,
      });
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleLogoUpload(file: File) {
    setLogoBusy(true);
    try {
      const path = `brand/logo-${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("public-assets").upload(path, file, {
        upsert: true,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("public-assets").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      toast.push({ kind: "success", text: "Logo uploaded." });
    } catch (e) {
      toast.push({
        kind: "error",
        text: `Upload failed: ${e instanceof Error ? e.message : "unknown"}`,
      });
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleSaveBrand() {
    try {
      await supabase.from("settings_brand").upsert(
        { id: "default", ...brand, logo_url: logoUrl },
        { onConflict: "id" }
      );
      toast.push({ kind: "success", text: "Brand saved." });
    } catch (e) {
      toast.push({
        kind: "error",
        text: `Save failed: ${e instanceof Error ? e.message : "unknown"}`,
      });
    }
  }

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
            onClick={handleDisconnect}
            disabled={disconnectBusy}
          >
            {disconnectBusy ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
        <div className="meta-grid">
          <div>
            <div className="k">Store URL</div>
            <div className="v">{process.env.NEXT_PUBLIC_SHOPIFY_STORE_URL || "—"}</div>
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
            <div className="v muted">—</div>
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
          <button type="button" className="btn primary" onClick={handleSaveBrand}>
            Save
          </button>
        </div>
        <div className="grid-3" style={{ marginTop: 18 }}>
          <div className="field">
            <label>Provider</label>
            <input
              className="input"
              title="Provider"
              value={brand.provider}
              onChange={(e) => setBrand({ ...brand, provider: e.target.value })}
            />
          </div>
          <div className="field">
            <label>From name</label>
            <input
              className="input"
              title="From name"
              value={brand.fromName}
              onChange={(e) => setBrand({ ...brand, fromName: e.target.value })}
            />
          </div>
          <div className="field">
            <label>From email</label>
            <input
              className="input"
              type="email"
              title="From email"
              value={brand.fromEmail}
              onChange={(e) => setBrand({ ...brand, fromEmail: e.target.value })}
            />
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
          <button type="button" className="btn primary" onClick={handleSaveBrand}>
            Save
          </button>
        </div>
        <div className="grid-3" style={{ marginTop: 18 }}>
          <div className="field">
            <label>Brand name</label>
            <input
              className="input"
              title="Brand name"
              value={brand.name}
              onChange={(e) => setBrand({ ...brand, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Primary colour</label>
            <input
              className="input mono"
              title="Primary colour"
              value={brand.color}
              onChange={(e) => setBrand({ ...brand, color: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Logo</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              title="Upload logo"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleLogoUpload(f);
              }}
            />
            <button
              type="button"
              className="input"
              onClick={() => fileRef.current?.click()}
              disabled={logoBusy}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--text-3)",
                cursor: "pointer",
                background: "var(--card-bg)",
                borderStyle: "dashed",
                textAlign: "left",
              }}
            >
              <Plus size={14} />{" "}
              {logoBusy ? "Uploading…" : logoUrl ? "Replace logo" : "Click to upload logo"}
            </button>
          </div>
        </div>
        {logoUrl && (
          <div style={{ marginTop: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl}
              alt="Brand logo"
              style={{ height: 48, borderRadius: 8, border: "1px solid var(--border)" }}
            />
          </div>
        )}
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
          <button type="button" className="btn" onClick={handleInvite} disabled={inviteBusy}>
            <UserPlus size={14} /> {inviteBusy ? "Sending…" : "Invite member"}
          </button>
        </div>
        <TeamTable />
      </div>
    </div>
  );
}

function TeamTable() {
  const supabase = createSupabaseBrowserClient();
  const [me, setMe] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        const meta = data.user.user_metadata || {};
        const name =
          (typeof meta.full_name === "string" && meta.full_name) ||
          (typeof meta.name === "string" && meta.name) ||
          (data.user.email ? data.user.email.split("@")[0] : "User");
        setMe({ name, email: data.user.email || "" });
      }
    });
  }, [supabase]);

  return (
    <table className="tbl" style={{ marginTop: 14 }}>
      <thead>
        <tr>
          <th>Member</th>
          <th>Email</th>
          <th>Role</th>
        </tr>
      </thead>
      <tbody>
        {me ? (
          <tr>
            <td>
              <div className="cell-main">
                <Avatar name={me.name} size={26} />
                <span className="nm">{me.name}</span>
              </div>
            </td>
            <td className="muted">{me.email}</td>
            <td>
              <span className="pill accent">Admin</span>
            </td>
          </tr>
        ) : (
          <tr>
            <td colSpan={3} className="muted" style={{ textAlign: "center" }}>
              No team data yet
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
