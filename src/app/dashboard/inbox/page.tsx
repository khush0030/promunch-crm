"use client";

// /dashboard/inbox: Live chats, the Inbox landing page. One list across
// WhatsApp and support email (src/lib/inbox/conversations.ts /
// /api/inbox/conversations). Laptop is three panels filling the viewport,
// each scrolling on its own:
//   1. conversation list (views: Waiting on us / Needs a human / Mine / Bot /
//      Snoozed / All, channel tags, search, colour-tagged rows)
//   2. the open conversation (WaConversation/IgConversation in peek+compact
//      mode, or the email with its AI draft to review inline)
//   3. the customer panel (CustomerContext), a drawer on narrow laptops
// Phone has the list only; taps navigate to the full conversation page.
//
// Selection is sticky: the open chat lives in ?open= and stays open even if
// an action moves it out of the current view, so the reply box never swaps
// customers under a typed draft. With no ?open=, the first row is pinned
// once. While a WhatsApp chat is on screen (and the tab is visible) its
// unread badge is cleared, including when new messages arrive.

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { PageHeader, Callout, Avatar, Tag } from "@/components/pm";
import { SearchBar } from "@/components/pm";
import { WaConversation } from "@/components/inbox/WaConversation";
import { IgConversation } from "@/components/inbox/IgConversation";
import { AlertsControl } from "@/components/inbox/AlertsControl";
import { CustomerContext } from "@/components/inbox/CustomerContext";
import { InlineEmailReview } from "@/components/inbox/email/InlineEmailReview";
import { statusTag, topicTag } from "@/components/inbox/labels";
import { formatWhen } from "@/lib/inbox/when";
import { useMediaPhone } from "@/components/shell/useMediaPhone";
import { WAITING_DAYS, type InboxFilter, type InboxItem } from "@/lib/inbox/conversations";
import st from "./inbox.module.css";

type Channel = "all" | "wa" | "ig" | "em";

type InboxListResponse = {
  items: InboxItem[];
  counts: Record<InboxFilter, number>;
  total: number;
  nextCursor: string | null;
  me: string;
};

// Instagram stays out of the switcher until its backend is live (nav.ts Partners hub).
const CHANNELS: { key: "all" | "wa" | "em"; label: string; kind?: string }[] = [
  { key: "all", label: "All channels" },
  { key: "wa", label: "WhatsApp", kind: "whatsapp" },
  { key: "em", label: "Email", kind: "email" },
];

const VIEWS: { key: InboxFilter; label: string; title: string }[] = [
  { key: "waiting", label: "Waiting on us", title: `The customer wrote last (past ${WAITING_DAYS} days), longest wait first` },
  { key: "human", label: "Needs a human", title: "Open tickets, chats a person took over, and email drafts to approve" },
  { key: "mine", label: "Mine", title: "Chats and tickets assigned to you" },
  { key: "bot", label: "Bot", title: "Chats the bot is answering" },
  { key: "snoozed", label: "Snoozed", title: "Chats set aside for later" },
  { key: "all", label: "All", title: "Every conversation, newest first" },
];

const EMPTY_COPY: Record<InboxFilter, string> = {
  waiting: `Nobody is waiting on a reply. Customers who wrote last in the past ${WAITING_DAYS} days show here, longest wait first.`,
  human: "Nobody needs a person right now.",
  mine: "Nothing is assigned to you.",
  bot: "No conversations match.",
  snoozed: "Nothing is snoozed.",
  all: "No conversations match.",
};

function parseFilter(raw: string | null): InboxFilter {
  return VIEWS.some((v) => v.key === raw) ? (raw as InboxFilter) : "waiting";
}
function parseChannel(raw: string | null): Channel {
  return raw === "wa" || raw === "ig" || raw === "em" ? raw : "all";
}

// The list item's key is always "<2-letter prefix>-<id>" (wa-/ig-/em-).
function idFromKey(key: string): string {
  return key.slice(3);
}
function channelFromKey(key: string): "wa" | "ig" | "em" | null {
  const p = key.slice(0, 3);
  return p === "wa-" ? "wa" : p === "ig-" ? "ig" : p === "em-" ? "em" : null;
}

export default function InboxPage() {
  return (
    <Suspense fallback={<InboxFallback />}>
      <InboxPageInner />
    </Suspense>
  );
}

