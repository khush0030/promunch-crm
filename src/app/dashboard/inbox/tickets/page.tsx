"use client";

// /dashboard/inbox/tickets — Tickets queue (Task 2.6, Oct 2026 redesign).
// A views column (My work / All tickets) and a searchable queue of every
// open/pending/recently-resolved wa_threads + ig_threads ticket
// (src/lib/inbox/tickets.ts / /api/inbox/tickets), with a 4-hour
// first-human-reply target. All writes reuse the existing
// PATCH /api/whatsapp/threads/[id] and PATCH /api/instagram/threads/[id]/stage
// routes — this page never messages a customer.

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock,
  Building2,
  CircleCheck,
  CircleHelp,
  CircleDot,
  Clock,
  Hourglass,
  Inbox as InboxIcon,
  ListTodo,
  MoreHorizontal,
  Package,
  Search,
  Tag,
  TriangleAlert,
  User,
  UserCheck,
  Wallet,
} from "lucide-react";
import { PageHeader, Avatar, Callout, ConfirmDialog } from "@/components/pm";
import { formatINR } from "@/lib/metrics/money";
import { useToast } from "@/components/ui/Toast";
import { patchThread } from "@/components/inbox/shared";
import { useMeEmail } from "@/components/inbox/hooks";
import type { TicketCard, TicketsBoard } from "@/lib/inbox/tickets";
import { topicKey, topicWord } from "@/lib/inbox/ticket-reports";
import s from "./tickets.module.css";

// Views map straight onto the board columns the API already builds:
//   new       = open + unassigned          ("New")
//   with:*    = open/pending + assigned    ("Open")
//   waiting   = pending + unassigned       ("Waiting on customer")
//   resolved  = resolved in the last 7 days ("Solved")
// Topics views ("topic:<category>") group live tickets by ticket_category.
type BaseView = "mine" | "unassigned" | "overdue" | "open" | "new" | "assigned" | "waiting" | "resolved";
type ViewKey = BaseView | `topic:${string}`;
type Status = "new" | "open" | "waiting" | "solved";
type ChannelFilter = "all" | "wa" | "ig";
type SortKey = "oldest" | "newest";

const VIEW_KEYS: BaseView[] = ["mine", "unassigned", "overdue", "open", "new", "assigned", "waiting", "resolved"];

// Icons for the topics the bot writes; anything else gets a plain tag.
const TOPIC_ICON: Record<string, ReactNode> = {
  order_issue: <Package aria-hidden />,
  order_tracking: <Package aria-hidden />,
  refund: <Wallet aria-hidden />,
  product_query: <CircleHelp aria-hidden />,
  wholesale: <Building2 aria-hidden />,
  partnership: <Building2 aria-hidden />,
  complaint: <TriangleAlert aria-hidden />,
};

const STATUS_WORD: Record<Status, string> = {
  new: "New",
  open: "Open",
  waiting: "Waiting",
  solved: "Solved",
};

const CHANNEL_WORD: Record<"wa" | "ig", string> = { wa: "WhatsApp", ig: "Instagram" };

function parseView(raw: string | null): ViewKey {
  if (raw && raw.startsWith("topic:") && raw.length > 6) return raw as ViewKey;
  return VIEW_KEYS.includes(raw as BaseView) ? (raw as BaseView) : "open";
}

