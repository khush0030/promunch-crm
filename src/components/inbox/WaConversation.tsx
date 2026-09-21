"use client";

// WhatsApp conversation view (Inbox redesign, Task 2.5). Full page when
// mounted by /dashboard/inbox/[id]; `compact` when embedded in the
// Conversations list pane. Every customer-visible send goes through
// POST /api/whatsapp/send with the SAME body the old InboxView sends (only
// sent_by differs: the signed-in user's email instead of a hardcoded one),
// so the route's atomic 90s dedup claim keeps protecting the customer.
// Header buttons only PATCH thread state; none of them message anyone.

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog, Callout } from "@/components/pm";
import { Bubbles } from "./Bubbles";
import { Composer } from "./Composer";
import { TemplatePicker } from "./TemplatePicker";
import { ConversationHeader } from "./ConversationHeader";
import { useMeEmail, useNow, useStickToBottom, useTeamMembers } from "./hooks";
import { AssignSelect, ConnectionNotice, NotFoundCard, patchThread, shareLink } from "./shared";
import { WindowChip, windowLeftMs } from "@/components/whatsapp/WindowTimer";
import type { Template, Thread } from "@/components/whatsapp/types";
import { formatINR } from "@/lib/metrics/money";
import {
  waBubbles,
  waStatusPill,
  maskPhone,
  firstNameOf,
  latestInboundAt,
  waitingCodOrder,
  orderLabel,
  NotFoundError,
  isNotFound,
  type WaMessageRow,
  type CodGateOrder,
} from "@/lib/inbox/thread";

type ThreadRow = Thread & { ticket_opened_at?: string | null };

type CustomerData = {
  wa_id: string;
  contact: { id: string; city: string | null; total_orders: number | null; total_spent: number | null } | null;
  orders: { order_number: string; total: string }[];
  order_count: number;
};