function InboxFallback() {
  return (
    <div className="pm2-body pm2-wide">
      <div className="pm2-skel" style={{ minHeight: 500 }} />
    </div>
  );
}

function InboxPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();

  const filter = parseFilter(params.get("filter"));
  const channel = parseChannel(params.get("channel"));
  const q = params.get("q") || "";
  const openParam = params.get("open");

  const [qDraft, setQDraft] = useState(q);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([]);

  const setQuery = useCallback(
    (next: Partial<{ filter: InboxFilter; channel: Channel; q: string; open: string | null }>) => {
      const sp = new URLSearchParams(params.toString());
      const f = next.filter ?? filter;
      const c = next.channel ?? channel;
      const query = next.q ?? q;
      const open = next.open !== undefined ? next.open : openParam;
      if (f === "waiting") sp.delete("filter");
      else sp.set("filter", f);
      if (c === "all") sp.delete("channel");
      else sp.set("channel", c);
      if (query) sp.set("q", query);
      else sp.delete("q");
      if (open) sp.set("open", open);
      else sp.delete("open");
      const qs = sp.toString();
      router.replace(`/dashboard/inbox${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, filter, channel, q, openParam, router],
  );

  // Filter/channel/search define a new result set, so paging restarts at
  // page 1. Runs on mount too, which is a harmless no-op.
  useEffect(() => {
    setCursor(null);
    setCursorStack([]);
  }, [filter, channel, q]);

  // Search box: debounce keystrokes 250ms before committing to the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if (qDraft !== q) setQuery({ q: qDraft });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft]);
  useEffect(() => {
    setQDraft(q);
  }, [q]);

  // After an action (take over, assign, solve, approve...) the next list
  // read asks for fresh counts instead of the 30s server cache.
  const freshRef = useRef(false);
  const listQ = useQuery({
    queryKey: ["inbox-list", filter, channel, q, cursor],
    queryFn: async (): Promise<InboxListResponse> => {
      const sp = new URLSearchParams();
      sp.set("filter", filter);
      sp.set("channel", channel);
      if (q) sp.set("q", q);
      if (cursor) sp.set("cursor", cursor);
      sp.set("limit", "20");
      if (freshRef.current) {
        sp.set("fresh", "1");
        freshRef.current = false;
      }
      const r = await fetch(`/api/inbox/conversations?${sp.toString()}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `inbox ${r.status}`);
      return j as InboxListResponse;
    },
    refetchInterval: 4000,
    placeholderData: keepPreviousData,
  });
  const refreshList = useCallback(() => {
    freshRef.current = true;
    qc.invalidateQueries({ queryKey: ["inbox-list"] });
  }, [qc]);

  const items = useMemo(() => listQ.data?.items ?? [], [listQ.data]);
  const counts = listQ.data?.counts;
  const total = listQ.data?.total ?? 0;
  const isPhone = useMediaPhone();

  // No ?open= yet: pin the first row once, so later list refreshes never
  // swap the open chat. Laptop only (phones open a full page per chat).
  useEffect(() => {
    if (isPhone || openParam || listQ.isPlaceholderData || !items[0]) return;
    setQuery({ open: items[0].key });
  }, [isPhone, openParam, items, listQ.isPlaceholderData, setQuery]);

  const selectedKey = openParam && channelFromKey(openParam) ? openParam : null;
  const selectedChannel = selectedKey ? channelFromKey(selectedKey) : null;
  const inList = !!selectedKey && items.some((i) => i.key === selectedKey);

  const openRow = useCallback(
    (item: InboxItem) => {
      if (isPhone) {
        router.push(`/dashboard/inbox/${item.key}`);
        return;
      }
      setQuery({ open: item.key });
    },
    [isPhone, router, setQuery],
  );

  const goNext = useCallback(() => {
    if (!listQ.data?.nextCursor) return;
    setCursorStack((s) => [...s, cursor]);
    setCursor(listQ.data!.nextCursor);
  }, [listQ.data, cursor]);

  const goNewer = useCallback(() => {
    setCursorStack((s) => {
      if (s.length === 0) return s;
      const copy = [...s];
      const prev = copy.pop() ?? null;
      setCursor(prev);
      return copy;
    });
  }, []);

  const me = listQ.data?.me ?? "";
  const [ctxOpen, setCtxOpen] = useState(false);
  // A different conversation starts with the drawer closed (narrow laptops).
  useEffect(() => setCtxOpen(false), [selectedKey]);

  // The shell fills the rest of the viewport below the page header; each
  // column scrolls on its own. Measured (not a fixed calc) because the
  // header height changes with the summary line and section tabs.
  const shellRef = useRef<HTMLDivElement>(null);
  const [shellH, setShellH] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (isPhone) return;
    const measure = () => {
      const el = shellRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setShellH(Math.max(600, window.innerHeight - top - 20));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isPhone, listQ.isLoading]);

  const visibleViews = VIEWS.filter((v) => v.key !== "snoozed" || filter === "snoozed" || (counts?.snoozed ?? 0) > 0);

  const header = (
    <PageHeader
      crumb="Inbox"
      title="Live chats"
      summary={
        counts ? (
          <>
            <b>
              {counts.waiting} {counts.waiting === 1 ? "customer is" : "customers are"} waiting on a reply.
            </b>{" "}
            {counts.human} {counts.human === 1 ? "chat needs" : "chats need"} a person, {counts.bot.toLocaleString("en-IN")} with the bot.
          </>
        ) : undefined
      }
      actions={<AlertsControl />}
    />
  );

  if (listQ.isError && !listQ.data) {
    return (
      <div className="pm2-wide">
        {header}
        <div className="pm2-body pm2-wide">
          <Callout
            tone="crit"
            title="Couldn't load conversations"
            body={listQ.error instanceof Error ? listQ.error.message : "Something went wrong."}
            action={
              <button type="button" className="pm2-btn pri sm" onClick={() => listQ.refetch()}>
                Retry
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const ctxToggle = (
    <button type="button" className={`pm2-btn sm ghost ${st.ctxToggle}`} onClick={() => setCtxOpen((v) => !v)} aria-expanded={ctxOpen}>
      <UserRound width={15} height={15} /> Customer
    </button>
  );

  return (
    <div className="pm2-wide">
      {header}
      <div className={`${st.wrap} pm2-wide`}>
        <div ref={shellRef} className={`${st.shell}${ctxOpen ? ` ${st.ctxShown}` : ""}`} style={!isPhone && shellH ? { height: shellH } : undefined}>
          {/* ---- 1. conversation list ---- */}
          <section className={st.listCol} aria-label="Conversations">
            <div className={st.listHead}>
              <div className={st.views} role="tablist" aria-label="Views">
                {visibleViews.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    role="tab"
                    title={v.title}
                    aria-selected={filter === v.key}
                    className={`${st.view}${filter === v.key ? ` ${st.on}` : ""}${v.key === "waiting" && (counts?.waiting ?? 0) > 0 ? ` ${st.hot}` : ""}`}
                    onClick={() => setQuery({ filter: v.key })}
                  >
                    <span className={st.l}>{v.label}</span>
                    <span className={st.n}>{counts ? counts[v.key].toLocaleString("en-IN") : "·"}</span>
                  </button>
                ))}
              </div>
              <div className={st.chans} role="tablist" aria-label="Channel">
                {CHANNELS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    role="tab"
                    aria-selected={channel === c.key}
                    className={`${st.chan} ${st[`chan_${c.key}`]}${channel === c.key ? ` ${st.on}` : ""}`}
                    onClick={() => setQuery({ channel: c.key })}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <SearchBar value={qDraft} onChange={setQDraft} placeholder="Search name, phone, order…" />
            </div>
            <div className={st.rows}>
              {listQ.isLoading ? (
                <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="pm2-skel" style={{ minHeight: 72 }} />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className={st.empty}>{EMPTY_COPY[filter]}</div>
              ) : (
                items.map((item) => (
                  <ConvRow key={item.key} item={item} me={me} selected={!isPhone && item.key === selectedKey} onOpen={() => openRow(item)} />
                ))
              )}
            </div>
            <div className={st.listFoot}>
              <span>
                {total.toLocaleString("en-IN")} conversation{total === 1 ? "" : "s"}
                {filter === "waiting" ? ", longest wait first" : ""}
              </span>
              {cursorStack.length > 0 ? (
                <button type="button" className={st.pager} style={{ marginLeft: "auto" }} onClick={goNewer}>
                  ← Back
                </button>
              ) : null}
              {listQ.data?.nextCursor ? (
                <button type="button" className={st.pager} style={{ marginLeft: cursorStack.length > 0 ? 8 : "auto" }} onClick={goNext}>
                  Next 20 →
                </button>
              ) : null}
            </div>
          </section>

          {/* Phones get no pane: it is not mounted at all, so its conversation
              polling never runs in the background. Taps open the full page. */}
          {isPhone ? null : (
            <>
              {/* ---- 2. open conversation ---- */}
              <section className={st.convCol} aria-label="Conversation">
                {selectedKey && !inList && !listQ.isLoading ? (
                  <div className={st.outOfView} role="status">
                    This chat is not in the current view any more. It stays open until you pick another one.
                  </div>
                ) : null}
                {selectedKey ? (
                  selectedChannel === "wa" ? (
                    <WaConversation
                      key={selectedKey}
                      id={idFromKey(selectedKey)}
                      peek
                      compact
                      markRead
                      extraActions={ctxToggle}
                      onChanged={refreshList}
                      onArchived={() => setQuery({ open: null })}
                    />
                  ) : selectedChannel === "ig" ? (
                    <IgConversation key={selectedKey} id={idFromKey(selectedKey)} peek compact />
                  ) : (
                    <InlineEmailReview key={selectedKey} id={idFromKey(selectedKey)} extraActions={ctxToggle} onChanged={refreshList} />
                  )
                ) : (
                  <div className={st.empty}>Pick a conversation on the left.</div>
                )}
              </section>

              {/* ---- 3. customer context ---- */}
              <aside className={st.ctxCol} aria-label="Customer">
                {selectedKey && selectedChannel !== "ig" ? (
                  <CustomerContext key={selectedKey} conversationKey={selectedKey} onClose={ctxOpen ? () => setCtxOpen(false) : undefined} />
                ) : (
                  <div className={st.empty}>
                    {selectedKey ? "Customer details are not available for Instagram yet." : "The customer's orders, chats and tickets show here."}
                  </div>
                )}
              </aside>
              {ctxOpen ? <button type="button" className={st.scrim} aria-label="Close customer panel" onClick={() => setCtxOpen(false)} /> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- conversation row -----------------------------------------------------

const CHANNEL_KIND: Record<InboxItem["channel"], string> = { wa: "whatsapp", em: "email", ig: "instagram" };
const CHANNEL_WORD: Record<InboxItem["channel"], string> = { wa: "WhatsApp", em: "Email", ig: "Instagram" };

function ConvRow({ item, me, selected, onOpen }: { item: InboxItem; me: string; selected: boolean; onOpen: () => void }) {
  const mine = !!me && !!item.assignee && item.assignee.toLowerCase() === me.toLowerCase();
  const who = item.assignee ? (mine ? "You" : item.assignee.split("@")[0]) : null;
  const status = statusTag(item);
  const topic = topicTag(item.category);
  // The open chat is being read right now; its badge is cleared in the pane.
  const unread = !selected && item.unread > 0;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      className={`${st.row}${selected ? ` ${st.sel}` : ""}${unread ? ` ${st.unread}` : ""}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <Avatar name={item.name} channel={item.channel} size={40} />
      <div className={st.rowTx}>
        <div className={st.rowA}>
          <b>{item.name}</b>
          {unread ? <i className={st.dot} aria-label={`${item.unread} unread`} title={`${item.unread} unread`} /> : null}
          <time>{formatWhen(item.at)}</time>
        </div>
        <p>{item.preview || "No messages yet"}</p>
        <div className={st.rowM}>
          <Tag kind={CHANNEL_KIND[item.channel]} size="sm">
            {CHANNEL_WORD[item.channel]}
          </Tag>
          {status ? (
            <Tag tone={status.tone} size="sm">
              {status.text}
            </Tag>
          ) : null}
          {topic ? (
            <Tag tone={topic.tone} size="sm">
              {topic.text}
            </Tag>
          ) : null}
          {who ? (
            <span className={`${st.who}${mine ? ` ${st.whoMe}` : ""}`} title={`Assigned to ${item.assignee}`}>
              <UserRound width={13} height={13} aria-hidden="true" />
              {who}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