// Display-only sort key off the aggregator's age text ("40m", "2h 10m",
// "3 days"). Resolved cards ("resolved in …") return null and keep the
// server's order.
function ageMinutes(text: string): number | null {
  if (text.startsWith("resolved")) return null;
  const d = text.match(/(\d+)\s*days?/);
  if (d) return Number(d[1]) * 1440;
  const h = text.match(/(\d+)h/);
  const m = text.match(/(\d+)m/);
  if (!h && !m) return null;
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

type Row = { card: TicketCard; status: Status; channel: "wa" | "ig"; order: number };

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
  const view = parseView(params.get("filter"));
  const me = useMeEmail();

  const setView = useCallback(
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
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [sort, setSort] = useState<SortKey>("oldest");

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

  // Every card once, tagged with the status its column means.
  const allRows = useMemo<Row[]>(() => {
    if (!board) return [];
    const out: Row[] = [];
    for (const col of board.columns) {
      const status: Status =
        col.key === "new" ? "new" : col.key === "waiting" ? "waiting" : col.key === "resolved" ? "solved" : "open";
      for (const card of col.cards) {
        out.push({ card, status, channel: card.key.slice(0, 2) as "wa" | "ig", order: out.length });
      }
    }
    return out;
  }, [board]);

  const inView = useCallback(
    (r: Row, v: ViewKey): boolean => {
      const live = r.status !== "solved";
      if (v.startsWith("topic:")) return live && topicKey(r.card.category) === v.slice(6);
      switch (v) {
        case "mine":
          return live && !!me && r.card.assignee === me;
        case "unassigned":
          return live && !r.card.assignee;
        case "overdue":
          return live && r.card.pastTarget;
        case "open":
          return r.status === "new" || r.status === "open";
        case "new":
          return r.status === "new";
        case "assigned":
          return r.status === "open";
        case "waiting":
          return r.status === "waiting";
        case "resolved":
          return r.status === "solved";
        default:
          return false;
      }
    },
    [me],
  );

  // Topics among live tickets, biggest first. Merged by display word so
  // "support" and "customer_support" are one row.
  const topics = useMemo(() => {
    const m = new Map<string, { key: string; word: string; n: number }>();
    for (const r of allRows) {
      if (r.status === "solved") continue;
      const key = topicKey(r.card.category);
      const word = topicWord(key);
      const t = m.get(word) ?? { key, word, n: 0 };
      t.n++;
      m.set(word, t);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.word.localeCompare(b.word));
  }, [allRows]);

  const counts = useMemo(() => {
    const c = {} as Record<string, number>;
    for (const k of VIEW_KEYS) c[k] = allRows.filter((r) => inView(r, k)).length;
    for (const t of topics) c[`topic:${t.key}`] = t.n;
    return c;
  }, [allRows, inView, topics]);

  const nameOf = useCallback(
    (email: string | null) => (email ? teamUsers.find((u) => u.email === email)?.name || email : null),
    [teamUsers],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = allRows.filter((r) => {
      if (!inView(r, view)) return false;
      if (channel !== "all" && r.channel !== channel) return false;
      if (!q) return true;
      const hay = [r.card.title, r.card.customer, r.card.orderRef, r.card.number != null ? `#${r.card.number}` : null, nameOf(r.card.assignee)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    const sorted = [...list].sort((a, b) => {
      const am = ageMinutes(a.card.ageText);
      const bm = ageMinutes(b.card.ageText);
      if (am != null && bm != null && am !== bm) return bm - am;
      return a.order - b.order;
    });
    return sort === "newest" ? sorted.reverse() : sorted;
  }, [allRows, inView, view, channel, query, sort, nameOf]);

  const header = (
    <PageHeader
      crumb="Inbox"
      title="Tickets"
      summary={
        boardQ.data ? (
          <>
            <b>{boardQ.data.kpis.open} open</b>, {boardQ.data.kpis.pastTarget} past their reply time.
            {me ? <> You&apos;re on {counts.mine} of them.</> : null}
          </>
        ) : undefined
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

  const viewGroups: { title: string; items: { key: ViewKey; label: string; icon: ReactNode }[] }[] = [
    {
      title: "My work",
      items: [
        { key: "mine", label: "Mine, open", icon: <User aria-hidden /> },
        { key: "unassigned", label: "Not assigned", icon: <InboxIcon aria-hidden /> },
        { key: "overdue", label: "Overdue", icon: <AlarmClock aria-hidden /> },
      ],
    },
    {
      title: "All tickets",
      items: [
        { key: "open", label: "All open", icon: <ListTodo aria-hidden /> },
        { key: "new", label: "New", icon: <CircleDot aria-hidden /> },
        { key: "assigned", label: "Open", icon: <UserCheck aria-hidden /> },
        { key: "waiting", label: "Waiting on customer", icon: <Hourglass aria-hidden /> },
        { key: "resolved", label: "Solved, 7 days", icon: <CircleCheck aria-hidden /> },
      ],
    },
  ];
  // Topics: every topic with a live ticket, plus the one being viewed (so a
  // topic that just emptied keeps its row instead of vanishing under you).
  const topicItems = topics.map((t) => ({ key: `topic:${t.key}` as ViewKey, label: t.word, icon: TOPIC_ICON[t.key] ?? <Tag aria-hidden /> }));
  if (view.startsWith("topic:") && !topicItems.some((t) => t.key === view)) {
    const key = view.slice(6);
    topicItems.push({ key: view, label: topicWord(key), icon: TOPIC_ICON[key] ?? <Tag aria-hidden /> });
  }
  if (topicItems.length) viewGroups.push({ title: "Topics", items: topicItems });

  return (
    <>
      {header}
      <div className="pm2-body">
        <div className={s.tq}>
          <nav className={s.views} aria-label="Ticket views">
            {viewGroups.map((g) => (
              <div key={g.title}>
                <div className={s.vg}>{g.title}</div>
                {g.items.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    className={`${s.view}${view === it.key ? ` ${s.on}` : ""}`}
                    aria-current={view === it.key ? "page" : undefined}
                    onClick={() => setView(it.key)}
                  >
                    {it.icon}
                    <span className={s.vl}>{it.label}</span>
                    <span className={s.n}>{it.key === "mine" && !me ? "" : (counts[it.key] ?? 0)}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className={s.queue}>
            <div className={s.tools}>
              <select
                className={`pm2-btn sm ${s.viewSelect}`}
                aria-label="Ticket view"
                value={view}
                onChange={(e) => setView(e.target.value)}
              >
                {viewGroups.map((g) => (
                  <optgroup key={g.title} label={g.title}>
                    {g.items.map((it) => (
                      <option key={it.key} value={it.key}>
                        {it.label} ({counts[it.key] ?? 0})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <label className={s.search}>
                <Search aria-hidden />
                <input
                  type="search"
                  placeholder="Search tickets, names, order numbers"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search tickets"
                />
              </label>
              <select
                className="pm2-btn sm"
                aria-label="Filter by channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value as ChannelFilter)}
              >
                <option value="all">All channels</option>
                <option value="wa">WhatsApp</option>
                <option value="ig">Instagram</option>
              </select>
              <select
                className="pm2-btn sm"
                aria-label="Sort tickets"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="oldest">Oldest first</option>
                <option value="newest">Newest first</option>
              </select>
            </div>

            <div className={s.thead} aria-hidden>
              <span>Ticket</span>
              <span>{view === "resolved" ? "Resolved" : "Open for"}</span>
              <span>Status</span>
              <span>Who</span>
              <span />
            </div>

            {rows.length === 0 ? (
              <div className={s.empty}>
                {query || channel !== "all" ? "No tickets match this search." : view === "mine" && !me ? "Signing you in…" : "No tickets here."}
              </div>
            ) : (
              <ul className={s.rows}>
                {rows.map((r) => (
                  <TicketRowView
                    key={r.card.key}
                    row={r}
                    teamUsers={teamUsers}
                    assigneeName={nameOf(r.card.assignee)}
                    busyKey={busyKey}
                    onAssign={onAssign}
                    onWaiting={onWaiting}
                    onResolve={onResolve}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
        <p className={s.note}>Ops can also close a ticket by replying &quot;done #N&quot; on WhatsApp.</p>
      </div>
    </>
  );
}

function DueLabel({ card, status }: { card: TicketCard; status: Status }) {
  if (status === "solved") {
    return (
      <span className={s.due} title={card.ageText}>
        <CircleCheck aria-hidden />
        <span>{card.ageText}</span>
      </span>
    );
  }
  const age = card.ageText.replace(/ · past target$/, "");
  const tone = card.pastTarget ? s.late : card.tone === "warn" ? s.soon : "";
  return (
    <span
      className={`${s.due} ${tone}`}
      title={card.pastTarget ? "Past the 4h first-reply target" : "Time since the ticket opened (target: first human reply within 4h)"}
    >
      {card.pastTarget ? <AlarmClock aria-hidden /> : <Clock aria-hidden />}
      <span>
        {age}
        {card.pastTarget ? <span className={s.dueSub}> · late</span> : null}
      </span>
    </span>
  );
}

function TicketRowView({
  row,
  teamUsers,
  assigneeName,
  busyKey,
  onAssign,
  onWaiting,
  onResolve,
}: {
  row: Row;
  teamUsers: { email: string; name: string }[];
  assigneeName: string | null;
  busyKey: string | null;
  onAssign: (channel: "wa" | "ig", id: string, email: string) => void;
  onWaiting: (channel: "wa" | "ig", id: string) => void;
  onResolve: (channel: "wa" | "ig", id: string) => void;
}) {
  const { card, status, channel } = row;
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = card.key.slice(3);
  const busy = busyKey === card.key;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);

  const meta = [
    card.number != null ? `#${card.number}` : null,
    card.customer,
    CHANNEL_WORD[channel],
    card.orderRef ? `order ${card.orderRef}${card.orderValue != null ? ` · ${formatINR(card.orderValue)}` : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className={s.row} onClick={() => router.push(card.href)}>
      <div className={s.subj}>
        <Link href={card.href} className={s.title} onClick={(e) => e.stopPropagation()}>
          {card.title}
        </Link>
        <span className={s.meta}>{meta}</span>
      </div>
      <div className={s.dueCell}>
        <DueLabel card={card} status={status} />
      </div>
      <div className={s.stCell}>
        <span className={`${s.st} ${s[`st_${status}`]}`}>{STATUS_WORD[status]}</span>
      </div>
      <div className={s.who}>
        {assigneeName ? (
          <span title={assigneeName} className={s.whoAv}>
            <Avatar name={assigneeName} size={28} />
          </span>
        ) : (
          <span className={s.nobody}>Nobody</span>
        )}
      </div>
      <div className={s.act} ref={menuRef} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`pm2-btn sm ghost ${s.more}`}
          aria-label="Ticket actions"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MoreHorizontal aria-hidden />
        </button>
        {menuOpen ? (
          <div className={s.menu} role="menu">
            <select
              className="pm2-btn sm"
              defaultValue=""
              disabled={busy}
              aria-label="Assign to"
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
                className="pm2-btn sm ghost"
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
              className="pm2-btn sm ghost"
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
      </div>
    </li>
  );
}
