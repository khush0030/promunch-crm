"use client";

// /dashboard/inbox — Conversations (Task 2.4). One list across WhatsApp,
// Instagram and support email (src/lib/inbox/conversations.ts /
// /api/inbox/conversations, Tasks 2.2/2.3). Laptop shows a right pane with
// the selected conversation (WaConversation/IgConversation in peek+compact
// mode, or a lightweight email summary); phone has no pane and taps
// navigate to the full conversation page. Opening the list, or the
// auto-selected first item, never marks anything read — only an explicit
// row click on a WA/IG row fires the one real (non-peek) GET that clears
// its unread badge (see openRow below).

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { PageHeader, Chips, ListRow, Pill, Callout } from "@/components/pm";
import type { ChipItem } from "@/components/pm";
import { SearchBar } from "@/components/pm";
import { WaConversation } from "@/components/inbox/WaConversation";
import { IgConversation } from "@/components/inbox/IgConversation";
import { ConversationHeader } from "@/components/inbox/ConversationHeader";
import { AlertsToggle } from "@/components/whatsapp/InboxNotifier";
import { categoryWord } from "@/components/inbox/labels";
import { formatWhen } from "@/lib/inbox/when";
import { useMediaPhone } from "@/components/shell/useMediaPhone";
import type { InboxFilter, InboxItem } from "@/lib/inbox/conversations";

type Channel = "all" | "wa" | "ig" | "em";

type InboxListResponse = {
  items: InboxItem[];
  counts: Record<InboxFilter, number>;
  total: number;
  nextCursor: string | null;
  me: string;
};

const FILTER_CHIPS: { key: InboxFilter; label: string }[] = [
  { key: "human", label: "Needs a human" },
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

  const chipItems: ChipItem[] = FILTER_CHIPS.map((f) => ({ key: f.key, label: f.label, count: counts?.[f.key] }));

  const channelSelect = (className: string) => (
    <select
      className={`pm2-btn ${className}`}
      aria-label="Channel"
      value={channel}
      onChange={(e) => setQuery({ channel: e.target.value as Channel })}
    >
      <option value="all">All channels</option>
      <option value="wa">WhatsApp</option>
      {/* Instagram hidden until its backend is live; see nav.ts Partners hub. */}
      <option value="em">Email</option>
    </select>
  );

  const header = (
    <PageHeader
      crumb="Inbox"
      title="Conversations"
      actions={
        <>
          <Chips items={chipItems} value={filter} onChange={(k) => setQuery({ filter: k as InboxFilter })} ariaLabel="Filter conversations" />
          {channelSelect("pm2-d-only")}
          <AlertsToggle />
        </>
      }
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

  return (
    <>
      {header}
      <div className="pm2-body">
        <div className="pm2-inbox-grid" style={{ display: "grid", gap: 0 }}>
          <div className="pm2-panel pm2-inbox-list" style={{ borderRadius: 0, borderWidth: "0 1px 0 0" }}>
            <div className="pm2-p-body" style={{ padding: "12px 14px 6px" }}>
              <SearchBar value={qDraft} onChange={setQDraft} placeholder="Search name, phone, order…" />
              <div style={{ marginTop: 8 }}>{channelSelect("pm2-m-only")}</div>
            </div>
            {listQ.isLoading ? (
              <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="pm2-skel" style={{ minHeight: 54 }} />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: "28px 16px", color: "var(--pm-hint)", fontSize: 13.5 }}>{EMPTY_COPY[filter]}</div>
            ) : (
              items.map((item) => (
                <ListRow
                  key={item.key}
                  name={item.name}
                  pill={
                    <Pill tone={item.pill.tone} plain>
                      {item.pill.text}
                    </Pill>
                  }
                  preview={item.preview}
                  when={formatWhen(item.at)}
                  unread={item.unread}
                  channel={item.channel}
                  selected={item.key === selectedKey}
                  onClick={() => openRow(item)}
                />
              ))
            )}
            <div className="pm2-p-foot">
              <span>
                {total} conversation{total === 1 ? "" : "s"}
              </span>
              {cursorStack.length > 0 ? (
                <button type="button" className="pm2-lnk" style={{ background: "none", border: 0, cursor: "pointer", marginLeft: "auto" }} onClick={goNewer}>
                  ← Newer
                </button>
              ) : null}
              {listQ.data?.nextCursor ? (
                <button
                  type="button"
                  className="pm2-lnk"
                  style={{ background: "none", border: 0, cursor: "pointer", marginLeft: cursorStack.length > 0 ? 8 : "auto" }}
                  onClick={goNext}
                >
                  Next 20 →
                </button>
              ) : null}
            </div>
          </div>
          {/* Phones get no pane: it is not mounted at all, so its conversation
              polling never runs in the background. */}
          {isPhone ? null : (
          <div className="pm2-d-only pm2-inbox-pane">
            {selectedItem ? (
              selectedItem.channel === "wa" ? (
                <WaConversation id={idFromKey(selectedItem.key)} peek compact />
              ) : selectedItem.channel === "ig" ? (
                <IgConversation id={idFromKey(selectedItem.key)} peek compact />
              ) : (
                <EmailPane id={idFromKey(selectedItem.key)} />
              )
            ) : (
              <div style={{ padding: 24, color: "var(--pm-hint)", fontSize: 13.5 }}>Select a conversation.</div>
            )}
          </div>
          )}
        </div>
      </div>
    </>
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

function EmailPane({ id }: { id: string }) {
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
          <Link className="pm2-btn sm" href={`/dashboard/inbox/email?id=${encodeURIComponent(id)}`}>
            Open in Email drafts
          </Link>
        }
      />
      <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
        <div style={{ fontWeight: 650, marginBottom: 8, fontSize: 14.5 }}>{thread.subject || "(no subject)"}</div>
        <div style={{ fontSize: 13.5, color: "var(--pm-ink)", whiteSpace: "pre-wrap" }}>{thread.body_plain || thread.snippet || "No preview available."}</div>
        {currentDraft ? (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12.5, color: "var(--pm-hint)", marginBottom: 6 }}>Current draft</div>
            <div className="pm-draftbox">{currentDraft.body}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
