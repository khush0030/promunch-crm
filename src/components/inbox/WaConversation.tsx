"use client";

// WhatsApp conversation view (Inbox redesign, Task 2.5). Full page when
// mounted by /dashboard/inbox/[id]; `compact` when embedded in the
// Conversations list pane. Every customer-visible send goes through
// POST /api/whatsapp/send with the SAME body the old InboxView sends (only
// sent_by differs: the signed-in user's email instead of a hardcoded one),
// so the route's atomic 90s dedup claim keeps protecting the customer.
// Header buttons only PATCH thread state; none of them message anyone.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog, Callout, Tag } from "@/components/pm";
import { Bubbles } from "./Bubbles";
import { Composer } from "./Composer";
import { TemplatePicker } from "./TemplatePicker";
import { ConversationHeader } from "./ConversationHeader";
import { useDocVisible, useMeEmail, useNow, useStickToBottom, useTeamMembers } from "./hooks";
import { AssignSelect, ConnectionNotice, NotFoundCard, patchThread, shareLink } from "./shared";
import { windowLeftMs } from "@/components/whatsapp/WindowTimer";
import { TicketProperties, WindowStrip } from "./TicketSide";
import { CustomerContext, TONE_TAG, useInboxContext } from "./CustomerContext";
import { topicTag } from "./labels";
import t from "./ticket.module.css";
import type { Template, Thread } from "@/components/whatsapp/types";
import { formatINR } from "@/lib/metrics/money";
import {
  waBubbles,
  maskPhone,
  firstNameOf,
  latestInboundAt,
  waitingCodOrder,
  orderLabel,
  NotFoundError,
  isNotFound,
  type WaMessageRow,
  type WaCallRow,
  type CodGateOrder,
} from "@/lib/inbox/thread";

type ThreadRow = Thread & { ticket_opened_at?: string | null };

const WINDOW_CLOSED = "24-hour window closed. Send a template to restart the chat.";
const DUPLICATE_TOAST = "Already sent a moment ago, not sent again.";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Typed-but-unsent replies, per chat, for this browser tab. Switching to
// another chat and back restores the draft; it never follows you to a
// different customer (the component is keyed by thread id).
const drafts = new Map<string, string>();

