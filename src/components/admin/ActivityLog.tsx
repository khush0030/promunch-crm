"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import { describeDevice } from "@/lib/device";
import { fmtTime } from "./format";
import css from "./admin.module.css";

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

  const details = (e: AuditEntry) => {
    const ua = typeof e.metadata?.user_agent === "string" ? e.metadata.user_agent : null;
    const base = e.summary ?? `${e.entity_type ?? ""} ${e.entity_id ?? ""}`.trim();
    return e.action.startsWith("auth.") ? `${base} · ${describeDevice(ua)}` : base;
  };

  return (
    <>
      <div className={css.filters}>
        <select aria-label="Filter by type" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <select aria-label="Filter by person" value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">Everyone</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className={css.card}>
        {entries.length === 0 ? (
          <div className={css.empty}>
            {q.isLoading ? "Loading…"
            : q.isError ? (
              <>
                Couldn’t load the activity log.
                <button type="button" className="pm2-btn ghost sm" onClick={() => q.refetch()}>Retry</button>
              </>
            )
            : "Nothing recorded yet."}
          </div>
        ) : (
          <ol className={css.tl}>
            {entries.map((e) => (
              <li key={e.id} className={`${css.it}${e.action.startsWith("auth.") ? ` ${css.itAuth}` : ""}`}>
                <b>{details(e) || e.action}</b>
                <span>
                  {e.actor_email ?? "system"} · {fmtTime(e.created_at)}
                  {e.ip ? ` · ${e.ip}` : ""} · <code>{e.action}</code>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {q.hasNextPage && (
        <div className={css.more}>
          <button type="button" className="pm2-btn sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? "Loading…" : "Load older"}
          </button>
        </div>
      )}
    </>
  );
}
