"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

type Status = "healthy" | "degraded" | "down" | "unknown";
type Connector = { id: string; label: string; status: Status; headline: string };
type Health = { overall: Status; connectors: Connector[] };

// Shows a banner whenever an integration is down or degraded. Rendered on the
// Dashboard and the Integrations page. Renders nothing when everything is fine.
export default function ConnectorBanner() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/integrations")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d) => {
          // Shape gate: a 401/error payload has no connectors array; never let
          // it into state (health.connectors.filter would throw on render).
          if (!cancelled && d && Array.isArray(d.connectors)) setHealth(d);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000); // refresh every minute
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!health || health.overall === "healthy" || health.overall === "unknown") return null;

  const broken = (health.connectors ?? []).filter(
    (c) => c.status === "down" || c.status === "degraded",
  );
  if (broken.length === 0) return null;

  const isDown = health.overall === "down";
  const color = isDown ? "var(--accent)" : "var(--amber)";
  const bg = isDown ? "var(--accent-soft)" : "var(--amber-soft)";

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${color}`,
        borderRadius: 12,
        padding: "12px 16px",
        marginBottom: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
        <AlertTriangle size={16} style={{ color, flexShrink: 0 }} />
        <div style={{ fontWeight: 600, color, fontSize: 13.5 }}>
          {isDown
            ? `${broken.length} integration${broken.length === 1 ? "" : "s"} need attention`
            : `${broken.length} integration${broken.length === 1 ? "" : "s"} degraded`}
        </div>
      </div>
      {/* One row per broken connector, each with its own Fix action. */}
      {broken.map((c, i) => (
        <div
          key={c.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "7px 0",
            borderTop: i === 0 ? "none" : `1px solid ${color}33`,
          }}
        >
          <span
            className="dot"
            style={{
              background: c.status === "down" ? "var(--accent)" : "var(--amber)",
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text-2)" }}>
            <b style={{ color: "var(--text)" }}>{c.label}:</b> {c.headline}
          </div>
          <Link
            href="/dashboard/integrations"
            className="btn sm"
            style={{ flexShrink: 0 }}
          >
            Fix →
          </Link>
        </div>
      ))}
    </div>
  );
}
