"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, MapPin, Phone, Mail, Calendar, Tag, X, ShoppingBag, GitBranch } from "lucide-react";
import { supabase } from "@/lib/supabase";

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
  locale?: string | null;
  timezone?: string | null;
  total_orders?: number;
  total_spent?: number;
  average_order_value?: number;
  first_purchase_date?: string | null;
  last_purchase_date?: string | null;
  created_at?: string;
  status?: string;
  tags?: string[] | null;
  klaviyo_id?: string | null;
  external_id?: string | null;
  accepts_marketing?: boolean | null;
  email_consent?: string | null;
  sms_consent?: string | null;
  consent_source?: string | null;
  klaviyo_created_at?: string | null;
  klaviyo_updated_at?: string | null;
  last_event_at?: string | null;
  klaviyo_lists?: string[] | null;
  klaviyo_segments?: string[] | null;
  properties?: Record<string, unknown> | null;
  predictive_analytics?: Record<string, unknown> | null;
};

type Order = {
  id: string;
  order_number?: string | null;
  total_amount?: number | null;
  currency?: string;
  status?: string | null;
  products?: { items?: string[]; itemCount?: number; discountCodes?: string[] } | null;
  placed_at?: string | null;
};

type EmailEvent = {
  id: string;
  event_type: string;
  created_at: string;
  campaign_email_id?: string | null;
};

const eventColors: Record<string, { bg: string; color: string }> = {
  clicked: { bg: "rgba(185, 28, 74, 0.15)", color: "#E8658B" },
  opened: { bg: "rgba(16, 185, 129, 0.15)", color: "var(--green)" },
  delivered: { bg: "rgba(59, 130, 246, 0.15)", color: "var(--blue)" },
  sent: { bg: "rgba(113, 113, 122, 0.15)", color: "var(--text-2)" },
  bounced: { bg: "rgba(239, 68, 68, 0.15)", color: "var(--accent)" },
  unsubscribed: { bg: "rgba(113, 113, 122, 0.15)", color: "var(--text-2)" },
};

