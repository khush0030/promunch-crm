"use client";

// Instagram DM conversation view (Inbox redesign, Task 2.5). Same header,
// bubbles and composer shape as WhatsApp; sends go through
// POST /api/instagram/threads/[id]/reply {text}, which itself flips the
// thread to "human" (so the note under the header). No template, photo or
// COD actions on Instagram.

import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import { Bubbles } from "./Bubbles";
import { Composer } from "./Composer";
import { ConversationHeader } from "./ConversationHeader";
import { Callout } from "@/components/pm";
import { useMeEmail, useNow, useStickToBottom, useTeamMembers } from "./hooks";
import { AssignSelect, ConnectionNotice, NotFoundCard, patchThread, shareLink } from "./shared";
import { igBubbles, igReplyErrorCopy, waStatusPill, firstNameOf, NotFoundError, isNotFound, type IgMessageRow } from "@/lib/inbox/thread";

type IgThread = {
  id: string;
  handle: string | null;
  full_name: string | null;
  status: "bot" | "human";
  classification: string | null;
  followers: number | null;
  ticket_status: string | null;
  escalation_reason: string | null;
  assigned_to: string | null;
};

const REPLY_NOTE = "Replying here switches this chat to you.";

export function IgConversation({ id, peek = false, compact = false }: { id: string; peek?: boolean; compact?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMeEmail();
  const members = useTeamMembers();

  const threadQ = useQuery({
    queryKey: ["ig-thread-messages", id],
    queryFn: async (): Promise<{ thread: IgThread; messages: IgMessageRow[] }> => {
      const r = await fetch(`/api/instagram/threads/${id}${peek ? "?peek=1" : ""}`, { cache: "no-store" });
      if (r.status === 404) throw new NotFoundError();
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `thread ${r.status}`);
      return { thread: j.thread as IgThread, messages: (j.messages ?? []) as IgMessageRow[] };
    },
    // A real 404 is terminal (no polling); anything else is a transient poll
    // failure: keep the last data on screen and keep polling every 4s.
    retry: false,
    refetchInterval: (q) => (isNotFound(q.state.error) ? false : 4000),
  });
  const notFound = threadQ.isError && isNotFound(threadQ.error);
  const pollFailed = threadQ.isError && !notFound;
  const now = useNow(30_000);
  const thread = threadQ.data?.thread ?? null;
  const messages = useMemo(() => threadQ.data?.messages ?? [], [threadQ.data]);
  const items = useMemo(() => igBubbles(messages, now), [messages, now]);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [patching, setPatching] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastKey = messages.length ? messages[messages.length - 1].id : "empty";
  useStickToBottom(scrollRef, id, lastKey);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["ig-thread-messages", id] }), [qc, id]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (sending || !body) return;
    setSending(true);
    try {
      const r = await fetch(`/api/instagram/threads/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false || j.error) {
        toast.push({ kind: "error", text: igReplyErrorCopy(r.status, typeof j.error === "string" ? j.error : null) });
        return;
      }
      setText("");
      refresh();
    } catch (e) {
      toast.push({ kind: "error", text: "Reply failed: " + String(e) });
    } finally {
      setSending(false);
    }
  }, [text, sending, id, toast, refresh]);

  async function patch(p: Record<string, unknown>) {
    if (patching) return;
    setPatching(true);
    try {
      // The IG thread PATCH lives at /stage (status, assigned_to, resolve_ticket).
      await patchThread(`/api/instagram/threads/${id}/stage`, p, toast);
      await refresh();
    } finally {
      setPatching(false);
    }
  }

  if (notFound) return <NotFoundCard />;
  if (!thread && pollFailed) {
    return (
      <div className={compact ? undefined : "pm2-body"}>
        <Callout
          tone="crit"
          title="Could not load this conversation"
          body="Check the connection and try again."
          action={<button type="button" className="pm2-btn" onClick={() => threadQ.refetch()}>Retry</button>}
        />
      </div>
    );
  }
  if (!thread) {
    return <div className={compact ? undefined : "pm2-body"}><div className="pm2-skel" style={{ minHeight: 320 }} /></div>;
  }

  const handle = thread.handle ? `@${thread.handle.replace(/^@/, "")}` : "";
  const name = thread.full_name || handle || "Instagram chat";
  const pill = waStatusPill(thread.status);
  const ticketOpen = thread.ticket_status === "open" || thread.ticket_status === "pending";
  const btn = compact ? "pm2-btn sm" : "pm2-btn";
  const faint = ["Instagram", handle, thread.classification && thread.classification !== "unknown" ? thread.classification : null]
    .filter(Boolean)
    .join(" · ");

  const headerActions = (
    <>
      {thread.status === "bot" ? (
        <button type="button" className={btn} disabled={patching} onClick={() => patch({ status: "human" })}>Take over</button>
      ) : (
        <button type="button" className={btn} disabled={patching} onClick={() => patch({ status: "bot" })}>Hand back to bot</button>
      )}
      {ticketOpen ? (
        <button type="button" className={`${btn} ghost`} disabled={patching} onClick={() => patch({ resolve_ticket: true })}>Resolve</button>
      ) : null}
      <button type="button" className={`${btn} ghost`} onClick={() => shareLink(`/dashboard/inbox/ig-${id}`, toast)}>Share</button>
      <AssignSelect value={thread.assigned_to} members={members} disabled={patching} onChange={(email) => patch({ assigned_to: email })} />
    </>
  );

  const facts = (
    <>
      {handle ? <span><b>{handle}</b></span> : null}
      {typeof thread.followers === "number" ? <span><b className="num">{thread.followers.toLocaleString("en-IN")}</b> followers</span> : null}
      {thread.classification && thread.classification !== "unknown" ? <span>{thread.classification}</span> : null}
    </>
  );

  const note = (
    <>
      {ticketOpen ? <div>Ticket{thread.escalation_reason ? ` · ${thread.escalation_reason}` : ""}</div> : null}
      <div>{REPLY_NOTE}</div>
    </>
  );

  return (
    <div className={`pm2-thread${compact ? " compact" : ""}`}>
      <ConversationHeader
        compact={compact}
        channel="ig"
        name={name}
        crumb={`Inbox · Instagram · ${handle || "DM"}`}
        faint={faint}
        pill={pill}
        actions={headerActions}
        facts={facts}
        note={note}
      />
      <div className="pm2-thread-body">
        <div ref={scrollRef} className="pm2-thread-scroll">
          {items.length === 0 ? (
            <div style={{ padding: 24, color: "var(--pm-hint)", fontSize: 13.5 }}>No messages yet.</div>
          ) : (
            <Bubbles items={items} />
          )}
        </div>
        {pollFailed ? <ConnectionNotice /> : null}
        <div className="pm2-thread-foot">
          <Composer
            placeholder={`Reply as ${firstNameOf(me)}…`}
            value={text}
            onChange={setText}
            busy={sending}
            actions={null}
            onSend={send}
          />
        </div>
      </div>
    </div>
  );
}

export default IgConversation;
