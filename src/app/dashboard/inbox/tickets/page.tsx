"use client";

// /dashboard/inbox/tickets — Tickets board (Task 2.6). A kanban of every
// open/pending/recently-resolved wa_threads + ig_threads ticket
// (src/lib/inbox/tickets.ts / /api/inbox/tickets, Task 2.6), grouped by
// status with a 4-hour first-human-reply target. All writes reuse the
// existing PATCH /api/whatsapp/threads/[id] and
// PATCH /api/instagram/threads/[id]/stage routes — this page never messages
// a customer.

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Chips, KpiStrip, Kpi, Board, Pill, Avatar, Callout, ConfirmDialog } from "@/components/pm";
import type { ChipItem, BoardColumn } from "@/components/pm";
import { formatINR } from "@/lib/metrics/money";
import { useToast } from "@/components/ui/Toast";
import { patchThread } from "@/components/inbox/shared";
import type { TicketCard, TicketsBoard } from "@/lib/inbox/tickets";

type FilterKey = "open" | "waiting" | "resolved";

const FILTER_CHIPS: { key: FilterKey; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "waiting", label: "Waiting on customer" },
  { key: "resolved", label: "Resolved this week" },
];

function parseFilter(raw: string | null): FilterKey {
  return raw === "waiting" || raw === "resolved" ? raw : "open";
}

function computeDeltaPct(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

type TeamUser = { id: string; email: string | null; name: string };

export default function TicketsPage() {
  return (
    <Suspense fallback={<TicketsFallback />}>
      <TicketsPageInner />
    </Suspense>
  );
}

function TicketsFallback() {
  return (
    <div className="pm2-body">
      <div className="pm2-skel" style={{ minHeight: 400 }} />
    </div>
  );
}

function TicketsPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const filter = parseFilter(params.get("filter"));

  const setFilter = useCallback(
    (key: string) => {
      const sp = new URLSearchParams(params.toString());
      if (key === "open") sp.delete("filter");
      else sp.set("filter", key);
      const qs = sp.toString();
      router.replace(`/dashboard/inbox/tickets${qs ? `?${qs}` : ""}`);
    },
    [params, router],
  );

  const boardQ = useQuery({
    queryKey: ["tickets-board"],
    queryFn: async (): Promise<TicketsBoard> => {
      const r = await fetch("/api/inbox/tickets", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `tickets ${r.status}`);
      return j as TicketsBoard;
    },
    refetchInterval: 15_000,
  });

  const teamQ = useQuery({
    queryKey: ["team-names"],
    queryFn: async (): Promise<TeamUser[]> => {
      const r = await fetch("/api/team", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) return [];
      return (j.users ?? []) as TeamUser[];
    },
    staleTime: 60_000,
  });
  const teamUsers = useMemo(
    () => (teamQ.data ?? []).filter((u): u is TeamUser & { email: string } => Boolean(u.email)),
    [teamQ.data],
  );

  const [busyKey, setBusyKey] = useState<string | null>(null);

  const toast = useToast();
  // patchThread checks r.ok and shows the route's error as a toast; a
  // network drop gets its own toast here.
  const patch = useCallback(
    async (url: string, body: Record<string, unknown>) => {
      try {
        await patchThread(url, body, toast);
      } catch {
        toast.push({ kind: "error", text: "Could not update: network error. Please try again." });
      }
    },
    [toast],
  );
  const patchWa = useCallback(
    (id: string, body: Record<string, unknown>) => patch(`/api/whatsapp/threads/${id}`, body),
    [patch],
  );
  const patchIg = useCallback(
    (id: string, body: Record<string, unknown>) => patch(`/api/instagram/threads/${id}/stage`, body),
    [patch],
  );

  const runAction = useCallback(
    async (key: string, action: () => Promise<void>) => {
      setBusyKey(key);
      try {
        await action();
      } finally {
        setBusyKey(null);
        qc.invalidateQueries({ queryKey: ["tickets-board"] });
      }
    },
    [qc],
  );

  const onAssign = useCallback(
    (channel: "wa" | "ig", id: string, email: string) =>
      runAction(`${channel}-${id}`, () =>
        channel === "wa" ? patchWa(id, { ticket_assignee: email }) : patchIg(id, { assigned_to: email }),
      ),
    [runAction, patchWa, patchIg],
  );
  const onWaiting = useCallback(
    (channel: "wa" | "ig", id: string) =>
      runAction(`${channel}-${id}`, () => (channel === "wa" ? patchWa(id, { ticket_status: "pending" }) : Promise.resolve())),
    [runAction, patchWa],
  );
  const onResolve = useCallback(
    (channel: "wa" | "ig", id: string) =>
      runAction(`${channel}-${id}`, () =>
        channel === "wa" ? patchWa(id, { ticket_status: "resolved" }) : patchIg(id, { resolve_ticket: true }),
      ),
    [runAction, patchWa, patchIg],
  );

  const board = boardQ.data;
  const chipItems: ChipItem[] = FILTER_CHIPS.map((f) => ({
    key: f.key,
    label: f.label,
    count: board
      ? f.key === "open"
        ? board.counts.open
        : f.key === "waiting"
          ? board.counts.waiting
          : board.counts.resolvedWeek
      : undefined,
  }));

  const header = (
    <PageHeader
      crumb="Inbox"
      title="Tickets"
      actions={
        <>
          <Chips items={chipItems} value={filter} onChange={setFilter} ariaLabel="Filter tickets" />
          <span className="pm2-cmp pm2-d-only">target: first human reply within 4h</span>
        </>
      }
    />
  );

  if (boardQ.isError && !board) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="crit"
            title="Couldn't load tickets"
            body={boardQ.error instanceof Error ? boardQ.error.message : "Something went wrong."}
            action={
              <button type="button" className="pm2-btn pri sm" onClick={() => boardQ.refetch()}>
                Retry
              </button>
            }
          />
        </div>
      </>
    );
  }

  if (boardQ.isLoading || !board) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <div className="pm2-skel" style={{ minHeight: 400 }} />
        </div>
      </>
    );
  }

  const medianDeltaPct = computeDeltaPct(board.kpis.medianResolveHours, board.kpis.prevMedianResolveHours);
  const topCategory = board.kpis.topCategory;
  const categoryDeltaPct = topCategory ? computeDeltaPct(topCategory.count, topCategory.prevCount) : null;

  const visibleColumns = board.columns.filter((c) => {
    if (filter === "open") return c.key === "new" || c.key.startsWith("with:");
    if (filter === "waiting") return c.key === "waiting";
    return c.key === "resolved";
  });
  const boardColumns: BoardColumn[] = visibleColumns.map((c) => ({
    key: c.key,
    title: c.title,
    count: c.cards.length,
    cards: c.cards.map((card) => (
      <TicketCardView
        key={card.key}
        card={card}
        teamUsers={teamUsers}
        busyKey={busyKey}
        onAssign={onAssign}
        onWaiting={onWaiting}
        onResolve={onResolve}
      />
    )),
  }));

  return (
    <>
      {header}
      <div className="pm2-body">
        <KpiStrip cols={3}>
          <Kpi label="Open" value={board.kpis.open} sub={`${board.kpis.pastTarget} past target`} />
          <Kpi
            label="Median time to resolve"
            value={board.kpis.medianResolveHours != null ? `${board.kpis.medianResolveHours.toFixed(1)}h` : "None resolved"}
            delta={medianDeltaPct}
            invert
            sub="this week"
            deltaTip="Lower is better"
          />
          <Kpi
            label={`${topCategory?.word ?? "Complaint"} tickets`}
            value={topCategory?.count ?? 0}
            delta={categoryDeltaPct}
            sub="this week"
          />
        </KpiStrip>
        <Board columns={boardColumns} empty="No tickets here." />
        <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--pm-hint)" }}>
          Ops can also close a ticket by replying &quot;done #N&quot; on WhatsApp.
        </p>
      </div>
    </>
  );
}

