"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  Phone,
  Mail,
  Calendar,
  ShoppingBag,
  Receipt,
  Wallet,
  Clock,
  Trash2,
  MessageSquare,
  History,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useToast } from "@/components/ui/Toast";
import { PageHead, KpiCard, Panel, StatusBadge, EmptyState } from "@/components/pm";
import type { KpiTone, BadgeTone } from "@/components/pm";

type Contact = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  address1?: string | null;
  address2?: string | null;
  zip?: string | null;
  total_orders?: number;
  total_spent?: number;
  average_order_value?: number;
  first_purchase_date?: string | null;
  last_purchase_date?: string | null;
  created_at?: string;
  status?: string;
  tags?: string[] | null;
  accepts_marketing?: boolean | null;
  email_consent?: string | null;
  sms_consent?: string | null;
  klaviyo_lists?: string[] | null;
  klaviyo_segments?: string[] | null;
  properties?: Record<string, unknown> | null;
};

type Order = {
  id: string;
  order_number?: string | null;
  total_amount?: number | null;
  currency?: string;
  status?: string | null;
  products?: { items?: string[]; itemCount?: number } | null;
  placed_at?: string | null;
};

type EmailEvent = { id: string; event_type: string; created_at: string };
type WaMsg = { id: string; direction: "inbound" | "outbound"; type: string; body: string | null; status: string; created_at: string };
type WaActivity = { matched: boolean; wa_id?: string; name?: string | null; thread_id?: string | null; messages: WaMsg[] };
type Activity =
  | { kind: "order"; at: string; order: Order }
  | { kind: "email"; at: string; event: EmailEvent }
  | { kind: "wa"; at: string; msg: WaMsg };

