"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  MapPin,
  Phone,
  Mail,
  Calendar,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";

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

type EmailEvent = {
  id: string;
  event_type: string;
  created_at: string;
};

const eventPill: Record<string, string> = {
  clicked: "accent",
  opened: "green",
  delivered: "blue",
  sent: "grey",
  bounced: "amber",
  unsubscribed: "grey",
};

const statusPill: Record<string, { cls: string; label: string }> = {
  active: { cls: "green", label: "Active" },
  inactive: { cls: "amber", label: "Inactive" },
  unsubscribed: { cls: "grey", label: "Unsubscribed" },
  bounced: { cls: "accent", label: "Bounced" },
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtMonth(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const [contact, setContact] = useState<Contact | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const [contactRes, ordersRes, eventsRes] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("orders")
          .select("*")
          .eq("contact_id", id)
          .order("placed_at", { ascending: false })
          .limit(20),
        supabase
          .from("email_events")
          .select("*")
          .eq("contact_id", id)
          .order("created_at", { ascending: false })
          .limit(15),
      ]);

      if (contactRes.error || !contactRes.data) {
        setNotFound(true);
      } else {
        setContact(contactRes.data as Contact);
        setOrders((ordersRes.data || []) as Order[]);
        setEvents((eventsRes.data || []) as EmailEvent[]);
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

  if (!loaded) {
    return (
      <div className="page">
        <div className="muted">Loading…</div>
      </div>
    );
  }
  if (notFound || !contact) {
    return (
      <div className="page">
        <Link
          href="/dashboard/contacts"
          style={{ display: "inline-flex", gap: 6, alignItems: "center", color: "var(--text-2)", fontSize: 13 }}
        >
          <ChevronLeft size={14} /> Back to Contacts
        </Link>
        <div className="muted" style={{ marginTop: 18 }}>
          Contact not found.
        </div>
      </div>
    );
  }

  const fullName =
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
    contact.email.split("@")[0];
  const location = [contact.city, contact.state, contact.country].filter(Boolean).join(", ") || "—";
  const ltv = contact.total_spent
    ? `₹${Number(contact.total_spent).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
    : "₹0";
  const aov = contact.average_order_value
    ? `₹${Number(contact.average_order_value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
    : "—";
  const sp = statusPill[contact.status || "active"] || { cls: "grey", label: contact.status || "—" };
  const tags = contact.tags || [];
  const lists = contact.klaviyo_lists || [];
  const segments = contact.klaviyo_segments || [];
  const propEntries = contact.properties
    ? Object.entries(contact.properties).filter(([k]) => !k.startsWith("$"))
    : [];

  return (
    <div className="page">
      <Link
        href="/dashboard/contacts"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--text-2)",
          fontSize: 13,
          marginBottom: 16,
        }}
      >
        <ChevronLeft size={14} /> Back to Contacts
      </Link>

      <div className="card card-pad section" style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <Avatar name={fullName} size={64} fontSize={20} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <h1>{fullName}</h1>
            <span className={`pill ${sp.cls}`}>{sp.label}</span>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", color: "var(--text-2)", fontSize: 13 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Mail size={13} /> {contact.email}
            </span>
            {contact.phone && (
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Phone size={13} /> {contact.phone}
              </span>
            )}
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <MapPin size={13} /> {location}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Calendar size={13} /> Customer since {fmtMonth(contact.created_at)}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {contact.status !== "unsubscribed" && (
            <button type="button" className="btn" onClick={handleUnsubscribe} disabled={busy}>
              Unsubscribe
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={handleDelete}
            disabled={busy}
            style={{ color: "var(--accent)", borderColor: "var(--accent-soft)" }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <Stat icon={ShoppingBag} bg="var(--blue-soft)" color="var(--blue)" label="Total orders" value={(contact.total_orders ?? 0).toString()} />
        <Stat icon={ShoppingBag} bg="var(--green-soft)" color="var(--green)" label="Lifetime value" value={ltv} />
        <Stat icon={ShoppingBag} bg="var(--accent-soft)" color="var(--accent)" label="Avg order value" value={aov} />
        <Stat icon={ShoppingBag} bg="var(--amber-soft)" color="var(--amber)" label="Last purchase" value={fmtDate(contact.last_purchase_date)} />
      </div>

      <div className="grid-2 section">
        <div className="card card-pad">
          <div className="card-title">Order history</div>
          {orders.length > 0 ? (
            <table className="tbl" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Items</th>
                  <th>Value</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const items = o.products?.items || [];
                  const label = items.length ? items.join(", ") : "—";
                  return (
                    <tr key={o.id}>
                      <td style={{ color: "var(--accent)", fontWeight: 500 }}>
                        {o.order_number ? `#${o.order_number}` : o.id.substring(0, 8)}
                      </td>
                      <td
                        className="muted"
                        title={label}
                        style={{
                          maxWidth: 220,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {label}
                      </td>
                      <td className="num" style={{ color: "var(--green)", fontWeight: 500 }}>
                        {o.total_amount
                          ? `₹${Number(o.total_amount).toLocaleString("en-IN", {
                              maximumFractionDigits: 2,
                            })}`
                          : "—"}
                      </td>
                      <td className="muted">{fmtDate(o.placed_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="muted" style={{ padding: "32px 0", textAlign: "center", fontSize: 13 }}>
              No orders yet
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="card-title">Recent email events</div>
          {events.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              {events.map((e) => (
                <div key={e.id} className="legend-row">
                  <div className="legend-l">
                    <span className={`pill ${eventPill[e.event_type] || "grey"}`}>{e.event_type}</span>
                  </div>
                  <div className="legend-r muted">{fmtDate(e.created_at)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ padding: "32px 0", textAlign: "center", fontSize: 13 }}>
              No email activity yet
            </div>
          )}
        </div>
      </div>

      {(tags.length > 0 || lists.length > 0 || segments.length > 0) && (
        <div className="card card-pad section">
          <div className="card-title">Audience</div>
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {tags.map((t) => (
              <span key={`t-${t}`} className="tag">
                {t}
              </span>
            ))}
            {lists.map((t) => (
              <span key={`l-${t}`} className="tag">
                List: {t}
              </span>
            ))}
            {segments.map((t) => (
              <span key={`s-${t}`} className="tag">
                Segment: {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {propEntries.length > 0 && (
        <div className="card card-pad section">
          <div className="card-title">Custom properties</div>
          <div className="meta-grid" style={{ marginTop: 12 }}>
            {propEntries.slice(0, 12).map(([k, v]) => (
              <div key={k}>
                <div className="k">{k}</div>
                <div className="v" style={{ wordBreak: "break-word" }}>
                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  bg,
  color,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  bg: string;
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="kpi">
      <div className="ico" style={{ background: bg }}>
        <Icon size={15} color={color} />
      </div>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