function TicketCardView({
  card,
  teamUsers,
  busyKey,
  onAssign,
  onWaiting,
  onResolve,
}: {
  card: TicketCard;
  teamUsers: { email: string; name: string }[];
  busyKey: string | null;
  onAssign: (channel: "wa" | "ig", id: string, email: string) => void;
  onWaiting: (channel: "wa" | "ig", id: string) => void;
  onResolve: (channel: "wa" | "ig", id: string) => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const channel = card.key.slice(0, 2) as "wa" | "ig";
  const id = card.key.slice(3);
  const busy = busyKey === card.key;
  const assigneeName = card.assignee ? teamUsers.find((u) => u.email === card.assignee)?.name || card.assignee : null;

  return (
    <>
      <div className="t" style={{ cursor: "pointer" }} onClick={() => router.push(card.href)}>
        {card.number != null ? `#${card.number} ` : ""}
        {card.title}
      </div>
      <div className="m" style={{ cursor: "pointer" }} onClick={() => router.push(card.href)}>
        <span>{card.customer}</span>
        {card.orderRef ? <span>· {card.orderRef}</span> : null}
        {card.orderValue != null ? <span>· {formatINR(card.orderValue)}</span> : null}
      </div>
      <div className="m">
        <Pill tone={card.tone} plain>
          {card.ageText}
        </Pill>
        {assigneeName ? <Avatar name={assigneeName} size={28} /> : <span>Unassigned</span>}
        <button
          type="button"
          className="pm2-btn sm"
          style={{ marginLeft: "auto" }}
          aria-label="Ticket actions"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          ⋯
        </button>
      </div>
      {menuOpen ? (
        <div className="m" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
          <select
            className="pm2-btn sm"
            defaultValue=""
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) {
                onAssign(channel, id, e.target.value);
                setMenuOpen(false);
              }
            }}
          >
            <option value="" disabled>
              Assign to…
            </option>
            {teamUsers.map((u) => (
              <option key={u.email} value={u.email}>
                {u.name}
              </option>
            ))}
          </select>
          {channel === "wa" ? (
            <button
              type="button"
              className="pm2-btn sm"
              disabled={busy}
              onClick={() => {
                onWaiting(channel, id);
                setMenuOpen(false);
              }}
            >
              Waiting on customer
            </button>
          ) : null}
          <button
            type="button"
            className="pm2-btn sm"
            disabled={busy}
            onClick={() => {
              setMenuOpen(false);
              setConfirming(true);
            }}
          >
            Resolve
          </button>
        </div>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={card.number != null ? `Resolve ticket #${card.number}?` : "Resolve this ticket?"}
          body="The customer is not messaged."
          confirmLabel="Resolve"
          busy={busy}
          onConfirm={() => {
            onResolve(channel, id);
            setConfirming(false);
          }}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}
