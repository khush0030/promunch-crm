"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Avatar } from "@/components/pm";
import { apiFetch, ApiError } from "@/lib/api-fetch";
import { MODULES } from "@/lib/access";
import ActivityLog from "@/components/admin/ActivityLog";
import { ago, fmtTime } from "@/components/admin/format";
import css from "@/components/admin/admin.module.css";

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
  { key: "sessions", label: "Signed in now" },
  { key: "activity", label: "Activity log" },
];

function accessText(p: Person): string {
  if (p.admin) return "Everything";
  if (p.modules === null) return "All areas";
  if (!p.modules.length) return "No areas";
  return MODULES.filter((m) => p.modules!.includes(m.key)).map((m) => m.label).join(", ");
}

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

  const onTab = (t: string) => router.replace(`/dashboard/admin${t === "people" ? "" : `?tab=${t}`}`);

  if (q.error instanceof ApiError && q.error.status === 403) {
    return (
      <>
        <PageHeader crumb="Settings · admins only" title="Security" summary="Who signed in, from where, and what they changed." />
        <div className="pm2-body">
          <div className={css.card}>
            <div className={css.empty}>Only owners and admins can see sign-ins, IP addresses and the activity log.</div>
          </div>
        </div>
      </>
    );
  }

  const data = q.data;
  const people = data?.users ?? [];
  const sessions = data?.sessions ?? [];
  const nameByEmail = new Map(people.filter((p) => p.email).map((p) => [p.email!, p.name]));

  const empty = (what: string) => (
    <div className={css.empty}>
      {q.isLoading ? "Loading…"
      : q.isError ? (
        <>
          Couldn’t load {what}.
          <button type="button" className="pm2-btn ghost sm" onClick={() => q.refetch()}>Retry</button>
        </>
      )
      : `No ${what} yet.`}
    </div>
  );

  return (
    <>
      <PageHeader
        crumb="Settings · admins only"
        title="Security"
        summary={
          <>
            Who signed in, from where, and what they changed.
            {data?.sessionsAvailable ? <> <b>{sessions.length} signed in now.</b></> : null}
          </>
        }
        tabs={TABS}
        activeTab={tab}
        onTab={onTab}
      />
      <div className="pm2-body">
        <div>

          {data && !data.sessionsAvailable && tab !== "activity" && (
            <p className={css.note}>
              Live sessions and sign-in history switch on once database migration 015 is applied. Last sign-in times below are already live.
            </p>
          )}

          {tab === "people" && (
            <div className={css.card}>
              {people.length === 0 ? empty("team members") : (
                <>
                  <div className={`${css.thead} ${css.people}`}>
                    <span>Person</span><span>Last active</span><span>Last IP · device</span><span>Sessions</span>
                  </div>
                  {people.map((p) => (
                    <div key={p.id} className={`${css.row} ${css.people}`}>
                      <div className={css.who}>
                        <Avatar name={p.name} size={34} />
                        <div className={css.cell}>
                          <span className={css.name}>
                            {p.name}
                            <span className={css.role}>{p.role[0].toUpperCase() + p.role.slice(1)}</span>
                          </span>
                          <span className={css.sub}>{p.email}</span>
                          <span className={css.sub}>{accessText(p)}</span>
                        </div>
                      </div>
                      <div className={css.cell} data-l="Last active">
                        <span title={fmtTime(p.last_active_at)}>{ago(p.last_active_at)}</span>
                        {p.confirmed || p.last_sign_in_at ? (
                          <span className={css.sub}>Signed in {fmtTime(p.last_sign_in_at)}</span>
                        ) : (
                          <span className={`${css.st} ${css.warn}`}>Invite not accepted</span>
                        )}
                      </div>
                      <div className={css.cell} data-l="IP · device">
                        <span className={css.mono}>{p.last_ip ?? "—"}</span>
                        <span className={css.sub}>{p.last_device ?? "—"}</span>
                      </div>
                      <div className={css.cell} data-l="Sessions">
                        {p.active_sessions > 0 ? <span className={`${css.st} ${css.live}`}>{p.active_sessions} live</span> : <span>None live</span>}
                        <span className={css.sub}>
                          {p.logins_30d} sign-ins / 30d
                          {p.distinct_ips_30d > 1 ? ` · ${p.distinct_ips_30d} IPs` : ""}
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {tab === "sessions" && (
            <div className={css.card}>
              {sessions.length === 0 ? empty("live sessions") : (
                <>
                  <div className={`${css.thead} ${css.sess}`}>
                    <span>Person</span><span>Device</span><span>Where (IP)</span><span>Last active</span>
                  </div>
                  {sessions.map((s) => (
                    <div key={s.id} className={`${css.row} ${css.sess}`}>
                      <div className={css.cell}>
                        <span className={css.name}>{(s.email && nameByEmail.get(s.email)) || s.email || "—"}</span>
                        <span className={css.sub}>{s.email && nameByEmail.get(s.email) ? s.email : `Signed in ${fmtTime(s.created_at)}`}</span>
                      </div>
                      <div className={css.cell} data-l="Device"><span>{s.device}</span></div>
                      <div className={css.cell} data-l="Where"><span className={css.mono}>{s.ip ?? "—"}</span></div>
                      <div className={css.cell} data-l="Last active">
                        <span title={fmtTime(s.last_active_at)}>{ago(s.last_active_at)}</span>
                        <span className={css.sub}>Signed in {fmtTime(s.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {tab === "activity" && <ActivityLog people={people.map((p) => p.email).filter((e): e is string => !!e)} />}
        </div>
      </div>
    </>
  );
}
