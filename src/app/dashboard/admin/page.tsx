"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageHead, Tabs, DataTable, StatusBadge, Panel, type Column } from "@/components/pm";
import { apiFetch, ApiError } from "@/lib/api-fetch";
import { MODULES } from "@/lib/access";
import ActivityLog from "@/components/admin/ActivityLog";
import { ago, fmtTime } from "@/components/admin/format";

type Person = {
  id: string;
  email: string | null;
  name: string;
  role: string;
  admin: boolean;
  modules: string[] | null;
  confirmed: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  last_active_at: string | null;
  last_ip: string | null;
  last_device: string | null;
  active_sessions: number;
  logins_30d: number;
  distinct_ips_30d: number;
};
type Session = {
  id: string;
  email: string | null;
  created_at: string;
  last_active_at: string | null;
  ip: string | null;
  device: string;
  not_after: string | null;
};
type Security = { users: Person[]; sessions: Session[]; sessionsAvailable: boolean };

const TABS = [
  { key: "people", label: "People" },
  { key: "sessions", label: "Live sessions" },
  { key: "activity", label: "Activity log" },
];
const ROLE_TONE: Record<string, "terra" | "gold" | "blue"> = { owner: "terra", admin: "gold", agent: "blue" };

function accessText(p: Person): string {
  if (p.admin) return "Everything";
  if (p.modules === null) return "All areas";
  if (!p.modules.length) return "No areas";
  return MODULES.filter((m) => p.modules!.includes(m.key)).map((m) => m.label).join(", ");
}

const small = { fontSize: 12, color: "var(--pm-hint)" } as const;

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="pm-page" />}>
      <AdminInner />
    </Suspense>
  );
}

// Admin → who is on the team, when they last signed in / were active, from
// which IP and device, live sessions, and the full activity log. Owners and
// admins only (the APIs return 403 to everyone else).
function AdminInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab")! : "people";

  const q = useQuery({
    queryKey: ["admin-security"],
    queryFn: () => apiFetch<Security>("/api/admin/security"),
    refetchInterval: 60000,
  });

  if (q.error instanceof ApiError && q.error.status === 403) {
    return (
      <div className="pm-page">
        <PageHead title="Admin" subtitle="Security and activity for the whole team." />
        <Panel title="Admins only">
          <p className="pm-muted">Only owners and admins can see sign-ins, IP addresses and the activity log.</p>
        </Panel>
      </div>
    );
  }

  const data = q.data;
  const people = data?.users ?? [];

  const peopleCols: Column<Person>[] = [
    {
      header: "Member",
      cell: (p) => (
        <div>
          <div className="pm-b7">{p.name}</div>
          <div style={small}>{p.email}</div>
        </div>
      ),
    },
    {
      header: "Role & access",
      cell: (p) => (
        <div>
          <StatusBadge tone={ROLE_TONE[p.role] ?? "blue"}>{p.role[0].toUpperCase() + p.role.slice(1)}</StatusBadge>
          <div style={{ ...small, marginTop: 4, maxWidth: 240 }}>{accessText(p)}</div>
        </div>
      ),
    },
    {
      header: "Last sign-in",
      cell: (p) =>
        p.confirmed || p.last_sign_in_at ? (
          <div>
            <div>{ago(p.last_sign_in_at)}</div>
            <div style={small}>{fmtTime(p.last_sign_in_at)}</div>
          </div>
        ) : (
          <StatusBadge tone="gold">Invite not accepted</StatusBadge>
        ),
    },
    {
      header: "Last active",
      cell: (p) => (
        <div>
          <div>{ago(p.last_active_at)}</div>
          <div style={small}>{fmtTime(p.last_active_at)}</div>
        </div>
      ),
    },
    {
      header: "Last IP · device",
      cell: (p) => (
        <div>
          <div style={{ fontFamily: "var(--pm-mono, monospace)", fontSize: 13 }}>{p.last_ip ?? "—"}</div>
          <div style={small}>{p.last_device ?? "—"}</div>
        </div>
      ),
    },
    {
      header: "Sessions",
      cell: (p) => (
        <div>
          <div>{p.active_sessions} live</div>
          <div style={small}>
            {p.logins_30d} sign-ins / 30d
            {p.distinct_ips_30d > 1 ? ` · ${p.distinct_ips_30d} IPs` : ""}
          </div>
        </div>
      ),
    },
  ];

  const sessionCols: Column<Session>[] = [
    { header: "Who", cell: (s) => s.email ?? "—" },
    { header: "Signed in", cell: (s) => fmtTime(s.created_at) },
    { header: "Last active", cell: (s) => <span title={fmtTime(s.last_active_at)}>{ago(s.last_active_at)}</span> },
    { header: "IP", cell: (s) => <span style={{ fontFamily: "var(--pm-mono, monospace)", fontSize: 13 }}>{s.ip ?? "—"}</span> },
    { header: "Device", cell: (s) => s.device },
  ];

  const empty = (what: string) =>
    q.isLoading ? "Loading…"
    : q.isError ? (
      <span>
        Couldn’t load {what}.{" "}
        <button className="pm-btn ghost sm" style={{ marginLeft: 8 }} onClick={() => q.refetch()}>Retry</button>
      </span>
    )
    : `No ${what} yet.`;

  return (
    <div className="pm-page">
      <PageHead title="Admin" subtitle="Who is on the team, when they signed in, from where, and everything they changed." />
      <Tabs tabs={TABS} active={tab} onSelect={(t) => router.replace(`/dashboard/admin${t === "people" ? "" : `?tab=${t}`}`)} />

      {data && !data.sessionsAvailable && tab !== "activity" && (
        <p className="pm-muted" style={{ margin: "4px 0 12px", fontSize: 13 }}>
          Live sessions and sign-in history switch on once database migration 015 is applied. Last sign-in times below are already live.
        </p>
      )}

      {tab === "people" && <DataTable columns={peopleCols} rows={people} rowKey={(p) => p.id} empty={empty("team members")} />}
      {tab === "sessions" && (
        <DataTable columns={sessionCols} rows={data?.sessions ?? []} rowKey={(s) => s.id} empty={empty("live sessions")} />
      )}
      {tab === "activity" && <ActivityLog people={people.map((p) => p.email).filter((e): e is string => !!e)} />}
    </div>
  );
}
