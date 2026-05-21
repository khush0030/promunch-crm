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
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled) setHealth(d);
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

  const broken = health.connectors.filter(
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
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <AlertTriangle size={18} style={{ color, flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color, fontSize: 13.5 }}>
          {isDown
            ? `${broken.length} integration${broken.length === 1 ? "" : "s"} need attention`
            : `${broken.length} integration${broken.length === 1 ? "" : "s"} degraded`}
        </div>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--text-2)" }}>
          {broken.map((c) => (
            <li key={c.id} style={{ marginTop: 2 }}>
              <b>{c.label}:</b> {c.headline}
            </li>
          ))}
        </ul>
      </div>
      <Link
        href="/dashboard/integrations"
        style={{
          flexShrink: 0,
          fontSize: 12.5,
          fontWeight: 600,
          color,
          alignSelf: "center",
          whiteSpace: "nowrap",
        }}
      >
        View details →
      </Link>
    </div>
  );
}
