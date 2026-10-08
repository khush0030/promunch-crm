"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake, LayoutGrid, List } from "lucide-react";
import { EmptyState, PageHead, SearchBar, StatusBadge } from "@/components/pm";
import { DealDrawer } from "@/components/deals/DealDrawer";
import DealsBoard from "@/components/deals/DealsBoard";
import {
  ALL_KINDS,
  BUCKET_OF,
  BUCKETS,
  DEFAULT_HIDDEN_KINDS,
  KIND_LABEL,
  KIND_TONE,
  PRIORITY_KIND,
  TEMP_LABEL,
  type Bucket,
} from "@/components/deals/constants";
import { timeAgo } from "@/components/deals/format";
import type { Deal, DealsResponse, DealStage } from "@/components/deals/types";
import css from "@/components/deals/deals.module.css";

const VIEW_KEY = "deals_view_v1";

// Board/list preference in localStorage, read via useSyncExternalStore so the
// server render ("board") hydrates cleanly and then syncs to the stored value.
function subscribeView(cb: () => void) {
  window.addEventListener("deals-view-change", cb);
  return () => window.removeEventListener("deals-view-change", cb);
}
function useStoredView(): ["board" | "list", (v: "board" | "list") => void] {
  const view = useSyncExternalStore(
    subscribeView,
    () => (localStorage.getItem(VIEW_KEY) === "list" ? "list" : "board"),
    () => "board" as const,
  );
  const set = (v: "board" | "list") => {
    localStorage.setItem(VIEW_KEY, v);
    window.dispatchEvent(new Event("deals-view-change"));
  };
  return [view, set];
}

// One row, one deal: temperature dot · company · kind · next step · flag · age.
// HoReCa and flagged deals float to the top of each bucket.
function rank(a: Deal, b: Deal): number {
  if (a.follow_up_needed !== b.follow_up_needed) return a.follow_up_needed ? -1 : 1;
  const pa = a.kind === PRIORITY_KIND ? 0 : 1;
  const pb = b.kind === PRIORITY_KIND ? 0 : 1;
  if (pa !== pb) return pa - pb;
  return (b.last_email_at ?? "").localeCompare(a.last_email_at ?? "");
}

const OPEN_BUCKETS: Bucket[] = ["inquiries", "discussions", "samples"];

const TEMP_DOT: Record<string, string> = {
  hot: "var(--pm-terra)",
  warm: "var(--pm-gold)",
  cool: "var(--pm-blue)",
};

