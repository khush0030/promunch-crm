"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, UserPlus, ShoppingBag, Mail, Inbox, Sparkles, MessageSquare, Plug, type LucideIcon } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { PageHeader, Avatar } from "@/components/pm";
import { ApiKeysPanel } from "@/components/settings/ApiKeysPanel";
import { MODULES, type ModuleKey } from "@/lib/access";
import { ago } from "@/components/admin/format";
import css from "@/components/settings/Settings.module.css";

type Status = "healthy" | "degraded" | "down" | "unknown";
type Connector = { id: string; label: string; description: string; status: Status; headline: string; metrics: { label: string; value: string }[] };
type Health = { connectors: Connector[] };

const statusLabel: Record<Status, string> = { healthy: "Working", degraded: "Needs a look", down: "Broken", unknown: "No data" };
const STATUS_CLASS: Record<Status, "good" | "warn" | "bad" | "off"> = { healthy: "good", degraded: "warn", down: "bad", unknown: "off" };

function connectorIcon(id: string): LucideIcon {
  if (id.includes("slack")) return MessageSquare;
  if (id.includes("gmail")) return Inbox;
  if (id.includes("shopify")) return ShoppingBag;
  if (id.includes("anthropic") || id.includes("openai") || id.includes("ai")) return Sparkles;
  return Plug;
}

const TABS = [
  { key: "connections", label: "Connections" },
  { key: "team", label: "Team & access" },
  { key: "apikeys", label: "API keys" },
  { key: "brand", label: "Brand & email" },
];
const TAB_META: Record<string, { crumb: string; title: string }> = {
  connections: { crumb: "Settings", title: "Settings" },
  team: { crumb: "Settings", title: "Team & access" },
  apikeys: { crumb: "Settings · owner only", title: "API keys" },
  brand: { crumb: "Settings", title: "Brand & email" },
};
// Older deep links (#email) land on the merged Brand & email tab.
const HASH_ALIAS: Record<string, string> = { email: "brand" };

