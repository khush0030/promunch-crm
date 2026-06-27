"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Plus, UserPlus, Store, ShoppingBag } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { PageHead, Tabs, Panel, HealthPill, StatusBadge, DataTable } from "@/components/pm";
import type { Column, HealthStatus } from "@/components/pm";

type Status = "healthy" | "degraded" | "down" | "unknown";
type Connector = { id: string; label: string; description: string; status: Status; headline: string; metrics: { label: string; value: string }[] };
type Health = { connectors: Connector[] };

const statusToHealth: Record<Status, HealthStatus> = { healthy: "ok", degraded: "warn", down: "off", unknown: "off" };
const statusLabel: Record<Status, string> = { healthy: "Healthy", degraded: "Degraded", down: "Down", unknown: "No data" };

const TABS = [
  { key: "connections", label: "Connections" },
  { key: "email", label: "Email" },
  { key: "brand", label: "Brand" },
  { key: "team", label: "Team" },
];

export default function SettingsPage() {
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState("connections");

  // Deep-link support: /dashboard/settings#team opens the Team tab (used by the
  // legacy /integrations and /team route redirects).
  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    if (h && TABS.some((t) => t.key === h)) setTab(h);
  }, []);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [brand, setBrand] = useState({
    name: "PROMUNCH",
    color: "#B9303F",
    fromName: "PROMUNCH",
    fromEmail: "hello@promunch.in",
    provider: "Resend",
  });

  useEffect(() => {
    fetch("/api/integrations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setHealth(d))
      .catch(() => {});
  }, []);

  async function handleDisconnect() {
    if (!confirm("Disconnect the Shopify store? Imports and webhooks will stop.")) return;
    setDisconnectBusy(true);
    try {
      await supabase.from("settings_audit").insert({ action: "shopify_disconnect" });
      toast.push({ kind: "info", text: "Shopify disconnect requested — env still configured." });
    } catch (e) {
      toast.push({ kind: "error", text: `Disconnect failed: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setDisconnectBusy(false);
    }
  }

  async function handleCatalogSync() {
    setCatalogBusy(true);
    try {
      const res = await fetch("/api/shopify/catalog", { method: "POST" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || d.detail || `Sync failed (${d.status ?? res.status})`);
      const retired = d.deactivated ? `, ${d.deactivated} retired` : "";
      toast.push({ kind: "success", text: `Synced ${d.synced ?? 0} products to the WhatsApp catalog${retired}.` });
    } catch (e) {
      toast.push({ kind: "error", text: `Catalog sync failed: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setCatalogBusy(false);
    }
  }

  async function submitInvite() {
    const email = inviteEmail.trim().toLowerCase();
    const name = inviteName.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.push({ kind: "error", text: "That doesn't look like a valid email." });
      return;
    }
    setInviteBusy(true);
    try {
      const r = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Invite failed.");
      toast.push({ kind: "success", text: `Invite sent to ${email}.` });
      setInviteOpen(false);
      setInviteEmail("");
      setInviteName("");
    } catch (e) {
      toast.push({ kind: "error", text: `Invite failed: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleLogoUpload(file: File) {
    setLogoBusy(true);
    try {
      const path = `brand/logo-${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("public-assets").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("public-assets").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      toast.push({ kind: "success", text: "Logo uploaded." });
    } catch (e) {
      toast.push({ kind: "error", text: `Upload failed: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleSaveBrand() {
    try {
      await supabase.from("settings_brand").upsert({ id: "default", ...brand, logo_url: logoUrl }, { onConflict: "id" });
      toast.push({ kind: "success", text: "Brand saved." });
    } catch (e) {
      toast.push({ kind: "error", text: `Save failed: ${e instanceof Error ? e.message : "unknown"}` });
    }
  }

  return (
    <div className="pm-page">
      <PageHead title="Settings" subtitle="Manage your PROMUNCH CRM configuration" />
      <Tabs tabs={TABS} active={tab} onSelect={setTab} />

      {tab === "connections" && (
        <div className="pm-grid g-11">
          <Panel title="Connections" icon={<Store className="tic" />} caption="Live status of every integration">
            <HealthPill name="Shopify" status="ok" statusLabel="Connected" />
            <HealthPill name="Email · Resend" status="ok" statusLabel="SPF·DKIM·DMARC" />
            {(health?.connectors ?? []).map((c) => (
              <HealthPill key={c.id} name={c.label} status={statusToHealth[c.status]} statusLabel={statusLabel[c.status]} />
            ))}
          </Panel>
          <Panel title="Shopify store" caption="Sync your Shopify store data">
            <div className="pm-pill"><span className="nm">Store URL</span><span className="pm-muted">{process.env.NEXT_PUBLIC_SHOPIFY_STORE_URL || "—"}</span></div>
            <div className="pm-pill"><span className="nm">Status</span><StatusBadge tone="green" icon={<CheckCircle2 />}>Connected</StatusBadge></div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button className="pm-btn primary" onClick={handleCatalogSync} disabled={catalogBusy}>
                <ShoppingBag size={15} /> {catalogBusy ? "Syncing…" : "Sync catalog to WhatsApp"}
              </button>
              <button className="pm-btn ghost" style={{ color: "var(--pm-terra)" }} onClick={handleDisconnect} disabled={disconnectBusy}>
                {disconnectBusy ? "Disconnecting…" : "Disconnect Shopify"}
              </button>
            </div>
            <p className="pm-muted" style={{ marginTop: 8, fontSize: 12 }}>
              Pulls active products into the WhatsApp catalog so customers can order in chat. Build your Meta catalog with Content ID = Shopify variant id.
            </p>
          </Panel>
        </div>
      )}

      {tab === "email" && (
        <Panel
          title="Email sending"
          caption="Configure your email provider and sender details"
          more={<button className="pm-btn primary sm" onClick={handleSaveBrand}>Save</button>}
        >
          <div className="pm-frow">
            <div className="pm-field"><label>Provider</label><input title="Provider" value={brand.provider} onChange={(e) => setBrand({ ...brand, provider: e.target.value })} /></div>
            <div className="pm-field"><label>From name</label><input title="From name" value={brand.fromName} onChange={(e) => setBrand({ ...brand, fromName: e.target.value })} /></div>
            <div className="pm-field"><label>From email</label><input type="email" title="From email" value={brand.fromEmail} onChange={(e) => setBrand({ ...brand, fromEmail: e.target.value })} /></div>
          </div>
          <div style={{ marginTop: 6 }}>
            <div className="pm-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600, marginBottom: 8 }}>Domain authentication</div>
            <StatusBadge tone="green" icon={<CheckCircle2 />}>SPF</StatusBadge>{" "}
            <StatusBadge tone="green" icon={<CheckCircle2 />}>DKIM</StatusBadge>{" "}
            <StatusBadge tone="green" icon={<CheckCircle2 />}>DMARC</StatusBadge>
          </div>
        </Panel>
      )}

      {tab === "brand" && (
        <Panel
          title="Brand"
          caption="Customise your brand appearance"
          more={<button className="pm-btn primary sm" onClick={handleSaveBrand}>Save</button>}
        >
          <div className="pm-frow">
            <div className="pm-field"><label>Brand name</label><input title="Brand name" value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} /></div>
            <div className="pm-field"><label>Primary colour</label><input title="Primary colour" value={brand.color} onChange={(e) => setBrand({ ...brand, color: e.target.value })} /></div>
            <div className="pm-field">
              <label>Logo</label>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} title="Upload logo" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }} />
              <button className="pm-btn ghost" onClick={() => fileRef.current?.click()} disabled={logoBusy} style={{ width: "100%", justifyContent: "flex-start", borderStyle: "dashed" }}>
                <Plus size={14} /> {logoBusy ? "Uploading…" : logoUrl ? "Replace logo" : "Click to upload logo"}
              </button>
            </div>
          </div>
          {logoUrl && (
            <div style={{ marginTop: 14 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt="Brand logo" style={{ height: 48, borderRadius: 8, border: "1px solid var(--pm-border)" }} />
            </div>
          )}
        </Panel>
      )}

      {tab === "team" && (
        <Panel
          title="Team members"
          caption="Manage access to PROMUNCH CRM"
          more={<button type="button" className="pm-btn ghost sm" onClick={() => setInviteOpen(true)} disabled={inviteBusy}><UserPlus size={14} /> Invite member</button>}
        >
          <div style={{ marginTop: 4 }}><TeamTable /></div>
        </Panel>
      )}

      {inviteOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(36,30,24,0.5)", display: "grid", placeItems: "center", padding: 20 }}
          onClick={() => !inviteBusy && setInviteOpen(false)}
        >
          <div
            className="card card-pad"
            style={{ width: "100%", maxWidth: 420, padding: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>Invite a teammate</h3>
            <div className="sub" style={{ marginBottom: 16 }}>
              They&apos;ll get a PROMUNCH email with a link to set a password and join. Only @vippysoya.com, @promunch.in or @trypromunch.in addresses are allowed.
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); submitInvite(); }}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div className="field">
                <label>Name (optional)</label>
                <input
                  className="input"
                  placeholder="Priya Sharma"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Work email</label>
                <input
                  className="input"
                  type="email"
                  placeholder="priya@promunch.in"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button type="submit" className="btn primary" disabled={inviteBusy} style={{ justifyContent: "center" }}>
                  {inviteBusy ? "Sending…" : "Send invite"}
                </button>
                <button type="button" className="btn" onClick={() => setInviteOpen(false)} disabled={inviteBusy} style={{ justifyContent: "center" }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

type Member = { id: string; name: string; email: string | null; role: string; confirmed: boolean };

const ROLE_TONE: Record<string, "terra" | "gold" | "blue"> = { owner: "terra", admin: "gold", agent: "blue" };

function TeamTable() {
  const [members, setMembers] = useState<Member[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<string>("admin");

  const load = useCallback(() => {
    fetch("/api/team")
      .then((r) => r.json())
      .then((j) => {
        setMembers(j.users ?? []);
        setCurrentId(j.currentUserId ?? null);
        setCurrentRole(j.currentUserRole ?? "admin");
      })
      .catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const canManage = currentRole === "owner" || currentRole === "admin";

  async function setRole(id: string, role: string) {
    await fetch("/api/team", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, role }),
    });
    load();
  }

  const columns: Column<Member>[] = [
    { header: "Member", cell: (m) => <div className="pm-cellname"><Avatar name={m.name} size={30} /><span className="pm-b7">{m.name}</span></div> },
    { header: "Email", cell: (m) => <span className="pm-dim">{m.email}</span> },
    {
      header: "Role",
      cell: (m) =>
        canManage && m.id !== currentId ? (
          <select className="select" value={m.role} onChange={(e) => setRole(m.id, e.target.value)} aria-label={`Role for ${m.name}`}>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="agent">Agent</option>
          </select>
        ) : (
          <StatusBadge tone={ROLE_TONE[m.role] ?? "gold"}>{m.role[0].toUpperCase() + m.role.slice(1)}</StatusBadge>
        ),
    },
    { header: "Status", cell: (m) => <StatusBadge tone={m.confirmed ? "green" : "gold"}>{m.confirmed ? "Active" : "Invited"}</StatusBadge> },
  ];

  return <DataTable columns={columns} rows={members} rowKey={(m) => m.id} empty="No team data yet" />;
}
