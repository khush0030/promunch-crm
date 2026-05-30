"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Play } from "lucide-react";
import ConnectorBanner from "@/components/ConnectorBanner";
import { useToast } from "@/components/ui/Toast";

type Status = "healthy" | "degraded" | "down" | "unknown";

type Connector = {
  id: string;
  label: string;
  description: string;
  status: Status;
  headline: string;
  lastError: { message: string | null; at: string } | null;
  lastEventAt: string | null;
  metrics: { label: string; value: string }[];
};

type ConnectorEvent = {
  id: string;
  connector: string;
  level: "info" | "warn" | "error";
  event: string;
  message: string | null;
  created_at: string;
};

type Health = {
  generatedAt: string;
  overall: Status;
  connectors: Connector[];
  events: ConnectorEvent[];
};

const STATUS_META: Record<Status, { pill: string; label: string; dot: string }> = {
  healthy: { pill: "green", label: "Healthy", dot: "var(--green)" },
  degraded: { pill: "amber", label: "Degraded", dot: "var(--amber)" },
  down: { pill: "accent", label: "Down", dot: "var(--accent)" },
  unknown: { pill: "grey", label: "No data yet", dot: "var(--text-3)" },
};

const CONNECTOR_LABEL: Record<string, string> = {
  gmail_pipeline: "Email intake",
  gmail_watch: "Gmail watch",
  anthropic: "AI drafting",
  email_slack: "Email → Slack",
  shopify_slack: "Shopify → Slack",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function IntegrationsPage() {
  const toast = useToast();
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations", { cache: "no-store" });
      const data = await res.json();
      setHealth(data);
    } catch {
      toast.push({ kind: "error", text: "Could not load integration status." });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function runPoll() {
    setPolling(true);
    try {
      const res = await fetch("/api/integrations/poll", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "poll failed");
      toast.push({
        kind: "success",
        text: `Intake run complete — ${data.processed ?? 0} processed, ${data.skipped ?? 0} skipped.`,
      });
      await load();
    } catch (e) {
      toast.push({
        kind: "error",
        text: `Intake run failed: ${e instanceof Error ? e.message : "unknown"}`,
      });
    } finally {
      setPolling(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Integrations</h1>
          <div className="sub">
            Live connection status &amp; error log for the Slack channels
            {health ? ` · checked ${timeAgo(health.generatedAt)}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="button" className="btn" onClick={runPoll} disabled={polling}>
            <Play size={14} /> {polling ? "Running…" : "Run intake & retry now"}
          </button>
          <button type="button" className="btn" onClick={load} aria-label="Refresh">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <ConnectorBanner />

      {loading && !health ? (
        <div className="card card-pad muted">Loading connection status…</div>
      ) : !health ? (
        <div className="card card-pad muted">No status available.</div>
      ) : (
        <>
          <div className="grid-2 section">
            {health.connectors.map((c) => {
              const meta = STATUS_META[c.status];
              return (
                <div key={c.id} className="card card-pad">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      className="dot"
                      style={{ background: meta.dot, width: 10, height: 10, borderRadius: 999 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div className="card-title">{c.label}</div>
                      <div className="card-sub">{c.description}</div>
                    </div>
                    <span className={`pill ${meta.pill}`}>{meta.label}</span>
                  </div>

                  <div
                    style={{
                      marginTop: 12,
                      fontSize: 13,
                      color:
                        c.status === "down"
                          ? "var(--accent)"
                          : c.status === "degraded"
                          ? "var(--amber)"
                          : "var(--text-2)",
                    }}
                  >
                    {c.headline}
                  </div>

                  <div className="meta-grid" style={{ marginTop: 14 }}>
                    {c.metrics.map((m) => (
                      <div key={m.label}>
                        <div className="k">{m.label}</div>
                        <div className="v">{m.value}</div>
                      </div>
                    ))}
                    <div>
                      <div className="k">Last activity</div>
                      <div className="v muted">{timeAgo(c.lastEventAt)}</div>
                    </div>
                  </div>

                  {c.lastError && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: "8px 10px",
                        background: "var(--accent-soft)",
                        border: "1px solid var(--accent)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--accent)",
                      }}
                    >
                      <b>Last error · {timeAgo(c.lastError.at)}</b>
                      <div style={{ marginTop: 2, color: "var(--text-2)" }}>
                        {c.lastError.message}
                      </div>
                    </div>
                  )}

                  {c.id === "gmail_pipeline" && c.status !== "healthy" && (
                    <a
                      href="/api/integrations/gmail/reauth"
                      target="_blank"
                      rel="noopener"
                      style={{
                        marginTop: 12,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 14px",
                        borderRadius: 8,
                        background: "var(--accent)",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 600,
                        textDecoration: "none",
                        minHeight: 36,
                      }}
                    >
                      Re-auth Gmail
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          <div className="card card-pad section">
            <div className="card-title">Connector event log</div>
            <div className="card-sub">
              Most recent {health.events.length} connector events (last 7 days)
            </div>
            {health.events.length === 0 ? (
              <div className="muted" style={{ marginTop: 14, fontSize: 13 }}>
                No connector events logged yet. They appear here as emails and
                orders flow through.
              </div>
            ) : (
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Connector</th>
                    <th>Level</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {health.events.map((e) => (
                    <tr key={e.id}>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>
                        {timeAgo(e.created_at)}
                      </td>
                      <td>{CONNECTOR_LABEL[e.connector] ?? e.connector}</td>
                      <td>
                        <span
                          className={`pill ${
                            e.level === "error"
                              ? "accent"
                              : e.level === "warn"
                              ? "amber"
                              : "green"
                          }`}
                        >
                          {e.level}
                        </span>
                      </td>
                      <td>{e.message || e.event}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
