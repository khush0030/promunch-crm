"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";

type NitroEvent = {
  id: string;
  event_name: string;
  nitro_user_id: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_name: string | null;
  cart_value_cents: number | null;
  order_id: number | null;
  order_number: number | null;
  page_url: string | null;
  payload: unknown;
  event_ts: string | null;
  received_at: string;
};

const WEBHOOK_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/functions/v1/nitro-webhook`;

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const inr = (cents: number) => `₹${(cents / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// Order events get a green badge, cart/checkout amber, everything else neutral.
function eventCls(name: string): string {
  if (name.startsWith("orders/")) return "green";
  if (name === "checkout" || name === "addtocart") return "amber";
  if (name === "removefromcart") return "accent";
  return "blue";
}

export default function NitroWebhookPage() {
  const [events, setEvents] = useState<NitroEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [last24h, setLast24h] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const since = new Date(Date.now() - 86400_000).toISOString();
      const [recentRes, totalRes, dayRes] = await Promise.all([
        supabase
          .from("nitro_events")
          .select(
            "id, event_name, nitro_user_id, customer_phone, customer_email, customer_name, cart_value_cents, order_id, order_number, page_url, payload, event_ts, received_at"
          )
          .order("received_at", { ascending: false })
          .limit(100),
        supabase.from("nitro_events").select("id", { count: "exact", head: true }),
        supabase
          .from("nitro_events")
          .select("id", { count: "exact", head: true })
          .gte("received_at", since),
      ]);
      setEvents((recentRes.data as NitroEvent[]) || []);
      setTotal(totalRes.count || 0);
      setLast24h(dayRes.count || 0);
      setLoaded(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const lastEvent = events[0] ?? null;
  const fresh = lastEvent ? Date.now() - new Date(lastEvent.received_at).getTime() < 86400_000 : false;
  const status: { cls: string; label: string } =
    total === 0
      ? { cls: "grey", label: "No events yet" }
      : fresh
      ? { cls: "green", label: "Live" }
      : { cls: "amber", label: "No recent events" };

  // Event-type breakdown over the loaded window.
  const byType = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.event_name] = (acc[e.event_name] || 0) + 1;
    return acc;
  }, {});
  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]);

  const shown = filter ? events.filter((e) => e.event_name === filter) : events;

  if (!loaded) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1>Nitro Webhook</h1>
            <div className="sub">Loading…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Nitro Webhook</h1>
          <div className="sub">
            NitroCommerce event stream ·{" "}
            <span className={`pill ${status.cls}`}>{status.label}</span>
          </div>
        </div>
        <button type="button" className="btn" onClick={load} disabled={refreshing} aria-label="Refresh">
          <RefreshCw size={14} /> {refreshing ? "Syncing…" : "Refresh"}
        </button>
      </div>

      {/* Health KPIs */}
      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">Total events received</div>
          <div className="value">{total.toLocaleString("en-IN")}</div>
          <div className="delta flat">All time</div>
        </div>
        <div className="kpi">
          <div className="label">Events · last 24h</div>
          <div className="value">{last24h.toLocaleString("en-IN")}</div>
          <div className={`delta ${last24h > 0 ? "up" : "flat"}`}>
            {last24h > 0 ? "Connection active" : "Nothing in 24h"}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Last event</div>
          <div className="value">{lastEvent ? timeAgo(lastEvent.received_at) : "—"}</div>
          <div className="delta flat">{lastEvent ? lastEvent.event_name : "No events"}</div>
        </div>
      </div>

      {/* Endpoint info */}
      <div className="card card-pad section" style={{ marginTop: 16 }}>
        <div className="card-title">Webhook endpoint</div>
        <div className="card-sub">Where NitroCommerce posts data into the CRM</div>
        <div
          style={{
            marginTop: 12,
            fontFamily: "monospace",
            fontSize: 12.5,
            background: "var(--hover-2)",
            padding: "10px 12px",
            borderRadius: 8,
            wordBreak: "break-all",
          }}
        >
          POST {WEBHOOK_URL}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Auth: <code>Authorization</code> header must match <code>NITRO_AUTH_TOKEN</code>. Body
          must carry the matching <code>org_token</code>. On success the endpoint responds{" "}
          <code>200 {`{ ok: true }`}</code>; bad auth returns <code>401</code>.
        </div>
      </div>

      {/* Event-type breakdown / filter */}
      {types.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <div className="card-title">Event types</div>
          <div className="card-sub">Last {events.length} events · click to filter</div>
          <div className="chips" style={{ marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              className={`chip${filter === "" ? " active" : ""}`}
              onClick={() => setFilter("")}
            >
              All ({events.length})
            </button>
            {types.map(([name, n]) => (
              <button
                key={name}
                type="button"
                className={`chip${filter === name ? " active" : ""}`}
                onClick={() => setFilter(name)}
              >
                {name} ({n})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Event feed */}
      <div className="card card-pad" style={{ marginTop: 16 }}>
        <div className="card-title">Recent events</div>
        <div className="card-sub">
          Newest first · expand a row to see the raw payload received from Nitro
        </div>
        {shown.length === 0 ? (
          <div className="muted" style={{ marginTop: 16, fontSize: 13 }}>
            {total === 0
              ? "No events received yet. Once NitroCommerce starts posting, events appear here."
              : "No events match this filter."}
          </div>
        ) : (
          <table className="tbl" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Time</th>
                <th>Event</th>
                <th>Customer</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const isOpen = expanded.has(e.id);
                const details: string[] = [];
                if (e.order_number) details.push(`Order #${e.order_number}`);
                else if (e.order_id) details.push(`Order ${e.order_id}`);
                if (e.cart_value_cents) details.push(`Cart ${inr(e.cart_value_cents)}`);
                if (e.page_url) details.push(e.page_url);
                return (
                  <Fragment key={e.id}>
                    <tr onClick={() => toggle(e.id)} style={{ cursor: "pointer" }}>
                      <td>
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td title={fullTime(e.received_at)}>{timeAgo(e.received_at)}</td>
                      <td>
                        <span className={`pill ${eventCls(e.event_name)}`}>{e.event_name}</span>
                      </td>
                      <td>
                        <div className="cell-main">
                          <span className="nm">
                            {e.customer_name || e.customer_email || e.customer_phone || "—"}
                          </span>
                          {(e.customer_email || e.customer_phone) && e.customer_name && (
                            <span className="muted" style={{ fontSize: 12 }}>
                              {e.customer_email || e.customer_phone}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="muted" style={{ fontSize: 12.5 }}>
                        {details.join(" · ") || "—"}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td />
                        <td colSpan={4}>
                          <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
                            Raw payload received from Nitro · {fullTime(e.received_at)}
                            {e.nitro_user_id ? ` · user ${e.nitro_user_id}` : ""}
                          </div>
                          <pre
                            style={{
                              background: "var(--hover-2)",
                              padding: 12,
                              borderRadius: 8,
                              fontSize: 11.5,
                              maxHeight: 320,
                              overflow: "auto",
                              margin: 0,
                            }}
                          >
                            {JSON.stringify(e.payload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
