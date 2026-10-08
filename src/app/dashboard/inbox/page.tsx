"use client";

// /dashboard/inbox: Live chats. One list across WhatsApp and support email
// (src/lib/inbox/conversations.ts / /api/inbox/conversations). Laptop is
// three panels filling the viewport, each scrolling on its own:
//   1. conversation list (channel switch All / WhatsApp / Email, views,
//      search, dense rows with channel colour + unread + assignee)
//   2. the open conversation (WaConversation/IgConversation in peek+compact
//      mode, or a lightweight email summary)
//   3. the customer panel (CustomerContext: orders, COD, WhatsApp, email,
//      tickets, tags), a drawer on narrow laptops
// Phone has the list only; taps navigate to the full conversation page. Opening the list, or the
// auto-selected first item, never marks anything read — only an explicit
// row click on a WA/IG row fires the one real (non-peek) GET that clears
// its unread badge (see openRow below).

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Inbox, UserRound } from "lucide-react";
import { PageHeader, Callout, Avatar } from "@/components/pm";
import { SearchBar } from "@/components/pm";
import { WaConversation } from "@/components/inbox/WaConversation";
import { IgConversation } from "@/components/inbox/IgConversation";
import { ConversationHeader } from "@/components/inbox/ConversationHeader";
import { AlertsControl } from "@/components/inbox/AlertsControl";
import { CustomerContext } from "@/components/inbox/CustomerContext";
import { ChannelIcon, ChannelTag } from "@/components/inbox/ChannelTag";
import { categoryWord } from "@/components/inbox/labels";
import { formatWhen } from "@/lib/inbox/when";
import { useMediaPhone } from "@/components/shell/useMediaPhone";
import type { InboxFilter, InboxItem } from "@/lib/inbox/conversations";
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
const CHANNELS: { key: "all" | "wa" | "em"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "wa", label: "WhatsApp" },
  { key: "em", label: "Email" },
];

const FILTER_CHIPS: { key: InboxFilter; label: string }[] = [
  { key: "human", label: "Need a human" },
  { key: "mine", label: "Mine" },
  { key: "bot", label: "Bot" },
  { key: "all", label: "All" },
];

const EMPTY_COPY: Record<InboxFilter, string> = {
  human: "Nobody is waiting on a person right now.",
  mine: "Nothing assigned to you.",
  bot: "No conversations match.",
  all: "No conversations match.",
};

function parseFilter(raw: string | null): InboxFilter {
  return raw === "mine" || raw === "bot" || raw === "all" ? raw : "human";
}
function parseChannel(raw: string | null): Channel {
  return raw === "wa" || raw === "ig" || raw === "em" ? raw : "all";
}

