"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHead, DataTable, type Column } from "@/components/pm";

type AuditEntry = {
  id: string;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

export default function AuditLogPage() {
  const [action, setAction] = useState("");

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["audit-log", action],
    queryFn: async (): Promise<AuditEntry[]> => {
      const qs = action ? `?action=${encodeURIComponent(action)}` : "";
      const r = await fetch(`/api/audit${qs}`);
      const j = await r.json();
      return j.entries ?? [];
    },
    refetchInterval: 30000,
  });

  // Build the action filter from what's actually present.
  const actions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.action))).sort(),
    [entries],
  );

  const columns: Column<AuditEntry>[] = [
    { header: "When", width: "160px", cell: (e) => <span style={{ color: "var(--pm-muted)", fontSize: 13 }}>{fmtTime(e.created_at)}</span> },
    { header: "Who", width: "200px", cell: (e) => e.actor_email ?? <span style={{ color: "var(--pm-hint)" }}>system</span> },
    { header: "Action", width: "160px", cell: (e) => <code style={{ fontSize: 12 }}>{e.action}</code> },
    { header: "Details", cell: (e) => e.summary ?? `${e.entity_type ?? ""} ${e.entity_id ?? ""}`.trim() },
    { header: "IP", width: "130px", cell: (e) => <span style={{ color: "var(--pm-hint)", fontSize: 12 }}>{e.ip ?? "—"}</span> },
  ];

  return (
    <div className="pm-page">
      <PageHead
        title="Audit log"
        subtitle="A record of destructive and sensitive actions — who did what, when."
        actions={
          <select
            aria-label="Filter by action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            style={{
              padding: "8px 10px", border: "1px solid var(--pm-border)", borderRadius: 8,
              fontSize: 13, background: "var(--pm-card)", color: "var(--pm-ink)",
            }}
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        }
      />
      <DataTable
        columns={columns}
        rows={entries}
        rowKey={(e) => e.id}
        empty={isLoading ? "Loading…" : "No audit entries yet."}
      />
    </div>
  );
}
