"use client";

// Deals: B2B buyers, partners and creators we are working on.
// Stages: New, Talking, Samples, Negotiating, Won (+ Lost, On hold).
// Board on desktop, list on phones. Filters, view and the open deal live in
// the URL (?view=list&type=distribution_wholesale&owner=me&due=1&deal=<id>),
// so a link like /dashboard/deals?deal=<id> opens that deal's drawer.
// Nothing on this page sends a message to anyone.

import { Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Handshake, LayoutGrid, List, Plus, RefreshCw } from "lucide-react";
import { EmptyState, PageHeader, SearchBar } from "@/components/pm";
import { DealDrawer } from "@/components/deals/DealDrawer";
import { NewDealDrawer } from "@/components/deals/NewDealDrawer";
import DealsBoard from "@/components/deals/DealsBoard";
import DealsList, { type ListStage } from "@/components/deals/DealsList";
import { useStageMover } from "@/components/deals/StageControls";
import { DEALS_KEY, useDealsQuery, usePatchDeal, usePeople } from "@/components/deals/useDeals";
import { ALL_KINDS, DEFAULT_HIDDEN_KINDS, KIND_LABEL, PRIORITY_KIND } from "@/components/deals/constants";
import { elapsed, timeAgo } from "@/components/deals/format";
import { formatRupees, istToday, type Deal } from "@/lib/deals/model";
import { isClosedStage, isOpenStage } from "@/lib/deals/stages";
import css from "@/components/deals/deals.module.css";

export default function DealsPage() {
  return (
    <Suspense fallback={null}>
      <DealsScreen />
    </Suspense>
  );
}

// Phones get the list by default (drag-and-drop is not touch friendly).
function subscribeNarrow(cb: () => void) {
  const mq = window.matchMedia("(max-width: 720px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia("(max-width: 720px)").matches,
    () => false,
  );
}

// Overdue first, then due today, then cafes and restaurants, then newest activity.
function rank(today: string) {
  return (a: Deal, b: Deal) => {
    const ua = urgency(a, today);
    const ub = urgency(b, today);
    if (ua !== ub) return ua - ub;
    const pa = a.kind === PRIORITY_KIND ? 0 : 1;
    const pb = b.kind === PRIORITY_KIND ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return (b.last_email_at ?? b.updated_at).localeCompare(a.last_email_at ?? a.updated_at);
  };
}
function urgency(d: Deal, today: string): number {
  if (d.follow_up_at && d.follow_up_at < today) return 0;
  if (d.follow_up_needed) return 1;
  return 2;
}

