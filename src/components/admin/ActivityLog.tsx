"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { DataTable, type Column } from "@/components/pm";
import { apiFetch } from "@/lib/api-fetch";
import { describeDevice } from "@/lib/device";
import { fmtTime } from "./format";

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

const KINDS = [
  { value: "", label: "Everything" },
  { value: "auth.login", label: "Sign-ins" },
  { value: "auth.", label: "Sign-ins & sign-outs" },
  { value: "team.", label: "Team & access changes" },
];

const PAGE = 200;
const selectStyle = {
  padding: "8px 10px", border: "1px solid var(--pm-border)", borderRadius: 8,
  fontSize: 13, background: "var(--pm-card)", color: "var(--pm-ink)",
} as const;

// Full audit trail: sign-ins (from the auth.sessions trigger) plus every
// sensitive action recorded by recordAudit(). Admin-only API.
export default function ActivityLog({ people }: { people: string[] }) {
  const [kind, setKind] = useState("");
  const [actor, setActor] = useState("");

  const q = useInfiniteQuery({
    queryKey: ["audit-log", kind, actor],
    initialPageParam: "",
    queryFn: async ({ pageParam }): Promise<AuditEntry[]> => {
      const qs = new URLSearchParams({ limit: String(PAGE) });
      if (kind) qs.set("action", kind);
      if (actor) qs.set("actor", actor);
      if (pageParam) qs.set("before", pageParam);
      const j = await apiFetch<{ entries?: AuditEntry[] }>(`/api/audit?${qs}`);
      return j.entries ?? [];
    },
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].created_at : undefined),
    refetchInterval: 30000,
  });
  const entries = useMemo(() => q.data?.pages.flat() ?? [], [q.data]);

  const columns: Column<AuditEntry>[] = [
    { header: "When", width: "150px", cell: (e) => <span className="pm-dim" style={{ fontSize: 13 }}>{fmtTime(e.created_at)}</span> },
    { header: "Who", width: "210px", cell: (e) => e.actor_email ?? <span style={{ color: "var(--pm-hint)" }}>system</span> },
    { header: "Action", width: "150px", cell: (e) => <code style={{ fontSize: 12 }}>{e.action}</code> },
    {
      header: "Details",
      cell: (e) => {
        const ua = typeof e.metadata?.user_agent === "string" ? e.metadata.user_agent : null;
        const base = e.summary ?? `${e.entity_type ?? ""} ${e.entity_id ?? ""}`.trim();
        return e.action.startsWith("auth.") ? `${base} · ${describeDevice(ua)}` : base;
      },
    },
    { header: "IP", width: "140px", cell: (e) => <span style={{ color: "var(--pm-hint)", fontSize: 12 }}>{e.ip ?? "—"}</span> },
  ];

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "4px 0 12px" }}>
        <select aria-label="Filter by type" value={kind} onChange={(e) => setKind(e.target.value)} style={selectStyle}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <select aria-label="Filter by person" value={actor} onChange={(e) => setActor(e.target.value)} style={selectStyle}>
          <option value="">Everyone</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <DataTable
        columns={columns}
        rows={entries}
        rowKey={(e) => e.id}
        empty={
          q.isLoading ? "Loading…"
          : q.isError ? (
            <span>
              Couldn’t load the activity log.{" "}
              <button className="pm-btn ghost sm" style={{ marginLeft: 8 }} onClick={() => q.refetch()}>Retry</button>
            </span>
          )
          : "Nothing recorded yet."
        }
      />
      {q.hasNextPage && (
        <div style={{ marginTop: 12 }}>
          <button className="pm-btn ghost sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? "Loading…" : "Load older"}
          </button>
        </div>
      )}
    </>
  );
}
