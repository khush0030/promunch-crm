"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

type Counts = {
  failedWhatsApp: number;
  highPriorityWaTickets: number;
  urgentEmails: number;
};
type Row = {
  id: string;
  severity: "error" | "warn";
  text: string;
  href: string;
  action: string;
};

// Dashboard "what needs me right now?" card. Sits above the KPI grid and
// renders nothing when there is nothing to action. Degraded integrations are
// intentionally left to <ConnectorBanner /> so the two don't duplicate.
export default function NeedsAttention() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const c: Counts | null = await fetch("/api/needs-attention")
        .then((r) => r.json())
        .catch(() => null);
      if (cancelled || !c) return;

      const next: Row[] = [];
      if (c.failedWhatsApp > 0) {
        next.push({
          id: "wa-failed",
          severity: "error",
          text: `${c.failedWhatsApp} WhatsApp message${c.failedWhatsApp === 1 ? "" : "s"} failed to send in the last 24h`,
          href: "/dashboard/whatsapp",
          action: "Review",
        });
      }
      if (c.highPriorityWaTickets > 0) {
        next.push({
          id: "wa-tickets",
          severity: "warn",
          text: `${c.highPriorityWaTickets} high-priority WhatsApp ticket${c.highPriorityWaTickets === 1 ? "" : "s"} still open`,
          href: "/dashboard/whatsapp",
          action: "Open",
        });
      }
      if (c.urgentEmails > 0) {
        next.push({
          id: "emails",
          severity: "warn",
          text: `${c.urgentEmails} urgent support email${c.urgentEmails === 1 ? "" : "s"} awaiting a reply`,
          href: "/dashboard/support-emails",
          action: "Open",
        });
      }
      setRows(next);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (rows.length === 0) return null;

  return (
    <div className="card card-pad section">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <AlertTriangle size={15} style={{ color: "var(--accent)" }} />
        <div className="card-title">Needs attention</div>
      </div>
      <div className="card-sub">
        {rows.length} item{rows.length === 1 ? "" : "s"} need a human
      </div>
      <div style={{ marginTop: 8 }}>
        {rows.map((r) => (
          <div key={r.id} className="legend-row">
            <div className="legend-l" style={{ minWidth: 0 }}>
              <span
                className="dot"
                style={{
                  background: r.severity === "error" ? "var(--accent)" : "var(--amber)",
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 13, color: "var(--text)" }}>{r.text}</span>
            </div>
            <Link href={r.href} className="btn sm" style={{ flexShrink: 0 }}>
              {r.action} →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