function formatDate(d?: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatMonth(d?: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [contact, setContact] = useState<Contact | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function load() {
      const [contactRes, ordersRes, eventsRes] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
        supabase.from("orders").select("*").eq("contact_id", id).order("placed_at", { ascending: false }).limit(20),
        supabase.from("email_events").select("*").eq("contact_id", id).order("created_at", { ascending: false }).limit(15),
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

  if (!loaded) {
    return <div style={{ padding: "32px", color: "var(--text-2)" }}></div>;
  }

  if (notFound || !contact) {
    return (
      <div style={{ padding: "32px" }}>
        <Link href="/dashboard/contacts">
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--text-2)", fontSize: "14px", marginBottom: "24px", cursor: "pointer" }}>
            <ChevronLeft size={16} />
            Back to Contacts
          </div>
        </Link>
        <div style={{ color: "var(--text-2)" }}>Contact not found.</div>
      </div>
    );
  }

  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email.split("@")[0];
  const initials = fullName.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase();
  const location = [contact.city, contact.state, contact.country].filter(Boolean).join(", ") || "";
  const fullAddress = [contact.address1, contact.address2, contact.city, contact.state, contact.zip, contact.country].filter(Boolean).join(", ");
  const ltv = contact.total_spent ? `₹${Number(contact.total_spent).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "₹0";
  const aov = contact.average_order_value ? `₹${Number(contact.average_order_value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "₹0";
  const tags = contact.tags || [];
  const lists = contact.klaviyo_lists || [];
  const segments = contact.klaviyo_segments || [];
  const status = contact.status || "active";
  const consentColor = (val?: string | null) => {
    if (val === "SUBSCRIBED") return "var(--green)";
    if (val === "UNSUBSCRIBED" || val === "NEVER_SUBSCRIBED") return "var(--accent)";
    return "var(--text-2)";
  };
  const propEntries = contact.properties
    ? Object.entries(contact.properties).filter(([k]) => !k.startsWith("$consent") && k !== "$source")
    : [];

  return (
    <div style={{ padding: "32px" }}>
      <Link href="/dashboard/contacts">
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--text-2)", fontSize: "14px", marginBottom: "24px", cursor: "pointer" }}>
          <ChevronLeft size={16} />
          Back to Contacts
        </div>
      </Link>

      <div
        style={{
          backgroundColor: "var(--card-bg)",
          border: "1px solid var(--border)",
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
            background: "linear-gradient(135deg, var(--accent), #8B1539)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "28px",
            fontWeight: 700,
            color: "var(--card-bg)",
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <h1 style={{ fontSize: "24px", fontWeight: 700, color: "var(--text)" }}>{fullName}</h1>
            <span style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: 600, backgroundColor: "rgba(16, 185, 129, 0.15)", color: "var(--green)" }}>
              {status}
            </span>
          </div>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-2)", fontSize: "13px" }}>
              <Mail size={14} />
              {contact.email}
            </div>
            {contact.phone && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-2)", fontSize: "13px" }}>
                <Phone size={14} />
                {contact.phone}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-2)", fontSize: "13px" }}>
              <MapPin size={14} />
              {location}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-2)", fontSize: "13px" }}>
              <Calendar size={14} />
              Customer since {formatMonth(contact.created_at)}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "20px" }}>
        {[
          { label: "Total Orders", value: contact.total_orders ?? 0, sub: "all time", color: "var(--blue)", bg: "rgba(59, 130, 246, 0.1)" },
          { label: "Total Spent (LTV)", value: ltv, sub: "lifetime value", color: "var(--green)", bg: "rgba(16, 185, 129, 0.1)" },
          { label: "Avg Order Value", value: aov, sub: "per order", color: "var(--accent)", bg: "rgba(185, 28, 74, 0.1)" },
          { label: "Last Purchase", value: formatDate(contact.last_purchase_date), sub: "", color: "var(--amber)", bg: "rgba(245, 183, 49, 0.1)" },
        ].map((s) => (
          <div key={s.label} style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "8px", backgroundColor: s.bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "12px" }}>
              <ShoppingBag size={18} color={s.color} />
            </div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--text)" }}>{s.value}</div>
            <div style={{ fontSize: "12px", color: "var(--text-2)", marginTop: "4px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
        <div style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)", marginBottom: "20px" }}>Order History</h2>
          {orders.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Order", "Items", "Value", "Date"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "0 0 10px 0", fontSize: "11px", fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid var(--border)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => {
                  const items = o.products?.items || [];
                  const itemsLabel = items.length > 0 ? items.join(", ") : "";
                  return (
                    <tr key={o.id} style={{ borderBottom: i < orders.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <td style={{ padding: "12px 0", fontSize: "12px", fontWeight: 600, color: "var(--accent)" }}>
                        {o.order_number ? `#${o.order_number}` : o.id.substring(0, 8)}
                      </td>
                      <td style={{ padding: "12px 8px", fontSize: "12px", color: "var(--text-2)", maxWidth: "240px" }} title={itemsLabel}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {itemsLabel}
                        </div>
                      </td>
                      <td style={{ padding: "12px 8px", fontSize: "13px", color: "var(--green)", fontWeight: 600 }}>
                        {o.total_amount ? `₹${Number(o.total_amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : ""}
                      </td>
                      <td style={{ padding: "12px 0", fontSize: "12px", color: "var(--text-2)" }}>{formatDate(o.placed_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ color: "var(--text-3)", fontSize: "13px", padding: "16px 0" }}>No orders yet.</div>
          )}
        </div>

        <div style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)", marginBottom: "20px" }}>Email Engagement</h2>
          {events.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {events.map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: eventColors[e.event_type]?.color || "var(--text-2)", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13px", color: "var(--text)" }}>{e.event_type}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-3)" }}>{formatDate(e.created_at)}</div>
                  </div>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: "20px",
                      fontSize: "11px",
                      fontWeight: 600,
                      backgroundColor: eventColors[e.event_type]?.bg || "rgba(113, 113, 122, 0.15)",
                      color: eventColors[e.event_type]?.color || "var(--text-2)",
                    }}
                  >
                    {e.event_type}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "var(--text-3)", fontSize: "13px", padding: "16px 0" }}>No email events yet.</div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
        <div style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)", marginBottom: "16px" }}>Marketing Consent</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-2)" }}>Email</span>
              <span style={{ color: consentColor(contact.email_consent), fontWeight: 600 }}>
                {contact.email_consent || ""}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-2)" }}>SMS</span>
              <span style={{ color: consentColor(contact.sms_consent), fontWeight: 600 }}>
                {contact.sms_consent || ""}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-2)" }}>Accepts marketing</span>
              <span style={{ color: contact.accepts_marketing ? "var(--green)" : "var(--text-2)", fontWeight: 600 }}>
                {contact.accepts_marketing == null ? "" : contact.accepts_marketing ? "Yes" : "No"}
              </span>
            </div>
            {contact.consent_source && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-2)" }}>Source</span>
                <span style={{ color: "var(--text)" }}>{contact.consent_source}</span>
              </div>
            )}
            {contact.last_event_at && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-2)" }}>Last activity</span>
                <span style={{ color: "var(--text)" }}>{formatDate(contact.last_event_at)}</span>
              </div>
            )}
            {contact.first_purchase_date && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-2)" }}>First purchase</span>
                <span style={{ color: "var(--text)" }}>{formatDate(contact.first_purchase_date)}</span>
              </div>
            )}
            {contact.locale && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-2)" }}>Locale</span>
                <span style={{ color: "var(--text)" }}>{contact.locale}</span>
              </div>
            )}
            {contact.timezone && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-2)" }}>Timezone</span>
                <span style={{ color: "var(--text)" }}>{contact.timezone}</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)", marginBottom: "16px" }}>Address</h2>
          {fullAddress ? (
            <div style={{ fontSize: "13px", color: "var(--text-2)", lineHeight: 1.7 }}>{fullAddress}</div>
          ) : (
            <div style={{ color: "var(--text-3)", fontSize: "13px" }}>No address on file.</div>
          )}
          {(contact.klaviyo_id || contact.external_id) && (
            <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px" }}>
              {contact.klaviyo_id && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-2)" }}>Klaviyo ID</span>
                  <span style={{ color: "var(--text-2)", fontFamily: "monospace" }}>{contact.klaviyo_id}</span>
                </div>
              )}
              {contact.external_id && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-2)" }}>External ID</span>
                  <span style={{ color: "var(--text-2)", fontFamily: "monospace" }}>{contact.external_id}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
        <div style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <Tag size={16} color="var(--accent)" />
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)" }}>Lists & Segments</h2>
          </div>
          {lists.length === 0 && segments.length === 0 ? (
            <div style={{ color: "var(--text-3)", fontSize: "13px" }}>Not in any list or segment.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {lists.length > 0 && (
                <div>
                  <div style={{ fontSize: "11px", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Lists</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {lists.map((l) => (
                      <span key={l} style={{ padding: "4px 10px", borderRadius: "20px", backgroundColor: "rgba(0, 180, 216, 0.1)", color: "#00B4D8", fontSize: "12px", fontWeight: 500 }}>{l}</span>
                    ))}
                  </div>
                </div>
              )}
              {segments.length > 0 && (
                <div>
                  <div style={{ fontSize: "11px", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Segments</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {segments.map((s) => (
                      <span key={s} style={{ padding: "4px 10px", borderRadius: "20px", backgroundColor: "rgba(245, 183, 49, 0.1)", color: "var(--amber)", fontSize: "12px", fontWeight: 500 }}>{s}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)", marginBottom: "16px" }}>Custom Properties</h2>
          {propEntries.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px" }}>
              {propEntries.slice(0, 12).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                  <span style={{ color: "var(--text-2)", flexShrink: 0 }}>{k}</span>
                  <span style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: typeof v === "string" ? undefined : "monospace" }}>
                    {Array.isArray(v) ? v.join(", ") || "" : typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </span>
                </div>
              ))}
              {propEntries.length > 12 && (
                <div style={{ color: "var(--text-3)", fontSize: "11px", marginTop: "6px" }}>
                  +{propEntries.length - 12} more properties
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: "var(--text-3)", fontSize: "13px" }}>No custom properties.</div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <Tag size={16} color="var(--accent)" />
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)" }}>Tags</h2>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {tags.length > 0 ? (
              tags.map((tag) => (
                <div
                  key={tag}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    backgroundColor: "var(--border)",
                    borderRadius: "8px",
                    fontSize: "13px",
                    color: "var(--text-2)",
                  }}
                >
                  {tag}
                  <X size={12} color="var(--text-2)" style={{ cursor: "pointer" }} />
                </div>
              ))
            ) : (
              <div style={{ color: "var(--text-3)", fontSize: "13px" }}>No tags.</div>
            )}
          </div>
        </div>

        <div style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <GitBranch size={16} color="var(--accent)" />
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)" }}>Flow History</h2>
          </div>
          <div style={{ color: "var(--text-3)", fontSize: "13px" }}>No flow enrollments yet.</div>
        </div>
      </div>
    </div>
  );
}