function DealsScreen() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const narrow = useNarrow();
  const today = istToday();

  const view = params.get("view") === "list" || params.get("view") === "board"
    ? (params.get("view") as "list" | "board")
    : narrow ? "list" : "board";
  const q = params.get("q") ?? "";
  const type = params.get("type") ?? "all";
  const owner = params.get("owner") ?? "all";
  const dueOnly = params.get("due") === "1";
  const listStage = (params.get("stage") as ListStage | null) ?? "open";
  const openId = params.get("deal");
  const [adding, setAdding] = useState(false);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const s = next.toString();
      router.replace(s ? `?${s}` : "?", { scroll: false });
    },
    [params, router],
  );

  const { data, isLoading, error } = useDealsQuery();
  const peopleQ = usePeople();
  const people = useMemo(() => peopleQ.data?.people ?? [], [peopleQ.data?.people]);
  const me = peopleQ.data?.me ?? null;
  const patch = usePatchDeal();

  const { move, dialog } = useStageMover(
    (deal, stage, reason) => patch.mutate({ id: deal.id, body: { stage, ...(reason ? { reason } : {}) } }),
    patch.isPending,
  );

  // "Check inbox for new deals": runs deal-scan now. Takes a while; the page
  // stays usable and shows how long it has been going.
  const [scanStart, setScanStart] = useState<number | null>(null);
  const [scanMs, setScanMs] = useState(0);
  const scanNow = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/deals/scan", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "The inbox check failed");
      return d as { created?: number; updated?: number; locked?: boolean };
    },
    onMutate: () => {
      setScanMs(0);
      setScanStart(Date.now());
    },
    onSettled: () => {
      setScanStart(null);
      qc.invalidateQueries({ queryKey: DEALS_KEY });
    },
  });
  useEffect(() => {
    if (scanStart == null) return;
    const t = setInterval(() => setScanMs(Date.now() - scanStart), 1000);
    return () => clearInterval(t);
  }, [scanStart]);

  const deals = useMemo(() => data?.deals ?? [], [data?.deals]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return deals
      .filter((d) => {
        if (type === "all" && (DEFAULT_HIDDEN_KINDS as string[]).includes(d.kind)) return false;
        if (type !== "all" && type !== "everything" && d.kind !== type) return false;
        if (owner === "me" && d.owner_email !== me) return false;
        if (owner === "none" && d.owner_email) return false;
        if (owner !== "all" && owner !== "me" && owner !== "none" && d.owner_email !== owner) return false;
        if (dueOnly && !d.follow_up_needed) return false;
        if (
          needle &&
          ![d.company_name, d.company_domain, d.contact_name, d.contact_email, d.contact_phone, d.summary, d.next_step, d.source_ref]
            .filter(Boolean)
            .some((v) => (v as string).toLowerCase().includes(needle))
        ) {
          return false;
        }
        return true;
      })
      .sort(rank(today));
  }, [deals, q, type, owner, me, dueOnly, today]);

  const live = useMemo(() => filtered.filter((d) => !isClosedStage(d.stage)), [filtered]);
  const closed = useMemo(() => filtered.filter((d) => isClosedStage(d.stage)), [filtered]);

  // Header numbers ignore the filters (except hidden pitches): the whole picture.
  const summary = useMemo(() => {
    const pipeline = deals.filter((d) => !(DEFAULT_HIDDEN_KINDS as string[]).includes(d.kind));
    const open = pipeline.filter((d) => isOpenStage(d.stage));
    return {
      open: open.length,
      value: open.reduce((s, d) => s + (d.value_inr ?? 0), 0),
      due: open.filter((d) => d.follow_up_needed).length,
      overdue: open.filter((d) => d.follow_up_at && d.follow_up_at < today).length,
      won: pipeline.filter((d) => d.stage === "won").length,
    };
  }, [deals, today]);

  const scan = data?.scan;
  const scanLabel = scanStart != null ? `Checking inbox… ${elapsed(scanMs)}` : "Check inbox for new deals";

  return (
    <div className={css.scope}>
      <PageHeader
        crumb="B2B & deals"
        title="Deals"
        summary={
          isLoading ? (
            "Loading your deals…"
          ) : (
            <>
              {summary.value > 0 ? (
                <>
                  <b>{formatRupees(summary.value)}</b> in {summary.open} open {summary.open === 1 ? "deal" : "deals"}
                </>
              ) : (
                <>
                  <b>{summary.open}</b> open {summary.open === 1 ? "deal" : "deals"}
                </>
              )}
              {summary.due > 0 ? (
                <>
                  , <b className={css.sumWarn}>{summary.due} need a follow-up today</b>
                  {summary.overdue > 0 ? ` (${summary.overdue} overdue)` : ""}
                </>
              ) : (
                ", nothing to chase today"
              )}
              {summary.won > 0 ? `, ${summary.won} won` : ""}. Inbox checked {scan?.last_run_at ? timeAgo(scan.last_run_at) : "never"}.
            </>
          )
        }
        actions={
          <>
            <div className="pm2-seg" role="group" aria-label="View">
              <button type="button" className={view === "board" ? "on" : undefined} aria-pressed={view === "board"} onClick={() => setParams({ view: "board" })}>
                <LayoutGrid size={15} aria-hidden /> Board
              </button>
              <button type="button" className={view === "list" ? "on" : undefined} aria-pressed={view === "list"} onClick={() => setParams({ view: "list" })}>
                <List size={15} aria-hidden /> List
              </button>
            </div>
            <button type="button" className="pm2-btn" disabled={scanNow.isPending} onClick={() => scanNow.mutate()} aria-live="polite">
              <RefreshCw size={15} aria-hidden className={scanNow.isPending ? css.spin : undefined} /> {scanLabel}
            </button>
            <button type="button" className="pm2-btn pri" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden /> Add a deal
            </button>
          </>
        }
      />

      <div className={css.body}>
        {scanNow.error instanceof Error && <p className={css.err}>{scanNow.error.message}</p>}
        {scanNow.isSuccess && scanNow.data && (
          <p className={css.note}>
            {scanNow.data.locked
              ? "An inbox check is already running. New deals will show up in a minute."
              : `Inbox checked: ${scanNow.data.created ?? 0} new, ${scanNow.data.updated ?? 0} updated.`}
          </p>
        )}
        {!scanNow.error && scan?.last_error && <p className={css.err}>Last inbox check had a problem: {scan.last_error}</p>}
        {data && !data.schema_ready && (
          <p className={css.note}>
            The database update for deals is not applied yet. Follow-up dates, owner, value and phone are kept in notes until it is.
          </p>
        )}

        <div className={css.bar}>
          <SearchBar value={q} onChange={(v) => setParams({ q: v })} placeholder="Search company, person, phone…" />
          <select className={css.filter} value={type} aria-label="Type" onChange={(e) => setParams({ type: e.target.value === "all" ? null : e.target.value })}>
            <option value="all">All types</option>
            {ALL_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
            <option value="everything">Everything, incl. selling to us</option>
          </select>
          <select className={css.filter} value={owner} aria-label="Owner" onChange={(e) => setParams({ owner: e.target.value === "all" ? null : e.target.value })}>
            <option value="all">Anyone</option>
            <option value="me">Mine</option>
            <option value="none">No owner</option>
            {people.map((p) => (
              <option key={p.email} value={p.email}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="button" className={css.toggle} data-on={dueOnly} aria-pressed={dueOnly} onClick={() => setParams({ due: dueOnly ? null : "1" })}>
            Needs a follow-up
          </button>
        </div>

        {isLoading ? (
          <p className={css.muted}>Loading deals…</p>
        ) : error instanceof Error ? (
          <p className={css.err}>{error.message}</p>
        ) : deals.length === 0 ? (
          <EmptyState
            icon={<Handshake />}
            title="No deals yet"
            cta={
              <div className={css.emptyActions}>
                <button type="button" className="pm2-btn pri" onClick={() => setAdding(true)}>
                  <Plus size={16} aria-hidden /> Add a deal
                </button>
                <button type="button" className="pm2-btn" disabled={scanNow.isPending} onClick={() => scanNow.mutate()}>
                  {scanLabel}
                </button>
              </div>
            }
          >
            Add one by hand, or check hello@promunch.in for buyers and partners who wrote in.
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Handshake />}
            title="Nothing matches"
            cta={
              <button type="button" className="pm2-btn" onClick={() => setParams({ q: null, type: null, owner: null, due: null })}>
                Clear filters
              </button>
            }
          >
            No deals match these filters.
          </EmptyState>
        ) : view === "board" ? (
          <DealsBoard deals={live} closed={closed} people={people} today={today} onOpen={(id) => setParams({ deal: id })} onMove={move} />
        ) : (
          <DealsList
            deals={filtered}
            stage={listStage}
            onStage={(s) => setParams({ stage: s === "open" ? null : s })}
            people={people}
            today={today}
            onOpen={(id) => setParams({ deal: id })}
            onMove={move}
          />
        )}
        {patch.error instanceof Error && <p className={css.err}>{patch.error.message}</p>}
      </div>

      {openId && (
        <DealDrawer
          dealId={openId}
          allDeals={deals}
          people={people}
          onClose={() => setParams({ deal: null })}
          onGone={(id) => setParams({ deal: id ?? null })}
        />
      )}
      {adding && (
        <NewDealDrawer
          people={people}
          me={me}
          onClose={() => setAdding(false)}
          onCreated={(deal) => {
            setAdding(false);
            qc.invalidateQueries({ queryKey: DEALS_KEY });
            setParams({ deal: deal.id });
          }}
        />
      )}
      {dialog}
    </div>
  );
}