// The list item's key is always "<2-letter prefix>-<id>" (wa-/ig-/em-).
function idFromKey(key: string): string {
  return key.slice(3);
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
    <div className="pm2-body">
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
      if (f === "human") sp.delete("filter");
      else sp.set("filter", f);
      if (c === "all") sp.delete("channel");
      else sp.set("channel", c);
      if (query) sp.set("q", query);
      else sp.delete("q");
      if (open) sp.set("open", open);
      else sp.delete("open");
      const qs = sp.toString();
      router.replace(`/dashboard/inbox${qs ? `?${qs}` : ""}`);
    },
    [params, filter, channel, q, openParam, router],
  );

  // Filter/channel/search define a new result set — the cursor stack from
  // the old one no longer means anything, so paging always restarts at
  // page 1. Runs on mount too, which is a harmless no-op (both already
  // start empty).
  useEffect(() => {
    setCursor(null);
    setCursorStack([]);
  }, [filter, channel, q]);

  // Search box: debounce keystrokes 250ms before committing to the URL
  // (and therefore the query key) — the API call, not just the input, is
  // what's debounced.
  useEffect(() => {
    const t = setTimeout(() => {
      if (qDraft !== q) setQuery({ q: qDraft });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft]);
  // Keep the draft in sync when q changes from outside typing (back/forward
  // nav, a shared link with ?q=).
  useEffect(() => {
    setQDraft(q);
  }, [q]);

  const listQ = useQuery({
    queryKey: ["inbox-list", filter, channel, q, cursor],
    queryFn: async (): Promise<InboxListResponse> => {
      const sp = new URLSearchParams();
      sp.set("filter", filter);
      sp.set("channel", channel);
      if (q) sp.set("q", q);
      if (cursor) sp.set("cursor", cursor);
      sp.set("limit", "20");
      const r = await fetch(`/api/inbox/conversations?${sp.toString()}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `inbox ${r.status}`);
      return j as InboxListResponse;
    },
    refetchInterval: 4000,
    placeholderData: keepPreviousData,
  });

  const items = useMemo(() => listQ.data?.items ?? [], [listQ.data]);
  const counts = listQ.data?.counts;
  const total = listQ.data?.total ?? 0;

  // The pane's selection: an explicit ?open= if it's still in the current
  // page, otherwise the first item (peek-only — never fires the unread
  // clear below).
  const selectedKey = useMemo(() => {
    if (openParam && items.some((i) => i.key === openParam)) return openParam;
    return items[0]?.key ?? null;
  }, [openParam, items]);
  const selectedItem = items.find((i) => i.key === selectedKey) ?? null;

  const isPhone = useMediaPhone();
  const openRow = useCallback(
    (item: InboxItem) => {
      if (isPhone) {
        router.push(`/dashboard/inbox/${item.key}`);
        return;
      }
      setQuery({ open: item.key });
      if ((item.channel === "wa" || item.channel === "ig") && item.unread > 0) {
        const path = item.channel === "wa" ? `/api/whatsapp/threads/${idFromKey(item.key)}` : `/api/instagram/threads/${idFromKey(item.key)}`;
        fetch(path, { cache: "no-store" })
          .catch(() => undefined)
          .finally(() => qc.invalidateQueries({ queryKey: ["inbox-list"] }));
      }
    },
    [isPhone, router, setQuery, qc],
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
      setShellH(Math.max(560, window.innerHeight - top - 20));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isPhone, listQ.isLoading]);

  const header = (
    <PageHeader
      crumb="Inbox"
      title="Live chats"
      summary={
        counts ? (
          <>
            <b>
              {counts.human} {counts.human === 1 ? "chat needs" : "chats need"} a human.
            </b>{" "}
            {counts.bot.toLocaleString("en-IN")} {counts.bot === 1 ? "chat is" : "chats are"} with the bot.
          </>
        ) : undefined
      }
      actions={<AlertsControl />}
    />
  );

  if (listQ.isError && !listQ.data) {
    return (
      <>
        {header}
        <div className="pm2-body">
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
      </>
    );
  }

  const ctxToggle = (
    <button type="button" className={`pm2-btn sm ghost ${st.ctxToggle}`} onClick={() => setCtxOpen((v) => !v)} aria-expanded={ctxOpen}>
      <UserRound width={15} height={15} /> Customer
    </button>
  );

  return (
    <>
      {header}
      <div className={st.wrap}>
        <div ref={shellRef} className={`${st.shell}${ctxOpen ? ` ${st.ctxShown}` : ""}`} style={!isPhone && shellH ? { height: shellH } : undefined}>
          {/* ---- 1. conversation list ---- */}
          <section className={st.listCol} aria-label="Conversations">
            <div className={st.listHead}>
              <div className={st.seg} role="tablist" aria-label="Channel">
                {CHANNELS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    role="tab"
                    aria-selected={channel === c.key}
                    className={`${st.segBtn} ${st[`seg_${c.key}`]}${channel === c.key ? ` ${st.on}` : ""}`}
                    onClick={() => setQuery({ channel: c.key })}
                  >
                    {c.key === "all" ? <Inbox width={15} height={15} aria-hidden="true" /> : <ChannelIcon channel={c.key} size={15} />}
                    {c.label}
                  </button>
                ))}
              </div>
              <div className={st.views} role="tablist" aria-label="Filter conversations">
                {FILTER_CHIPS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.key}
                    className={`${st.view}${filter === f.key ? ` ${st.on}` : ""}`}
                    onClick={() => setQuery({ filter: f.key })}
                  >
                    <span className={st.n}>{counts ? counts[f.key].toLocaleString("en-IN") : "·"}</span>
                    <span className={st.l}>{f.label}</span>
                  </button>
                ))}
              </div>
              <SearchBar value={qDraft} onChange={setQDraft} placeholder="Search name, phone, order…" />
            </div>
            <div className={st.rows}>
              {listQ.isLoading ? (
                <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="pm2-skel" style={{ minHeight: 58 }} />
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
              </span>
              {cursorStack.length > 0 ? (
                <button type="button" className={st.pager} style={{ marginLeft: "auto" }} onClick={goNewer}>
                  ← Newer
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
                {selectedItem ? (
                  selectedItem.channel === "wa" ? (
                    <WaConversation id={idFromKey(selectedItem.key)} peek compact extraActions={ctxToggle} />
                  ) : selectedItem.channel === "ig" ? (
                    <IgConversation id={idFromKey(selectedItem.key)} peek compact />
                  ) : (
                    <EmailPane id={idFromKey(selectedItem.key)} extraActions={ctxToggle} />
                  )
                ) : (
                  <div className={st.empty}>Pick a conversation on the left.</div>
                )}
              </section>

              {/* ---- 3. customer context ---- */}
              <aside className={st.ctxCol} aria-label="Customer">
                {selectedItem && selectedItem.channel !== "ig" ? (
                  <CustomerContext key={selectedItem.key} conversationKey={selectedItem.key} onClose={ctxOpen ? () => setCtxOpen(false) : undefined} />
                ) : (
                  <div className={st.empty}>
                    {selectedItem ? "Customer details are not available for Instagram yet." : "The customer's orders, chats and tickets show here."}
                  </div>
                )}
              </aside>
              {ctxOpen ? <button type="button" className={st.scrim} aria-label="Close customer panel" onClick={() => setCtxOpen(false)} /> : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ---- conversation row -----------------------------------------------------

const PILL_TONE: Record<InboxItem["pill"]["tone"], string> = {
  crit: st.tCrit,
  warn: st.tWarn,
  good: st.tGood,
  info: st.tInfo,
  neu: st.tNeu,
};

function ConvRow({ item, me, selected, onOpen }: { item: InboxItem; me: string; selected: boolean; onOpen: () => void }) {
  const mine = !!me && item.assignee === me;
  const who = item.assignee ? (mine ? "You" : item.assignee.split("@")[0]) : null;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      className={`${st.row} ${st[`row_${item.channel}`]}${selected ? ` ${st.sel}` : ""}${item.unread > 0 ? ` ${st.unread}` : ""}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <Avatar name={item.name} channel={item.channel} size={34} />
      <div className={st.rowTx}>
        <div className={st.rowA}>
          <b>{item.name}</b>
          <time>{formatWhen(item.at)}</time>
        </div>
        <p>{item.preview || "No messages yet"}</p>
        <div className={st.rowM}>
          <ChannelTag channel={item.channel} />
          <span className={`${st.state} ${PILL_TONE[item.pill.tone]}`}>{item.pill.text}</span>
          {who ? (
            <span className={`${st.who}${mine ? ` ${st.whoMe}` : ""}`} title={`Assigned to ${item.assignee}`}>
              <UserRound width={12} height={12} aria-hidden="true" />
              {who}
            </span>
          ) : null}
          {item.unread > 0 ? <span className={st.badge} aria-label={`${item.unread} unread`}>{item.unread}</span> : null}
        </div>
      </div>
    </div>
  );
}

// ---- email pane -----------------------------------------------------------

type EmailThreadFull = {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  body_plain: string | null;
  created_at: string;
  lead_category: string | null;
};
type EmailDraft = { id: string; body: string; is_current: boolean };

function EmailPane({ id, extraActions }: { id: string; extraActions?: ReactNode }) {
  const q = useQuery({
    queryKey: ["inbox-email-pane", id],
    queryFn: async (): Promise<{ thread: EmailThreadFull; drafts: EmailDraft[] }> => {
      const r = await fetch(`/api/support-emails/${id}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `email ${r.status}`);
      return j;
    },
    staleTime: 30_000,
  });

  if (q.isLoading) {
    return (
      <div style={{ padding: 20 }}>
        <div className="pm2-skel" style={{ minHeight: 240 }} />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div style={{ padding: 20 }}>
        <Callout
          tone="crit"
          title="Could not load this email"
          action={
            <button type="button" className="pm2-btn sm" onClick={() => q.refetch()}>
              Retry
            </button>
          }
        />
      </div>
    );
  }

  const { thread, drafts } = q.data;
  const currentDraft = drafts.find((d) => d.is_current) || drafts[0] || null;
  const name = thread.from_name?.trim() || thread.from_email;

  return (
    <div className="pm2-thread compact">
      <ConversationHeader
        compact
        channel="em"
        name={name}
        crumb={`Inbox · Email · ${thread.from_email}`}
        faint={`${thread.subject || "(no subject)"} · ${formatWhen(thread.created_at)}`}
        pill={{ tone: "neu", text: categoryWord(thread.lead_category) }}
        actions={
          <>
            <Link className="pm2-btn sm" href={`/dashboard/inbox/email?id=${encodeURIComponent(id)}`}>
              Open in Email drafts
            </Link>
            {extraActions}
          </>
        }
      />
      <div className={st.mail}>
        <div className={st.mailMsg}>
          <div className={st.mailMeta}>
            <b>{name}</b>
            <span>{thread.from_email}</span>
            <time>{formatWhen(thread.created_at)}</time>
          </div>
          <h3>{thread.subject || "(no subject)"}</h3>
          <div className={st.mailBody}>{thread.body_plain || thread.snippet || "No preview available."}</div>
        </div>
        {currentDraft ? (
          <div className={st.mailDraft}>
            <div className={st.mailDraftH}>Reply drafted by the bot · approve it in Email drafts</div>
            <div className={st.mailBody}>{currentDraft.body}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
