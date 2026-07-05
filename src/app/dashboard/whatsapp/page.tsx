"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import AnalyticsView from "@/components/whatsapp/AnalyticsView";
import { timeAgo } from "./format";
import type { Tab } from "@/components/whatsapp/types";
import { WA_GREEN } from "@/components/whatsapp/styles";
import TemplatesView from "@/components/whatsapp/TemplatesView";
import KbView from "@/components/whatsapp/KbView";
import CampaignsView from "@/components/whatsapp/CampaignsView";
import FlowsView from "@/components/whatsapp/FlowsView";
import InboxView from "@/components/whatsapp/InboxView";



export default function WhatsAppPage() {
  const [tab, setTab] = useState<Tab>("inbox");

  return (
    <div className="pm-page">
      <Header />
      <StatusMeter />
      <Tabs tab={tab} onChange={setTab} />
      <div>
        {tab === "inbox" && <InboxView ticketsOnly={false} />}
        {tab === "tickets" && <InboxView ticketsOnly={true} />}
        {tab === "templates" && <TemplatesView />}
        {tab === "campaigns" && <CampaignsView />}
        {tab === "flows" && <FlowsView />}
        {tab === "analytics" && <AnalyticsView />}
        {tab === "kb" && <KbView />}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="pm-head">
      <div>
        <h1>WhatsApp</h1>
        <p>Inbox, AI agent, templates &amp; tickets</p>
      </div>
    </div>
  );
}

/* WhatsApp uptime / health meter — polls /api/whatsapp/health every 30s.
   Collapsed to a single status pill above the inbox; click to expand the
   full uptime detail. */
function StatusMeter() {
  const [h, setH] = useState<any>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/whatsapp/health");
      setH(await r.json());
    } catch { /* keep last good reading */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const status: string = h?.status ?? "unknown";
  const dot = status === "up" ? WA_GREEN : status === "down" ? "var(--pm-terra)" : "var(--pm-hint)";
  const failed: number = h?.failedOutbound24h ?? 0;
  const statusLabel = status === "up" ? "Operational" : status === "down" ? "Down" : "Unknown";

  const cells: Array<{ label: string; value: string; color?: string; dot?: boolean }> = [
    { label: "Cloud API", dot: true, color: dot,
      value: statusLabel },
    { label: "Uptime 24h", value: h?.uptime24h != null ? `${h.uptime24h}%` : "—" },
    { label: "Uptime 7d", value: h?.uptime7d != null ? `${h.uptime7d}%` : "—" },
    { label: "Last message in", value: timeAgo(h?.lastInboundAt ?? null) },
    { label: "Outbound 24h", value: failed > 0 ? `${failed} failed` : "OK",
      color: failed > 0 ? "var(--pm-terra)" : WA_GREEN },
    { label: "AI replies 24h", value: String(h?.aiReplies24h ?? 0) },
  ];

  return (
    <div style={{ margin: "2px 0 14px" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={open ? "Hide health detail" : "Show health detail"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "var(--pm-card)", border: "1px solid var(--pm-border)",
          borderRadius: 999, padding: "6px 13px", fontSize: 13, fontWeight: 600,
          color: "var(--pm-ink)", cursor: "pointer",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: dot, display: "inline-block" }} />
        WhatsApp · {statusLabel}
        {failed > 0 && (
          <span style={{ color: "var(--pm-terra)", fontWeight: 600 }}>· {failed} failed</span>
        )}
        <ChevronDown
          size={13}
          style={{
            color: "var(--pm-hint)", transition: "transform .15s",
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </button>
      {open && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {cells.map((c) => (
            <div key={c.label} style={{
              flex: "1 1 120px", background: "var(--pm-card)", border: "1px solid var(--pm-border)",
              borderRadius: 10, padding: "9px 12px",
            }}>
              <div style={{ fontSize: 11, color: "var(--pm-hint)", marginBottom: 3, display: "flex", alignItems: "center", gap: 5 }}>
                {c.dot && <span style={{ width: 8, height: 8, borderRadius: 999, background: dot, display: "inline-block" }} />}
                {c.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: c.color ?? "var(--pm-ink)" }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const items: Array<{ key: Tab; label: string }> = [
    { key: "inbox", label: "Inbox" },
    { key: "tickets", label: "Tickets" },
    { key: "templates", label: "Templates" },
    { key: "campaigns", label: "Campaigns" },
    { key: "flows", label: "Flows" },
    { key: "analytics", label: "Analytics" },
    { key: "kb", label: "Knowledge Base" },
  ];
  return (
    <div className="pm-tabs">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`pm-tab${tab === it.key ? " on" : ""}`}
          onClick={() => onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