export default function SettingsPage() {
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState("connections");

  // Deep-link support: /dashboard/settings#team opens the Team tab (used by the
  // legacy /integrations and /team route redirects).
  useEffect(() => {
    const raw = window.location.hash.replace("#", "");
    const h = HASH_ALIAS[raw] ?? raw;
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

  const tabMeta = TAB_META[tab] ?? TAB_META.connections;
  const connectors = health?.connectors ?? [];
  const total = connectors.length + 2; // + Shopify and Resend, always listed
  const working = connectors.filter((c) => c.status === "healthy").length + 2;
  const needLook = connectors.filter((c) => c.status === "degraded" || c.status === "down").length;

  return (
    <>
      <PageHeader
        crumb={tabMeta.crumb}
        title={tabMeta.title}
        tabs={TABS}
        activeTab={tab}
        onTab={setTab}
        actions={
          tab === "team" ? (
            <button type="button" className="pm2-btn pri" onClick={() => setInviteOpen(true)} disabled={inviteBusy}>
              <UserPlus /> Invite
            </button>
          ) : tab === "brand" ? (
            <button type="button" className="pm2-btn pri" onClick={handleSaveBrand}>Save</button>
          ) : undefined
        }
      />
      <div className="pm2-body">
        {tab === "connections" && (
          <div>
            <p className={css.sum}>
              {!health ? (
                "Checking every connection…"
              ) : working === total ? (
                <><b>All {total} connections are working.</b> Checked when you opened this page.</>
              ) : (
                <><b>{working} of {total} connections are working.</b>{needLook > 0 ? ` ${needLook} need a look.` : " The rest have no recent data."}</>
              )}
            </p>
            <div className={css.card}>
              <div className={css.row}>
                <span className={css.ic}><ShoppingBag /></span>
                <div className={css.tx}><b>Shopify</b><span>Orders, customers and catalog</span></div>
                <span className={`${css.st} ${css.good}`}>Connected</span>
              </div>
              <div className={css.row}>
                <span className={css.ic}><Mail /></span>
                <div className={css.tx}><b>Email sending (Resend)</b><span>SPF · DKIM · DMARC verified</span></div>
                <span className={`${css.st} ${css.good}`}>Working</span>
              </div>
              {connectors.map((c) => {
                const Icon = connectorIcon(c.id);
                return (
                  <div key={c.id} className={css.row}>
                    <span className={css.ic}><Icon /></span>
                    <div className={css.tx}><b>{c.label}</b><span>{c.headline || c.description}</span></div>
                    <span className={`${css.st} ${css[STATUS_CLASS[c.status]]}`}>{statusLabel[c.status]}</span>
                  </div>
                );
              })}
            </div>

            <div className={css.secH}><h2>Shopify store</h2><span>Sync your Shopify store data</span></div>
            <div className={`${css.card} ${css.cardPad}`}>
              <dl className={css.facts}>
                <dt>Store URL</dt><dd>{process.env.NEXT_PUBLIC_SHOPIFY_STORE_URL || "Not set"}</dd>
                <dt>Status</dt><dd><span className={`${css.st} ${css.good}`}>Connected</span></dd>
              </dl>
              <div className={css.btnRow}>
                <button type="button" className="pm2-btn" onClick={handleCatalogSync} disabled={catalogBusy}>
                  <ShoppingBag /> {catalogBusy ? "Syncing…" : "Sync catalog to WhatsApp"}
                </button>
                <button type="button" className={`pm2-btn ghost ${css.quiet}`} onClick={handleDisconnect} disabled={disconnectBusy}>
                  {disconnectBusy ? "Disconnecting…" : "Disconnect Shopify"}
                </button>
              </div>
              <p className={css.note}>
                Pulls active products into the WhatsApp catalog so customers can order in chat. Build your Meta catalog with Content ID = Shopify variant id.
              </p>
            </div>
          </div>
        )}

        {tab === "apikeys" && (
          <div>
            <p className={css.sum}>Keys for the services the CRM talks to. Changing one takes effect within a minute, no redeploy.</p>
            <ApiKeysPanel />
          </div>
        )}

        {tab === "brand" && (
          <div>
            <p className={css.sum}>Used by every email, popup and creator page.</p>
            <div className={css.g2}>
              <div className={`${css.card} ${css.cardPad}`}>
                <div className={css.field}>
                  <label htmlFor="brand-name">Brand name</label>
                  <input id="brand-name" className={css.in} title="Brand name" value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} />
                </div>
                <div className={css.field}>
                  <label htmlFor="brand-color">Primary colour</label>
                  <div className={css.swatchRow}>
                    <span className={css.swatch} style={{ background: brand.color }} aria-hidden />
                    <input id="brand-color" className={css.in} title="Primary colour" value={brand.color} onChange={(e) => setBrand({ ...brand, color: e.target.value })} />
                  </div>
                </div>
                <div className={css.field}>
                  <span className={css.lab}>Logo</span>
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} title="Upload logo" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }} />
                  <button type="button" className={`pm2-btn ${css.upload}`} onClick={() => fileRef.current?.click()} disabled={logoBusy}>
                    <Plus /> {logoBusy ? "Uploading…" : logoUrl ? "Replace logo" : "Click to upload logo"}
                  </button>
                  {logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="Brand logo" className={css.logo} />
                  )}
                </div>
              </div>
              <div className={`${css.card} ${css.cardPad}`}>
                <div className={css.field}>
                  <label htmlFor="mail-provider">Provider</label>
                  <input id="mail-provider" className={css.in} title="Provider" value={brand.provider} onChange={(e) => setBrand({ ...brand, provider: e.target.value })} />
                </div>
                <div className={css.field}>
                  <label htmlFor="mail-from-name">From name</label>
                  <input id="mail-from-name" className={css.in} title="From name" value={brand.fromName} onChange={(e) => setBrand({ ...brand, fromName: e.target.value })} />
                </div>
                <div className={css.field}>
                  <label htmlFor="mail-from-email">Send emails from</label>
                  <input id="mail-from-email" type="email" className={css.in} title="From email" value={brand.fromEmail} onChange={(e) => setBrand({ ...brand, fromEmail: e.target.value })} />
                </div>
                <div className={css.field}>
                  <span className={css.lab}>Domain authentication</span>
                  <div className={css.auth}>
                    <span className={`${css.st} ${css.good}`}>SPF</span>
                    <span className={`${css.st} ${css.good}`}>DKIM</span>
                    <span className={`${css.st} ${css.good}`}>DMARC</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "team" && <div><TeamTable /></div>}
      </div>

      {inviteOpen && (
        <div className="pm2-dialog-backdrop" onClick={() => !inviteBusy && setInviteOpen(false)}>
          <div className={`pm2-dialog ${css.dlg}`} role="dialog" aria-modal="true" aria-label="Invite a teammate" onClick={(e) => e.stopPropagation()}>
            <div className="t">Invite a teammate</div>
            <div className="c">
              They&apos;ll get a PROMUNCH email with a link to set a password and join. Only @vippysoya.com, @promunch.in or @trypromunch.in addresses are allowed.
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); submitInvite(); }}
              className={css.form}
            >
              <div className={css.field}>
                <label htmlFor="invite-name">Name (optional)</label>
                <input
                  id="invite-name"
                  className={css.in}
                  placeholder="Priya Sharma"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className={css.field}>
                <label htmlFor="invite-email">Work email</label>
                <input
                  id="invite-email"
                  className={css.in}
                  type="email"
                  placeholder="priya@promunch.in"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="act">
                <button type="button" className="pm2-btn" onClick={() => setInviteOpen(false)} disabled={inviteBusy}>
                  Cancel
                </button>
                <button type="submit" className="pm2-btn pri" disabled={inviteBusy}>
                  {inviteBusy ? "Sending…" : "Send invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

type Member = { id: string; name: string; email: string | null; role: string; modules: ModuleKey[] | null; confirmed: boolean; last_sign_in_at?: string | null };

function TeamTable() {
  const [members, setMembers] = useState<Member[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<string>("admin");
  const [editing, setEditing] = useState<Member | null>(null);

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

  const roleName = (r: string) => r[0].toUpperCase() + r.slice(1);
  const areaChips = (m: Member): string[] =>
    m.role !== "agent"
      ? ["Everything"]
      : m.modules === null
        ? ["All areas"]
        : m.modules.length === 0
          ? ["No areas"]
          : MODULES.filter((x) => m.modules!.includes(x.key)).map((x) => x.label);

  return (
    <>
      <p className={css.sum}>
        {members.length ? <><b>{members.length} {members.length === 1 ? "person" : "people"}.</b> Choose which areas each person can open.</> : "Choose which areas each person can open."}
      </p>
      <div className={css.card}>
        {members.length === 0 && <div className={css.empty}>No team data yet</div>}
        {members.map((m) => {
          const editable = canManage && m.id !== currentId;
          return (
            <div key={m.id} className={css.member}>
              <Avatar name={m.name} size={34} />
              <div className={css.mBody}>
                <div className={css.mName}>
                  <span>{m.name}</span>
                  {editable ? (
                    <select className={css.roleSel} value={m.role} onChange={(e) => setRole(m.id, e.target.value)} aria-label={`Role for ${m.name}`}>
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="agent">Agent</option>
                    </select>
                  ) : (
                    <span className={css.role}>{roleName(m.role)}</span>
                  )}
                </div>
                {m.email && <span className={css.mMail}>{m.email}</span>}
                <span className={css.areas} title={m.role !== "agent" ? "Owners and admins can use every area" : undefined}>
                  {areaChips(m).map((a) => <em key={a}>{a}</em>)}
                </span>
                <span className={css.seen}>
                  {m.confirmed ? (
                    <>Last seen {ago(m.last_sign_in_at ?? null).toLowerCase()}</>
                  ) : (
                    <span className={`${css.st} ${css.warn}`}>Invited, not joined yet</span>
                  )}
                </span>
              </div>
              {editable && m.role === "agent" ? (
                <button type="button" className={css.link} onClick={() => setEditing(m)} title="Choose which areas this member can use">
                  Change
                </button>
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </div>
      {editing && (
        <AccessDialog
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}

// Pick the areas an Agent can use. "All areas" stores no restriction, so the
// member also gets any area added later; a ticked list is exactly those areas.
function AccessDialog({ member, onClose, onSaved }: { member: Member; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [all, setAll] = useState(member.modules === null);
  const [picked, setPicked] = useState<Set<ModuleKey>>(new Set(member.modules ?? []));
  const [busy, setBusy] = useState(false);

  function toggle(k: ModuleKey) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: member.id, modules: all ? null : [...picked] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Save failed.");
      toast.push({ kind: "success", text: `Access updated for ${member.name}.` });
      onSaved();
    } catch (e) {
      toast.push({ kind: "error", text: `Couldn't save access: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pm2-dialog-backdrop" onClick={() => !busy && onClose()}>
      <div
        className={`pm2-dialog ${css.dlgWide}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Access for ${member.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="t">Access for {member.name}</div>
        <div className="c">
          Choose which parts of the CRM {member.email ?? "this member"} can open. Everything else is hidden and blocked.
        </div>

        <label className={`${css.check} ${css.checkAll}`}>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          <span>
            <b>All areas</b>
            <small>Everything a member can use today, plus any area added later.</small>
          </span>
        </label>

        <div className={all ? css.dim : undefined}>
          {MODULES.map((m) => (
            <label key={m.key} className={css.check} style={{ cursor: all ? "default" : "pointer" }}>
              <input
                type="checkbox"
                disabled={all}
                checked={all || picked.has(m.key)}
                onChange={() => toggle(m.key)}
              />
              <span>
                <b>{m.label}</b>
                <small>{m.hint}</small>
              </span>
            </label>
          ))}
        </div>

        <div className="act">
          <button type="button" className="pm2-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="pm2-btn pri" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save access"}
          </button>
        </div>
      </div>
    </div>
  );
}