type Confirm = "handback" | "resolve" | "archive" | null;
export function WaConversation({
  id,
  peek = false,
  compact = false,
  markRead = false,
  extraActions,
  onChanged,
  onArchived,
}: {
  id: string;
  peek?: boolean;
  compact?: boolean;
  /** this chat is on screen in Live chats: clear its unread badge when new messages land (only while the tab is visible) */
  markRead?: boolean;
  /** extra header buttons from the host page (UI only, e.g. "Customer" drawer toggle) */
  extraActions?: ReactNode;
  /** the host should refresh its list and counts (an action changed this chat) */
  onChanged?: () => void;
  /** the chat was archived (the host may close the pane) */
  onArchived?: () => void;
}) {
  const toast = useToast();
  const [makingDeal, setMakingDeal] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMeEmail();
  const members = useTeamMembers();

  const threadQ = useQuery({
    queryKey: ["wa-thread-messages", id],
    queryFn: async (): Promise<{ thread: ThreadRow; messages: WaMessageRow[]; calls?: WaCallRow[] }> => {
      const r = await fetch(`/api/whatsapp/threads/${id}${peek ? "?peek=1" : ""}`, { cache: "no-store" });
      if (r.status === 404) throw new NotFoundError();
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `thread ${r.status}`);
      return { thread: j.thread as ThreadRow, messages: (j.messages ?? []) as WaMessageRow[], calls: (j.calls ?? []) as WaCallRow[] };
    },
    // A 404 before anything loaded is terminal (no polling). The WA route also
    // answers 404 for any database error, so once the thread has loaded a 404
    // is treated like any other transient poll failure: keep the last data on
    // screen and keep polling every 4s.
    retry: false,
    refetchInterval: (q) => (isNotFound(q.state.error) && !q.state.data ? false : 4000),
  });
  const notFound = threadQ.isError && isNotFound(threadQ.error) && !threadQ.data;
  const pollFailed = threadQ.isError && !notFound;
  const now = useNow(30_000);
  const thread = threadQ.data?.thread ?? null;
  const messages = useMemo(() => threadQ.data?.messages ?? [], [threadQ.data]);

  // Same query (and numbers) as the customer panel next to it.
  const ctxQ = useInboxContext(`wa-${id}`);

  const codQ = useQuery({
    queryKey: ["cod-gate-orders", 168],
    queryFn: async (): Promise<CodGateOrder[]> => {
      const r = await fetch("/api/whatsapp/cod-gate?hours=168");
      const j = await r.json();
      return r.ok ? ((j.orders ?? []) as CodGateOrder[]) : [];
    },
    staleTime: 60_000,
  });

  const templatesQ = useQuery({
    queryKey: ["wa-templates-approved"],
    queryFn: async (): Promise<Template[]> => {
      const r = await fetch("/api/whatsapp/templates?status=approved");
      const j = await r.json();
      return (j.templates ?? []) as Template[];
    },
    staleTime: 5 * 60_000,
  });

  // ---- derived -----------------------------------------------------------
  const calls = useMemo(() => threadQ.data?.calls ?? [], [threadQ.data]);
  const items = useMemo(() => waBubbles(messages, thread, now, calls), [messages, thread, now, calls]);
  const lastInbound = useMemo(() => latestInboundAt(thread?.last_inbound_at, messages), [thread?.last_inbound_at, messages]);
  const windowOpen = (windowLeftMs(lastInbound, now) ?? 0) > 0;
  const codOrder = useMemo(() => waitingCodOrder(codQ.data ?? [], thread?.wa_id), [codQ.data, thread?.wa_id]);
  const ticketOpen = thread?.ticket_status === "open" || thread?.ticket_status === "pending";
  const name = thread?.contact?.name || thread?.contact?.phone || "WhatsApp chat";
  const firstName = firstNameOf(me);

  const ctx = ctxQ.data ?? null;
  const orderCount = ctx?.stats.orders ?? null;
  const orderTotal = ctx?.stats.spent ?? 0;
  const city = ctx?.person.city ?? null;
  const owner = thread ? (thread.assigned_to ?? thread.ticket_assignee ?? null) : null;

  // ---- unread: clear it while this chat is on screen ----------------------
  const visible = useDocVisible();
  const unread = thread?.unread_count ?? 0;
  const markingRef = useRef(false);
  useEffect(() => {
    if (!markRead || !peek || unread <= 0 || !visible || markingRef.current) return;
    markingRef.current = true;
    // The one non-peek GET is what resets unread_count (same as opening the
    // chat on its own page). Read-only otherwise; nothing is sent.
    fetch(`/api/whatsapp/threads/${id}`, { cache: "no-store" })
      .catch(() => undefined)
      .finally(() => {
        markingRef.current = false;
        onChanged?.();
      });
  }, [markRead, peek, unread, visible, id, onChanged]);

  // ---- composer state ----------------------------------------------------
  const [text, setTextState] = useState(() => drafts.get(id) ?? "");
  const setText = useCallback(
    (v: string) => {
      setTextState(v);
      if (v) drafts.set(id, v);
      else drafts.delete(id);
    },
    [id],
  );
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachment, setAttachment] = useState<{ url: string; name: string } | null>(null);
  const [pickingTemplate, setPickingTemplate] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [confirmCod, setConfirmCod] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [patching, setPatching] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  // setSending is async, so two clicks in the same tick both pass the state
  // check. The ref flips synchronously and is the real in-flight guard.
  const sendingRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastKey = messages.length ? messages[messages.length - 1].id : "empty";
  useStickToBottom(scrollRef, id, lastKey);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["wa-thread-messages", id] }), [qc, id]);

  // Mirrors InboxView.send(): same body shape, same guards; sent_by is the
  // signed-in email. The box is cleared only once the send is accepted.
  const send = useCallback(
    async (kind: "text" | "template", payload?: { name: string; language: string; vars: Record<string, string> }) => {
      if (sendingRef.current || uploading) return;
      if (!me) {
        toast.push({ kind: "error", text: "Still signing you in. Try again in a moment." });
        return;
      }
      sendingRef.current = true;
      setSending(true);
      try {
        const body =
          kind === "text"
            ? attachment
              ? { thread_id: id, kind: "image", image: { link: attachment.url, caption: text.trim() || undefined }, sent_by: me }
              : { thread_id: id, kind, text, sent_by: me }
            : { thread_id: id, kind: "template", template: payload, sent_by: me };
        const r = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({}));
        if (j.ok === false || j.error || !r.ok) {
          toast.push({ kind: "error", text: "Send failed: " + (j.error ?? `HTTP ${r.status}`) });
          return;
        }
        if (j.skipped) {
          toast.push({ kind: "info", text: DUPLICATE_TOAST });
        }
        setText("");
        setAttachment(null);
        setPickingTemplate(false);
        refresh();
      } catch (e) {
        toast.push({ kind: "error", text: "Send failed: " + String(e) });
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [uploading, me, attachment, id, text, toast, refresh, setText],
  );

  async function pickImage(file: File | null) {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      toast.push({ kind: "error", text: "Only JPG or PNG photos can be sent." });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.push({ kind: "error", text: "Photo is over 5 MB. Pick a smaller one." });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("format", "IMAGE");
      const r = await fetch("/api/whatsapp/media-upload", { method: "POST", body: fd });
      const j = await r.json();
      if (j.error) {
        toast.push({ kind: "error", text: j.error });
        return;
      }
      setAttachment({ url: j.url, name: file.name });
    } catch (e) {
      toast.push({ kind: "error", text: "Upload failed: " + String(e) });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function patch(p: Partial<Thread> & { archived?: boolean }, done?: string): Promise<boolean> {
    if (patching) return false;
    setPatching(true);
    try {
      const ok = await patchThread(`/api/whatsapp/threads/${id}`, p, toast);
      if (ok && done) toast.push({ kind: "success", text: done });
      await refresh();
      qc.invalidateQueries({ queryKey: ["tickets-board"] });
      qc.invalidateQueries({ queryKey: ["inbox-context", `wa-${id}`] });
      onChanged?.();
      return ok;
    } finally {
      setPatching(false);
    }
  }

  // Take over: the bot stops replying in this chat (status "human", same as
  // before) and the chat is assigned to you, so it shows under Mine.
  function takeOver() {
    const body: Partial<Thread> = { status: "human" };
    if (me) body.assigned_to = me;
    void patch(body, me ? "You took over. The bot is paused here and the chat is assigned to you." : "You took over. The bot is paused here.");
  }

  async function runConfirm() {
    const what = confirm;
    if (!what) return;
    if (what === "handback") await patch({ status: "bot" }, "Handed back. The bot will answer this customer's next messages.");
    if (what === "resolve") await patch({ ticket_status: "resolved" }, "Ticket marked solved. Hand back to bot when you are done.");
    if (what === "archive") {
      const ok = await patch({ archived: true }, "Chat archived. It comes back if the customer writes again.");
      if (ok) onArchived?.();
    }
    setConfirm(null);
  }

  async function draftReply() {
    setDrafting(true);
    try {
      const r = await fetch(`/api/whatsapp/threads/${id}/draft`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (j.error) {
        toast.push({ kind: "error", text: "AI draft failed: " + j.error });
        return;
      }
      if (j.action === "escalate") {
        toast.push({ kind: "info", text: "The bot suggests a person handles this: " + (j.reason || "needs a person") });
        return;
      }
      if (j.draft) setText(j.draft);
      else toast.push({ kind: "info", text: "The bot had no draft for this." });
    } finally {
      setDrafting(false);
    }
  }

  async function confirmCodOrder() {
    if (!codOrder || confirming) return;
    setConfirming(true);
    try {
      const r = await fetch("/api/whatsapp/cod-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopify_id: String(codOrder.shopify_id), action: "confirm" }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 403) {
        toast.push({ kind: "error", text: "Only an admin can confirm orders." });
        return;
      }
      if (!r.ok || j.ok === false || j.error) {
        toast.push({ kind: "error", text: "Could not confirm: " + (j.error ?? `HTTP ${r.status}`) });
        return;
      }
      toast.push({ kind: "success", text: `Order ${orderLabel(codOrder.order_number)} confirmed and released for shipping.` });
      setConfirmCod(false);
      qc.invalidateQueries({ queryKey: ["cod-gate-orders"] });
    } finally {
      setConfirming(false);
    }
  }

  // ---- render ------------------------------------------------------------
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

  // Wholesale / partnership chats become a deal in one click. POST /api/deals
  // returns the existing open deal for this chat or number instead of a
  // duplicate, and never messages anyone.
  async function makeDeal() {
    if (!thread || makingDeal) return;
    setMakingDeal(true);
    try {
      const cat = (thread.ticket_category || "").toLowerCase();
      const r = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: thread.contact?.name || null,
          contact_name: thread.contact?.name || null,
          contact_phone: thread.contact?.phone || thread.wa_id,
          kind: cat.includes("partner") ? "partnership" : "wholesale",
          stage: "talking",
          notes: thread.last_message_snippet ? `From WhatsApp: ${thread.last_message_snippet}` : "From WhatsApp chat",
          source: "whatsapp",
          source_ref: thread.id,
        }),
      });
      const j = await r.json().catch(() => ({}));
      const dealId = j?.deal?.id;
      if (!r.ok || !dealId) throw new Error(j?.error || `deal ${r.status}`);
      toast.push({ kind: "success", text: j.existing ? "This chat already has a deal. Opening it." : "Deal created." });
      router.push(`/dashboard/deals?deal=${dealId}`);
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error && e.message.includes("403") ? "You don't have access to Deals." : "Couldn't make the deal. Try again." });
    } finally {
      setMakingDeal(false);
    }
  }

  // Same control + handler in both layouts: the header in compact mode, the
  // "Assigned to" property tile on the full page. Writes assigned_to; the
  // route mirrors it into ticket_assignee so every Inbox screen agrees.
  const assignSelect = (
    <AssignSelect value={owner} members={members} disabled={patching} onChange={(email) => patch({ assigned_to: email || null })} />
  );
  const btn = compact ? "pm2-btn sm" : "pm2-btn";
  const headerActions = (
    <>
      {thread.status === "human" ? (
        <button type="button" className={btn} disabled={patching} onClick={() => setConfirm("handback")}>Hand back to bot</button>
      ) : thread.status === "closed" ? null : (
        // bot or snoozed: a person can pick the chat up
        <button type="button" className={`${btn} pri`} disabled={patching} onClick={takeOver}>Take over</button>
      )}
      {ticketOpen ? (
        <button type="button" className={btn} disabled={patching} onClick={() => setConfirm("resolve")}>Mark solved</button>
      ) : null}
      <button type="button" className={`${btn} ghost`} disabled={makingDeal} onClick={makeDeal}>
        {makingDeal ? "Opening deal…" : "Make it a deal"}
      </button>
      <button type="button" className={`${btn} ghost`} onClick={() => shareLink(`/dashboard/inbox/wa-${id}`, toast)}>Share</button>
      <button type="button" className={`${btn} ghost`} disabled={patching} onClick={() => setConfirm("archive")}>Archive</button>
      {compact ? assignSelect : null}
      {extraActions}
    </>
  );

  const statusTagEl =
    thread.status === "bot" ? (
      <Tag kind="bot" size="sm">Bot is replying</Tag>
    ) : thread.status === "human" ? (
      <Tag tone="amber" size="sm">A person is replying</Tag>
    ) : thread.status === "snoozed" ? (
      <Tag kind="snoozed" size="sm">Snoozed</Tag>
    ) : (
      <Tag kind="closed" size="sm">Closed</Tag>
    );
  const topic = topicTag(thread.ticket_category);
  const ownerName = owner ? (owner === me ? "You" : members.find((m) => m.email === owner)?.name || owner.split("@")[0]) : null;
  const headerTags = (
    <>
      {statusTagEl}
      {ticketOpen ? (
        <Tag tone={thread.ticket_status === "pending" ? "amber" : "red"} size="sm">
          {thread.ticket_status === "pending" ? `Ticket #${thread.ticket_number}, waiting on customer` : `Ticket #${thread.ticket_number}`}
        </Tag>
      ) : null}
      {topic ? <Tag tone={topic.tone} size="sm">{topic.text}</Tag> : null}
      {ownerName ? <Tag tone="grey" size="sm">{`Owner: ${ownerName}`}</Tag> : null}
    </>
  );

  const factsLine = [
    "WhatsApp",
    city,
    orderCount != null ? `${orderCount} ${orderCount === 1 ? "order" : "orders"}${orderTotal ? ` · ${formatINR(orderTotal)}` : ""}` : null,
  ].filter(Boolean).join(" · ");

  const codTag = ctx?.cod ? (
    <Tag tone={TONE_TAG[ctx.cod.tone]} size="sm">{`COD ${ctx.cod.orderNumber}: ${ctx.cod.text}`}</Tag>
  ) : null;
  const facts = (
    <>
      <span>{maskPhone(thread.contact?.phone || thread.wa_id)}</span>
      {city ? <span><b>{city}</b></span> : null}
      {orderCount != null ? (
        <span>
          <b className="num">{orderCount}</b> {orderCount === 1 ? "order" : "orders"}
          {orderTotal ? <> · <b className="num">{formatINR(orderTotal)}</b> spent</> : null}
        </span>
      ) : null}
      {codTag}
      {ctx?.person.contactId ? (
        <Link className="pm2-lnk" href={`/dashboard/contacts/${ctx.person.contactId}`}>Profile →</Link>
      ) : null}
    </>
  );

  const ticketNote = ticketOpen ? (
    <span>Ticket #{thread.ticket_number}{thread.escalation_reason ? `: ${thread.escalation_reason}` : ""}</span>
  ) : null;

  const composerActions = (
    <>
      {codOrder ? (
        <button type="button" className="pm2-btn sm" onClick={() => setConfirmCod(true)} disabled={confirming}>
          Confirm COD {orderLabel(codOrder.order_number)}
        </button>
      ) : null}
      <button type="button" className="pm2-btn sm ghost" onClick={() => setPickingTemplate(true)} disabled={sending}>
        Template
      </button>
      <button type="button" className="pm2-btn sm ghost" onClick={draftReply} disabled={drafting || sending}>
        {drafting ? "Drafting…" : "AI draft"}
      </button>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => pickImage(e.target.files?.[0] ?? null)} />
      <button
        type="button"
        className="pm2-btn sm ghost"
        onClick={() => fileRef.current?.click()}
        disabled={uploading || sending || !windowOpen}
        title="JPG or PNG, up to 5 MB"
      >
        {uploading ? "Uploading…" : "Photo"}
      </button>
      {attachment ? (
        <button type="button" className="pm2-btn sm ghost" onClick={() => setAttachment(null)} aria-label="Remove photo">
          Remove photo
        </button>
      ) : null}
    </>
  );

  const teamName = (email: string) => members.find((m) => m.email === email)?.name || email;

  const threadBody = (
      <div className="pm2-thread-body">
        <div ref={scrollRef} className="pm2-thread-scroll">
          {items.length === 0 ? (
            <div style={{ padding: 24, color: "var(--pm-hint)", fontSize: 14.5 }}>No messages yet.</div>
          ) : (
            <Bubbles items={items} />
          )}
        </div>
        {pollFailed ? <ConnectionNotice /> : null}
        <WindowStrip lastInboundAt={lastInbound} now={now} />
        <div className="pm2-thread-foot">
          {pickingTemplate ? (
            <div className="pm2-panel">
              <TemplatePicker
                templates={templatesQ.data ?? []}
                busy={sending}
                onCancel={() => setPickingTemplate(false)}
                onSend={(tpl, vars) => send("template", { name: tpl.name, language: tpl.language, vars })}
              />
            </div>
          ) : (
            <Composer
              placeholder={`Reply as ${firstName}…`}
              value={text}
              onChange={setText}
              busy={sending || uploading}
              disabledReason={windowOpen ? undefined : WINDOW_CLOSED}
              reasonShownElsewhere
              actions={composerActions}
              onSend={() => send("text")}
              attachment={attachment ? { name: attachment.name } : null}
            />
          )}
          {thread.status === "bot" ? (
            <div className={t.botNote}>The bot is still answering this chat. Take over to pause it.</div>
          ) : thread.status === "human" ? (
            <div className={t.botNote}>The bot is paused here. Hand back to bot when you are done.</div>
          ) : null}
        </div>
      </div>
  );

  return (
    <div className={`pm2-thread${compact ? " compact" : ` ${t.full}`}`}>
      <ConversationHeader
        compact={compact}
        channel="wa"
        name={name}
        crumb={`Inbox · WhatsApp · ${maskPhone(thread.contact?.phone || thread.wa_id)}`}
        faint={factsLine}
        tags={headerTags}
        actions={headerActions}
        facts={facts}
        note={compact ? ticketNote : undefined}
        back={
          compact ? undefined : (
            <button
              type="button"
              className="pm2-lnk"
              style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
              onClick={() => {
                if (window.history.length > 1) router.back();
                else router.push("/dashboard/inbox");
              }}
            >
              ← Back to Inbox
            </button>
          )
        }
      />
      {compact ? (
        threadBody
      ) : (
        <div className={t.layout}>
          <div className={t.main}>{threadBody}</div>
          <aside className={t.side} aria-label="Ticket details">
            <TicketProperties
              ticketStatus={thread.ticket_status}
              ticketNumber={thread.ticket_number}
              ticketAssignee={owner}
              priority={thread.ticket_priority}
              category={thread.ticket_category}
              teamName={teamName}
              assign={assignSelect}
            />
            <div className={`${t.blk} ${t.blkFacts}`}>
              <div className={t.blkH}>Customer</div>
              {ticketNote ? <div className={t.note}>{ticketNote}</div> : null}
              <CustomerContext conversationKey={`wa-${id}`} embedded />
            </div>
          </aside>
        </div>
      )}
      {confirm ? (
        <ConfirmDialog
          title={
            confirm === "resolve"
              ? `Mark ticket #${thread.ticket_number} solved?`
              : confirm === "handback"
                ? "Hand this chat back to the bot?"
                : "Archive this chat?"
          }
          body={
            confirm === "resolve"
              ? thread.status === "bot"
                ? "Marks the ticket solved. The bot keeps answering this customer. The customer is not messaged."
                : "Marks the ticket solved. The chat stays with a person until someone presses Hand back to bot. The customer is not messaged."
              : confirm === "handback"
                ? ticketOpen
                  ? `The bot will answer this customer's next messages. Ticket #${thread.ticket_number} stays open until someone marks it solved. The customer is not messaged.`
                  : "The bot will answer this customer's next messages. The customer is not messaged."
                : "It leaves the inbox lists and all messages are kept. Nothing is sent to the customer, and the chat comes back if they write again."
          }
          confirmLabel={confirm === "resolve" ? "Mark solved" : confirm === "handback" ? "Hand back to bot" : "Archive"}
          busy={patching}
          onConfirm={() => void runConfirm()}
          onClose={() => setConfirm(null)}
        />
      ) : null}
      {confirmCod && codOrder ? (
        <ConfirmDialog
          title={`Confirm order ${orderLabel(codOrder.order_number)}?`}
          body="It will be released for shipping."
          confirmLabel="Confirm order"
          busy={confirming}
          onConfirm={confirmCodOrder}
          onClose={() => setConfirmCod(false)}
        />
      ) : null}
    </div>
  );
}

export default WaConversation;