const WINDOW_CLOSED = "24-hour window closed. Send a template to restart the chat.";
const DUPLICATE_TOAST = "Already sent a moment ago, not sent again.";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function rupeesFromLabel(s: string): number {
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function WaConversation({ id, peek = false, compact = false }: { id: string; peek?: boolean; compact?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMeEmail();
  const members = useTeamMembers();

  const threadQ = useQuery({
    queryKey: ["wa-thread-messages", id],
    queryFn: async (): Promise<{ thread: ThreadRow; messages: WaMessageRow[] }> => {
      const r = await fetch(`/api/whatsapp/threads/${id}${peek ? "?peek=1" : ""}`, { cache: "no-store" });
      if (r.status === 404) throw new NotFoundError();
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `thread ${r.status}`);
      return { thread: j.thread as ThreadRow, messages: (j.messages ?? []) as WaMessageRow[] };
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

  const customerQ = useQuery({
    queryKey: ["wa-thread-customer", id],
    queryFn: async (): Promise<CustomerData | null> => {
      const r = await fetch(`/api/whatsapp/threads/${id}/customer`);
      const j = await r.json();
      return r.ok && !j.error ? (j as CustomerData) : null;
    },
    staleTime: 5 * 60_000,
  });

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
  const items = useMemo(() => waBubbles(messages, thread, now), [messages, thread, now]);
  const lastInbound = useMemo(() => latestInboundAt(thread?.last_inbound_at, messages), [thread?.last_inbound_at, messages]);
  const windowOpen = (windowLeftMs(lastInbound, now) ?? 0) > 0;
  const codOrder = useMemo(() => waitingCodOrder(codQ.data ?? [], thread?.wa_id), [codQ.data, thread?.wa_id]);
  const ticketOpen = thread?.ticket_status === "open" || thread?.ticket_status === "pending";
  const name = thread?.contact?.name || thread?.contact?.phone || "WhatsApp chat";
  const firstName = firstNameOf(me);

  const customer = customerQ.data ?? null;
  const orderCount = customer?.contact?.total_orders ?? customer?.order_count ?? 0;
  const orderTotal = customer?.contact?.total_spent ?? (customer?.orders ?? []).reduce((s, o) => s + rupeesFromLabel(o.total), 0);
  const city = customer?.contact?.city ?? null;

  // ---- composer state ----------------------------------------------------
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachment, setAttachment] = useState<{ url: string; name: string } | null>(null);
  const [pickingTemplate, setPickingTemplate] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [confirmCod, setConfirmCod] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [patching, setPatching] = useState(false);
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
    [uploading, me, attachment, id, text, toast, refresh],
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

  async function patch(p: Partial<Thread>) {
    if (patching) return;
    setPatching(true);
    try {
      await patchThread(`/api/whatsapp/threads/${id}`, p, toast);
      await refresh();
    } finally {
      setPatching(false);
    }
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

  const pill = waStatusPill(thread.status);
  const btn = compact ? "pm2-btn sm" : "pm2-btn";
  const headerActions = (
    <>
      {compact ? <WindowChip lastInboundAt={lastInbound} /> : null}
      {thread.status === "human" ? (
        <button type="button" className={btn} disabled={patching} onClick={() => patch({ status: "bot" })}>Hand back to bot</button>
      ) : thread.status === "closed" ? null : (
        // bot or snoozed: a person can pick the chat up
        <button type="button" className={btn} disabled={patching} onClick={() => patch({ status: "human" })}>Take over</button>
      )}
      {ticketOpen ? (
        <button type="button" className={`${btn} ghost`} disabled={patching} onClick={() => patch({ ticket_status: "resolved" })}>Resolve</button>
      ) : null}
      <button type="button" className={`${btn} ghost`} onClick={() => shareLink(`/dashboard/inbox/wa-${id}`, toast)}>Share</button>
      <AssignSelect value={thread.assigned_to} members={members} disabled={patching} onChange={(email) => patch({ assigned_to: email || null })} />
    </>
  );

  const factsLine = [
    "WhatsApp",
    city,
    `${orderCount} ${orderCount === 1 ? "order" : "orders"}${orderTotal ? ` · ${formatINR(orderTotal)}` : ""}`,
  ].filter(Boolean).join(" · ");

  const facts = (
    <>
      {city ? <span><b>{city}</b></span> : null}
      <span>
        <b className="num">{orderCount}</b> {orderCount === 1 ? "order" : "orders"}
        {orderTotal ? <> · <b className="num">{formatINR(orderTotal)}</b></> : null}
      </span>
      {codOrder ? <span>{orderLabel(codOrder.order_number)} · COD · <b>waiting</b></span> : null}
      <WindowChip lastInboundAt={lastInbound} />
      {customer?.contact?.id ? (
        <Link className="pm2-lnk" style={{ marginLeft: "auto" }} href={`/dashboard/contacts/${customer.contact.id}`}>Profile →</Link>
      ) : null}
    </>
  );

  const ticketNote = ticketOpen ? (
    <span>Ticket #{thread.ticket_number}{thread.escalation_reason ? ` · ${thread.escalation_reason}` : ""}</span>
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

  return (
    <div className={`pm2-thread${compact ? " compact" : ""}`}>
      <ConversationHeader
        compact={compact}
        channel="wa"
        name={name}
        crumb={`Inbox · WhatsApp · ${maskPhone(thread.contact?.phone || thread.wa_id)}`}
        faint={factsLine}
        pill={pill}
        actions={headerActions}
        facts={facts}
        note={ticketNote}
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
              actions={composerActions}
              onSend={() => send("text")}
              attachment={attachment ? { name: attachment.name } : null}
            />
          )}
          {thread.status === "bot" ? (
            <div style={{ fontSize: 12.5, color: "var(--pm-hint)", padding: "6px 2px 0" }}>
              The bot is still replying. Take over to pause it.
            </div>
          ) : null}
        </div>
      </div>
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
