"use client";
import { useEffect, useRef, useState } from "react";
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

  async function handleInvite() {
    const email = prompt("Email of the teammate to invite:");
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.push({ kind: "error", text: "That doesn't look like a valid email." });
      return;
    }
    setInviteBusy(true);
    try {
      const r = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Invite failed.");
      toast.push({ kind: "success", text: `Invite sent to ${email.trim()}.` });
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
          more={<button className="pm-btn ghost sm" onClick={handleInvite} disabled={inviteBusy}><UserPlus size={14} /> {inviteBusy ? "Sending…" : "Invite member"}</button>}
        >
          <div style={{ marginTop: 4 }}><TeamTable /></div>
        </Panel>
      )}
    </div>
  );
}

type Member = { name: string; email: string };

function TeamTable() {
  const supabase = createSupabaseBrowserClient();
  const [me, setMe] = useState<Member | null>(null);

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

  const columns: Column<Member>[] = [
    { header: "Member", cell: (m) => <div className="pm-cellname"><Avatar name={m.name} size={30} /><span className="pm-b7">{m.name}</span></div> },
    { header: "Email", cell: (m) => <span className="pm-dim">{m.email}</span> },
    { header: "Role", cell: () => <StatusBadge tone="terra">Admin</StatusBadge> },
    { header: "Status", cell: () => <StatusBadge tone="green">Active</StatusBadge> },
  ];

  return <DataTable columns={columns} rows={me ? [me] : []} rowKey={(m) => m.email} empty="No team data yet" />;
}