export default function DealsPage() {
  const qc = useQueryClient();
  const [view, switchView] = useStoredView();
  const [bucket, setBucket] = useState<Bucket>("inquiries");
  const [kind, setKind] = useState("all");
  const [onlyFollowUp, setOnlyFollowUp] = useState(false);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["deals"],
    queryFn: async (): Promise<DealsResponse> => {
      const res = await fetch("/api/deals", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "failed to load deals");
      return d;
    },
    refetchInterval: 120_000,
  });

  // Drag-and-drop stage moves: optimistic so the card lands instantly; the
  // PATCH flips manual_stage_override server-side.
  const moveStage = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: DealStage }) => {
      const res = await fetch(`/api/deals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "failed to move deal");
      return d;
    },
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ["deals"] });
      const prev = qc.getQueryData<DealsResponse>(["deals"]);
      qc.setQueryData<DealsResponse>(["deals"], (old) =>
        old
          ? {
              ...old,
              deals: old.deals.map((d) =>
                d.id === id ? { ...d, stage, manual_stage_override: true } : d,
              ),
            }
          : old,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["deals"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["deals"] }),
  });

  const scanNow = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/deals/scan", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "scan failed");
      return d;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["deals"] }),
  });

  const deals = useMemo(() => data?.deals ?? [], [data?.deals]);

  // Kind/search/follow-up filters apply across buckets so the segment counts
  // always reflect what the list below would show.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return deals.filter((d) => {
      if (kind === "all" && (DEFAULT_HIDDEN_KINDS as string[]).includes(d.kind)) return false;
      if (kind !== "all" && d.kind !== kind) return false;
      if (onlyFollowUp && !d.follow_up_needed) return false;
      if (
        needle &&
        ![d.company_name, d.company_domain, d.contact_name, d.contact_email, d.summary, d.next_step]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(needle))
      ) {
        return false;
      }
      return true;
    });
  }, [deals, kind, onlyFollowUp, q]);

  const byBucket = useMemo(() => {
    const m: Record<Bucket, Deal[]> = { inquiries: [], discussions: [], samples: [], orders: [], closed: [] };
    for (const d of filtered) m[BUCKET_OF[d.stage]].push(d);
    (Object.keys(m) as Bucket[]).forEach((k) => m[k].sort(rank));
    return m;
  }, [filtered]);

  // Follow-ups among OPEN deals only (same buckets as the "open" count), so
  // "need follow-up" can never exceed "open". Won/closed deals don't need one.
  const followUps = useMemo(
    () =>
      deals.filter(
        (d) =>
          d.follow_up_needed &&
          !(DEFAULT_HIDDEN_KINDS as string[]).includes(d.kind) &&
          OPEN_BUCKETS.includes(BUCKET_OF[d.stage]),
      ).length,
    [deals],
  );

  const rows = byBucket[bucket];
  const scan = data?.scan;

  return (
    <div className={`pm-page ${css.scope}`}>
      <PageHead
        title="Deals"
        subtitle={
          <>
            {followUps > 0 ? `${followUps} need your attention · ` : ""}
            last scan {scan?.last_run_at ? timeAgo(scan.last_run_at) : "never"}
            {scan && !scan.backfill_done ? " · still reading older mail" : ""}
          </>
        }
        actions={
          <button
            type="button"
            className="pm-btn sm"
            disabled={scanNow.isPending}
            onClick={() => scanNow.mutate()}
          >
            {scanNow.isPending ? "Scanning…" : "Scan now"}
          </button>
        }
      />

      <div className={css.statLine}>
        <div>
          <b>{byBucket.inquiries.length + byBucket.discussions.length + byBucket.samples.length}</b>
          <span>open</span>
        </div>
        <div>
          <b data-tone={followUps > 0 ? "warn" : undefined}>{followUps}</b>
          <span>need follow-up</span>
        </div>
        <div>
          <b>{byBucket.samples.length}</b>
          <span>at samples</span>
        </div>
        <div>
          <b data-tone={byBucket.orders.length > 0 ? "good" : undefined}>{byBucket.orders.length}</b>
          <span>won</span>
        </div>
      </div>

      {(scanNow.error instanceof Error || scan?.last_error) && (
        <p className={css.err}>
          {scanNow.error instanceof Error ? scanNow.error.message : `Last scan error: ${scan?.last_error}`}
        </p>
      )}

      {/* View toggle + segmented buckets (list only) + compact filters, one row */}
      <div className={css.bar}>
        <div className={css.seg}>
          <button type="button" className={css.segBtn} data-on={view === "board"} onClick={() => switchView("board")}>
            <LayoutGrid size={13} />
            Board
          </button>
          <button type="button" className={css.segBtn} data-on={view === "list"} onClick={() => switchView("list")}>
            <List size={13} />
            List
          </button>
        </div>
        {view === "list" && (
          <>
            <div className={css.seg}>
              {BUCKETS.map((b) => (
                <button key={b.key} type="button" className={css.segBtn} data-on={bucket === b.key} onClick={() => setBucket(b.key)}>
                  {b.label} {byBucket[b.key].length > 0 && <span className={css.segN}>{byBucket[b.key].length}</span>}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={css.closedBtn}
              data-on={bucket === "closed"}
              onClick={() => setBucket("closed")}
            >
              Closed {byBucket.closed.length}
            </button>
          </>
        )}
        <span className={css.spacer} />
        <SearchBar value={q} onChange={setQ} placeholder="Search deals…" />
        <select
          value={kind}
          aria-label="Filter by kind"
          onChange={(e) => setKind(e.target.value)}
          className={css.kindSelect}
        >
          <option value="all">All kinds</option>
          {ALL_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`pm-btn sm${onlyFollowUp ? ` ${css.onBtn}` : " ghost"}`}
          aria-pressed={onlyFollowUp}
          onClick={() => setOnlyFollowUp(!onlyFollowUp)}
        >
          Needs follow-up
        </button>
      </div>

      {/* Kanban board */}
      {view === "board" &&
        (isLoading ? (
          <p className={css.hint}>Loading deals…</p>
        ) : error instanceof Error ? (
          <p className={css.err} style={{ padding: 20 }}>{error.message}</p>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Handshake />} title="Nothing here" style={{ marginTop: 14 }}>
            {deals.length === 0
              ? "Hit “Scan now”. The pipeline builds itself from hello@promunch.in."
              : "No deals match the current filters."}
          </EmptyState>
        ) : (
          <>
            <p className={css.hint}>
              Drag a card to move it between stages; the scanner respects manual moves. Drop on
              Closed to mark a deal lost. Click any card for the full story.
            </p>
            <DealsBoard
              deals={[...filtered].sort(rank)}
              onOpen={setOpenId}
              onMove={(id, stage) => moveStage.mutate({ id, stage })}
            />
          </>
        ))}

      {/* The list */}
      {view === "list" && (
      <div className={css.list}>
        {isLoading ? (
          <p className={css.hint} style={{ padding: 20, margin: 0 }}>Loading deals…</p>
        ) : error instanceof Error ? (
          <p className={css.err} style={{ padding: 20 }}>{error.message}</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Handshake />} title="Nothing here" style={{ border: "none" }}>
            {deals.length === 0
              ? "Hit “Scan now”. The pipeline builds itself from hello@promunch.in."
              : "No deals in this lane with the current filters."}
          </EmptyState>
        ) : (
          rows.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setOpenId(d.id)}
              className={`deal-row ${css.row}`}
            >
              <span
                title={d.interest_temp ? `${TEMP_LABEL[d.interest_temp]} lead` : "Not analysed yet"}
                className={css.tempDot}
                style={{ background: d.interest_temp ? TEMP_DOT[d.interest_temp] : "var(--pm-line)" }}
              />
              <span className={css.rowName}>{d.company_name}</span>
              <StatusBadge tone={KIND_TONE[d.kind]}>{KIND_LABEL[d.kind]}</StatusBadge>
              <span className={css.rowNext}>{d.next_step || d.summary || "–"}</span>
              {d.follow_up_needed && <span className={css.followUp}>Follow up</span>}
              <span className={css.rowAge}>{timeAgo(d.last_email_at)}</span>
            </button>
          ))
        )}
      </div>
      )}

      {openId && <DealDrawer dealId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