const statusMeta: Record<string, { tone: BadgeTone; label: string }> = {
  active: { tone: "green", label: "Active" },
  inactive: { tone: "gold", label: "Inactive" },
  unsubscribed: { tone: "gray", label: "Unsubscribed" },
  bounced: { tone: "terra", label: "Bounced" },
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function fmtMonth(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = createSupabaseBrowserClient();
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const [contact, setContact] = useState<Contact | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [waActivity, setWaActivity] = useState<WaActivity>({ matched: false, messages: [] });
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const [contactRes, ordersRes, eventsRes, waRes] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
        supabase.from("orders").select("*").eq("contact_id", id).order("placed_at", { ascending: false }).limit(20),
        supabase.from("email_events").select("*").eq("contact_id", id).order("created_at", { ascending: false }).limit(15),
        fetch(`/api/contacts/${id}/whatsapp`).then((r) => r.json()).catch(() => null),
      ]);

      if (contactRes.error || !contactRes.data) {
        setNotFound(true);
      } else {
        setContact(contactRes.data as Contact);
        setOrders((ordersRes.data || []) as Order[]);
        setEvents((eventsRes.data || []) as EmailEvent[]);
        if (waRes && typeof waRes === "object") {
          setWaActivity({
            matched: !!waRes.matched,
            wa_id: waRes.wa_id,
            name: waRes.name,
            thread_id: waRes.thread_id,
            messages: (waRes.messages ?? []) as WaMsg[],
          });
        }
      }
      setLoaded(true);
    }
    load();
  }, [id]);

  async function handleUnsubscribe() {
    if (!contact) return;
    if (!confirm(`Unsubscribe ${contact.email} from all email marketing?`)) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("contacts")
        .update({ status: "unsubscribed", accepts_marketing: false })
        .eq("id", contact.id)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (data) setContact(data as Contact);
      toast.push({ kind: "success", text: "Contact unsubscribed." });
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Update failed" });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!contact) return;
    if (!confirm(`Delete ${contact.email}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("contacts").delete().eq("id", contact.id);
      if (error) throw error;
      toast.push({ kind: "success", text: "Contact deleted." });
      router.push("/dashboard/contacts");
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Delete failed" });
    } finally {
      setBusy(false);
    }
  }

  const backLink = (
    <Link href="/dashboard/contacts" className="more" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8, color: "var(--pm-muted)", fontSize: 12 }}>
      <ArrowLeft size={14} /> Back to contacts
    </Link>
  );

  if (!loaded) return <div className="pm-page"><PageHead title="Contact" subtitle="Loading…" /></div>;
  if (notFound || !contact)
    return (
      <div className="pm-page">
        <PageHead back={backLink} title="Not found" subtitle="This contact doesn’t exist." />
      </div>
    );

  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email.split("@")[0];
  const location = [contact.city, contact.state, contact.country].filter(Boolean).join(", ") || "—";
  const ltv = contact.total_spent ? `₹${Number(contact.total_spent).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "₹0";
  const aov = contact.average_order_value ? `₹${Number(contact.average_order_value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—";
  const sp = statusMeta[contact.status || "active"] || { tone: "gray" as BadgeTone, label: contact.status || "—" };
  const tags = contact.tags || [];
  const lists = contact.klaviyo_lists || [];
  const segments = contact.klaviyo_segments || [];
  const propEntries = contact.properties ? Object.entries(contact.properties).filter(([k]) => !k.startsWith("$")) : [];

  const timeline: Activity[] = [
    ...orders.filter((o) => o.placed_at).map((o) => ({ kind: "order" as const, at: o.placed_at!, order: o })),
    ...events.map((e) => ({ kind: "email" as const, at: e.created_at, event: e })),
    ...waActivity.messages.map((m) => ({ kind: "wa" as const, at: m.created_at, msg: m })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  const kpis: { label: string; value: string; icon: React.ReactNode; tone: KpiTone }[] = [
    { label: "Total orders", value: String(contact.total_orders ?? 0), icon: <ShoppingBag />, tone: "b" },
    { label: "Lifetime value", value: ltv, icon: <Wallet />, tone: "g" },
    { label: "Avg order value", value: aov, icon: <Receipt />, tone: "t" },
    { label: "Last purchase", value: fmtDate(contact.last_purchase_date), icon: <Clock />, tone: "o" },
  ];

  return (
    <div className="pm-page">
      <PageHead
        back={backLink}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            {fullName} <StatusBadge tone={sp.tone}>{sp.label}</StatusBadge>
          </span>
        }
        subtitle={
          <span style={{ display: "inline-flex", gap: 14, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Mail size={13} /> {contact.email}</span>
            {contact.phone && <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Phone size={13} /> {contact.phone}</span>}
            {location !== "—" && <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><MapPin size={13} /> {location}</span>}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Calendar size={13} /> since {fmtMonth(contact.created_at)}</span>
          </span>
        }
        actions={
          <>
            {contact.status !== "unsubscribed" && (
              <button className="pm-btn ghost" onClick={handleUnsubscribe} disabled={busy}>Unsubscribe</button>
            )}
            <button className="pm-btn ghost" onClick={handleDelete} disabled={busy} style={{ color: "var(--pm-terra)" }} aria-label="Delete contact">
              <Trash2 size={15} />
            </button>
          </>
        }
      />

      <div className="pm-kpis" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} icon={k.icon} tone={k.tone} />
        ))}
      </div>

      <div className="pm-grid g-2-1">
        <Panel
          title="Activity"
          icon={<History className="tic" />}
          caption={`Orders, email${waActivity.matched ? " & WhatsApp" : ""} events — newest first`}
          more={
            waActivity.matched ? (
              <Link href="/dashboard/whatsapp" style={{ color: "var(--pm-green)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <MessageSquare size={12} /> Open chat
              </Link>
            ) : undefined
          }
        >
          {timeline.length === 0 ? (
            <EmptyState icon={<History />} title="No activity yet" style={{ border: 0, padding: "30px 0" }} />
          ) : (
            <div>
              {timeline.slice(0, 40).map((it, i) => {
                let chipBg = "var(--pm-card2)";
                let chipColor = "var(--pm-hint)";
                let Icon = ShoppingBag as React.ComponentType<{ size?: number; color?: string }>;
                let text = "";
                let tooltip = "";
                if (it.kind === "order") {
                  chipBg = "var(--pm-green-soft)"; chipColor = "var(--pm-green)"; Icon = ShoppingBag;
                  const o = it.order;
                  const amt = o.total_amount ? `₹${Number(o.total_amount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "";
                  const oid = o.order_number ? `#${o.order_number}` : o.id.substring(0, 8);
                  text = `Ordered ${oid}${amt ? ` · ${amt}` : ""}`;
                  tooltip = (o.products?.items || []).join(", ");
                } else if (it.kind === "email") {
                  chipBg = "var(--pm-blue-soft)"; chipColor = "var(--pm-blue)"; Icon = Mail;
                  text = `Email ${it.event.event_type}`;
                } else {
                  chipBg = "var(--pm-terra-soft)"; chipColor = "var(--pm-terra)"; Icon = MessageSquare;
                  const dir = it.msg.direction === "outbound" ? "sent" : "received";
                  const body = (it.msg.body || "").trim();
                  const snip = body.length > 80 ? `${body.slice(0, 80)}…` : body;
                  text = `WhatsApp ${dir}${snip ? `: ${snip}` : ""}`;
                  tooltip = body;
                }
                return (
                  <div key={`${it.kind}-${i}`} className="pm-pill" title={tooltip || undefined}>
                    <span style={{ width: 24, height: 24, borderRadius: 8, background: chipBg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon size={12} color={chipColor} />
                    </span>
                    <span className="nm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
                    <span className="pm-dim" style={{ fontSize: 12 }}>{fmtDate(it.at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Audience" icon={<MapPin className="tic" />} caption="Lists & segments">
          {tags.length === 0 && lists.length === 0 && segments.length === 0 ? (
            <div className="pm-dim" style={{ fontSize: 13 }}>No tags or segments.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {tags.map((t) => <span key={`t-${t}`} className="pm-tag">{t}</span>)}
              {lists.map((t) => <span key={`l-${t}`} className="pm-tag">List: {t}</span>)}
              {segments.map((t) => <span key={`s-${t}`} className="pm-tag">Segment: {t}</span>)}
            </div>
          )}
        </Panel>
      </div>

      {propEntries.length > 0 && (
        <Panel title="Custom properties" style={{ marginTop: 14 }}>
          <div className="pm-frow" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {propEntries.slice(0, 12).map(([k, v]) => (
              <div key={k}>
                <div className="pm-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 13.5, wordBreak: "break-word" }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
