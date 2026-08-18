"use client";

// Inbox + Tickets tab of the WhatsApp dashboard: thread list, conversation
// pane (reply box, template picker, media), customer panel and ticket
// controls. Extracted from dashboard/whatsapp/page.tsx (audit R5).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  AlertTriangle, Archive, ArchiveRestore, Bot, Check, CheckCheck, CheckCircle2,
  ChevronLeft, ExternalLink, MapPin, Megaphone, Search, Send, ShoppingBag,
  Sparkles, Tag, Ticket as TicketIcon, User as UserIcon, X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { msgTime, mostRecent, timeAgo } from "@/app/dashboard/whatsapp/format";
import type { Thread, Message, Template, TeamMember } from "./types";
import { BRAND, WA_GREEN, priorityStyle, ticketStatusStyle, chip } from "./styles";
import { Pill } from "./primitives";
import { WindowTimer, WindowChip } from "./WindowTimer";

// WhatsApp-style delivery ticks for an outbound message.
//   sent      → single grey check
//   delivered → double grey check
//   read      → double blue check
//   queued    → faint single check (in flight)
//   failed    → nothing (the row surfaces errors elsewhere)
function Ticks({ status }: { status: Thread["last_outbound_status"] }) {
  if (!status || status === "failed") return null;
  const WA_BLUE = "#53bdeb";
  if (status === "read") return <CheckCheck size={14} color={WA_BLUE} strokeWidth={2.5} />;
  if (status === "delivered") return <CheckCheck size={14} color="var(--pm-hint)" strokeWidth={2.5} />;
  if (status === "sent") return <Check size={14} color="var(--pm-hint)" strokeWidth={2.5} />;
  // received/queued — still on its way to the device
  return <Check size={14} color="var(--pm-hint)" strokeWidth={2} style={{ opacity: 0.5 }} />;
}

// Team roster + current user, for chat assignment. Fetched once per mount.
function useTeam() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [me, setMe] = useState<{ email: string | null; role: string }>({ email: null, role: "admin" });
  useEffect(() => {
    fetch("/api/team")
      .then((r) => r.json())
      .then((j) => {
        setMembers(j.users ?? []);
        setMe({ email: j.currentUserEmail ?? null, role: j.currentUserRole ?? "admin" });
      })
      .catch(() => {});
  }, []);
  return { members, me };
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);
  return isMobile;
}

/* Inline renderer for an inbound media message (image / voice note / video / doc). */
function MediaView({ url, type }: { url: string; type: string }) {
  if (type === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="attachment" style={{ maxWidth: 240, maxHeight: 240, borderRadius: 8, display: "block", marginBottom: 4 }} />
      </a>
    );
  }
  if (type === "audio") {
    return <audio controls src={url} style={{ maxWidth: 240, marginBottom: 4, display: "block" }} />;
  }
  if (type === "video") {
    return <video controls src={url} style={{ maxWidth: 240, borderRadius: 8, marginBottom: 4, display: "block" }} />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ color: "#1d4ed8", fontSize: 12 }}>
      📎 Download {type}
    </a>
  );
}

export default function InboxView({ ticketsOnly }: { ticketsOnly: boolean }) {
  const [selected, setSelected] = useState<Thread | null>(null);
  const [status, setStatus] = useState<string>("");
  const [ticket, setTicket] = useState<string>(ticketsOnly ? "open" : "");
  const [search, setSearch] = useState("");
  const [assignFilter, setAssignFilter] = useState<"" | "mine" | "unassigned">("");
  const { members, me } = useTeam();
  const [hover, setHover] = useState<string | null>(null);
  const isMobile = useIsMobile();
  // On mobile we route between three full-width views; on desktop everything is visible.
  const [mobileView, setMobileView] = useState<"list" | "conv" | "details">("list");

  // isPending (not isFetching) drives the "Loading…" banner: it's true only
  // before the FIRST data arrives. Background refetches must not mount the
  // banner — it shifts the list and throws away the user's scroll position.
  // keepPreviousData keeps the list visible while a filter change refetches.
  const { data: threads = [], refetch, isPending: loading } = useQuery({
    queryKey: ["wa-threads", { status, ticket, search, assignFilter, me: me.email }],
    queryFn: async (): Promise<Thread[]> => {
      const qs = new URLSearchParams();
      // "archived" is a view, not a real thread status — it maps to ?archived=1
      if (status === "archived") qs.set("archived", "1");
      else if (status) qs.set("status", status);
      if (ticket) qs.set("ticket", ticket);
      if (search) qs.set("search", search);
      if (assignFilter === "unassigned") qs.set("assignee", "unassigned");
      else if (assignFilter === "mine" && me.email) qs.set("assignee", me.email);
      qs.set("limit", "60");
      const res = await fetch(`/api/whatsapp/threads?${qs}`);
      const j = await res.json();
      return j.threads ?? [];
    },
    refetchInterval: 4000,
    placeholderData: keepPreviousData,
  });
  const load = () => refetch();

  // Archive (hide) or unarchive a thread — never deletes messages.
  const archiveThread = useCallback(async (id: string, archived: boolean) => {
    await fetch(`/api/whatsapp/threads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    setSelected((s) => (s?.id === id ? null : s));
    refetch();
  }, [refetch]);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "320px 1fr 304px",
      gap: isMobile ? 0 : 14,
      height: isMobile ? "calc(100dvh - 140px)" : "calc(100vh - 200px)",
    }}>
      <div style={{
        background: "var(--pm-card)", border: "1px solid var(--pm-border)", borderRadius: 12,
        overflow: "hidden", display: isMobile && mobileView !== "list" ? "none" : "flex", flexDirection: "column",
      }}>
        <div style={{ padding: 12, borderBottom: "1px solid var(--pm-border)" }}>
          <div style={{ position: "relative", marginBottom: 8 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--pm-hint)" }} />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search phone or message…"
              inputMode="search" enterKeyHint="search"
              style={{
                width: "100%", padding: isMobile ? "12px 8px 12px 32px" : "8px 8px 8px 32px",
                borderRadius: 8, border: "1px solid var(--pm-border)",
                fontSize: isMobile ? 16 : 13, outline: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(ticketsOnly
              ? [
                  { k: "open", l: "Open" },
                  { k: "pending", l: "Pending" },
                  { k: "resolved", l: "Resolved" },
                  { k: "", l: "All" },
                ]
              : [
                  { k: "", l: "All" },
                  { k: "bot", l: "Bot" },
                  { k: "human", l: "Human" },
                  { k: "closed", l: "Closed" },
                  { k: "archived", l: "Archived" },
                ]
            ).map((f) => {
              const active = ticketsOnly ? ticket === f.k : status === f.k;
              return (
                <button key={f.l}
                  type="button"
                  className={`pm-chip${active ? " on" : ""}`}
                  onClick={() => (ticketsOnly ? setTicket(f.k) : setStatus(f.k))}
                  style={{
                    padding: isMobile ? "8px 14px" : "4px 10px",
                    minHeight: isMobile ? 36 : undefined,
                    fontSize: isMobile ? 13 : 12,
                  }}>{f.l}</button>
              );
            })}
          </div>
          {!ticketsOnly && (
            <div className="pm-chips" style={{ marginTop: 6 }}>
              {([{ k: "", l: "Everyone" }, { k: "mine", l: "Assigned to me" }, { k: "unassigned", l: "Unassigned" }] as const).map((f) => (
                <button key={f.l} type="button"
                  className={`pm-chip${assignFilter === f.k ? " on" : ""}`}
                  onClick={() => setAssignFilter(f.k)}
                  style={{ padding: isMobile ? "8px 14px" : "4px 10px", minHeight: isMobile ? 36 : undefined, fontSize: isMobile ? 13 : 12 }}>
                  {f.l}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && <div style={{ padding: 24, color: "var(--pm-hint)", fontSize: 13 }}>Loading…</div>}
          {!loading && threads.length === 0 && (
            <div style={{ padding: 24, color: "var(--pm-hint)", fontSize: 13 }}>No conversations yet.</div>
          )}
          {threads.map((t) => {
            const active = selected?.id === t.id;
            return (
              <div key={t.id}
                onClick={() => { setSelected(t); if (isMobile) setMobileView("conv"); }}
                onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)}
                style={{
                  width: "100%", textAlign: "left", padding: isMobile ? 16 : 12, position: "relative",
                  borderBottom: "1px solid var(--pm-border)",
                  background: active ? "rgba(185,28,74,0.06)" : "var(--pm-card)",
                  cursor: "pointer", minHeight: isMobile ? 72 : undefined,
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--pm-ink)" }}>
                    {t.contact.name || t.contact.phone}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--pm-hint)" }}>
                    {t.last_message_direction === "outbound" && <Ticks status={t.last_outbound_status} />}
                    <span>{timeAgo(mostRecent(t.last_inbound_at, t.last_outbound_at))}</span>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--pm-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.last_message_snippet || "—"}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Pill icon={t.status === "bot" ? Bot : UserIcon} label={t.status}
                    bg={t.status === "bot" ? "rgba(37,211,102,0.12)" : "rgba(59,130,246,0.12)"}
                    color={t.status === "bot" ? "var(--pm-green)" : "#1d4ed8"} />
                  {t.ticket_status !== "none" && (
                    <Pill icon={TicketIcon} label={`#${t.ticket_number} ${ticketStatusStyle[t.ticket_status].label}`}
                      bg={ticketStatusStyle[t.ticket_status].bg} color={ticketStatusStyle[t.ticket_status].color} />
                  )}
                  {/* Priority only when it actually demands attention — a
                      "normal" pill on every row is noise. */}
                  {t.ticket_priority && t.ticket_status !== "none" &&
                    (t.ticket_priority === "high" || t.ticket_priority === "urgent") && (
                    <Pill icon={AlertTriangle} label={t.ticket_priority}
                      bg={priorityStyle[t.ticket_priority].bg} color={priorityStyle[t.ticket_priority].color} />
                  )}
                  <WindowChip lastInboundAt={t.last_inbound_at} />
                  {t.unread_count > 0 && (
                    <span style={{
                      marginLeft: "auto", background: BRAND, color: "var(--pm-card)", fontSize: 11,
                      fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                    }}>{t.unread_count}</span>
                  )}
                </div>
                {(isMobile || hover === t.id) && (
                  <button type="button"
                    title={status === "archived" ? "Unarchive chat" : "Archive chat"}
                    onClick={(e) => { e.stopPropagation(); archiveThread(t.id, status !== "archived"); }}
                    style={{
                      position: "absolute", right: 8, top: 8,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: isMobile ? 36 : 26, height: isMobile ? 36 : 26, borderRadius: 8,
                      border: "1px solid var(--pm-border)", background: "var(--pm-card)",
                      color: "var(--pm-hint)", cursor: "pointer",
                    }}>
                    {status === "archived" ? <ArchiveRestore size={isMobile ? 16 : 13} /> : <Archive size={isMobile ? 16 : 13} />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: isMobile && mobileView !== "conv" ? "none" : "contents" }}>
        <ConversationPane
          thread={selected}
          onChange={(t) => { setSelected(t); load(); }}
          isMobile={isMobile}
          onBack={() => setMobileView("list")}
          onShowDetails={() => setMobileView("details")}
        />
      </div>

      <CustomerPanel
        thread={selected}
        isMobile={isMobile}
        visible={!isMobile || mobileView === "details"}
        onClose={() => setMobileView("conv")}
        members={members}
        onChange={(t) => { setSelected(t); load(); }}
      />
    </div>
  );
}


function ConversationPane({ thread, onChange, isMobile = false, onBack, onShowDetails }: {
  thread: Thread | null;
  onChange: (t: Thread) => void;
  isMobile?: boolean;
  onBack?: () => void;
  onShowDetails?: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [pickingTemplate, setPickingTemplate] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], refetch } = useQuery({
    queryKey: ["wa-thread-messages", thread?.id],
    queryFn: async (): Promise<Message[]> => {
      const r = await fetch(`/api/whatsapp/threads/${thread!.id}`);
      const j = await r.json();
      return j.messages ?? [];
    },
    enabled: !!thread,
    refetchInterval: 4000,
  });
  const load = () => refetch();

  // Scroll to the bottom only when it should: on first paint of a thread, or
  // when a NEW message arrives while the user is already near the bottom.
  // A background poll must never yank the user away from older messages
  // they're reading. (React Query's structural sharing means this effect only
  // re-runs when the data actually changed.)
  const lastSeenRef = useRef<string | null>(null);
  useEffect(() => { lastSeenRef.current = null; }, [thread?.id]);
  useEffect(() => {
    if (!thread) return;
    const lastId = messages.length ? messages[messages.length - 1].id : "empty";
    const first = lastSeenRef.current === null;
    const changed = lastSeenRef.current !== lastId;
    lastSeenRef.current = lastId;
    if (!first && !changed) return;
    const el = scrollRef.current;
    const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (first || nearBottom) {
      setTimeout(() => scrollRef.current?.scrollTo({ top: 9e9, behavior: first ? "auto" : "smooth" }), 50);
    }
  }, [messages, thread]);

  useEffect(() => {
    fetch("/api/whatsapp/templates?status=approved").then((r) => r.json()).then((j) => setTemplates(j.templates ?? []));
  }, []);

  // Freshest inbound timestamp for the 24h-window timer: the thread row can
  // lag behind the 8s message poll, so also scan the loaded messages.
  const lastInboundAt = useMemo(() => {
    let best = thread?.last_inbound_at ?? null;
    for (const m of messages) {
      if (m.direction !== "inbound") continue;
      if (!best || Date.parse(m.created_at) > Date.parse(best)) best = m.created_at;
    }
    return best;
  }, [messages, thread?.last_inbound_at]);

  if (!thread) {
    return (
      <div style={{
        background: "var(--pm-card)", border: "1px solid var(--pm-border)", borderRadius: 12,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 10, color: "var(--pm-hint)", fontSize: 13.5,
      }}>
        <span style={{
          width: 44, height: 44, borderRadius: 13, background: "var(--pm-card2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Megaphone size={20} style={{ color: "var(--pm-hint)" }} />
        </span>
        <div style={{ fontWeight: 500, color: "var(--pm-muted)" }}>Pick a conversation</div>
        <div style={{ fontSize: 12.5, maxWidth: 220, textAlign: "center" }}>
          Select a chat on the left to read it, reply, or manage its ticket.
        </div>
      </div>
    );
  }

  async function send(kind: "text" | "template", payload?: any) {
    setSending(true);
    try {
      const body =
        kind === "text"
          ? { thread_id: thread!.id, kind, text, sent_by: "khush@promunch.in" }
          : { thread_id: thread!.id, kind: "template", template: payload, sent_by: "khush@promunch.in" };
      const r = await fetch("/api/whatsapp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.ok === false || j.error)
        toast.push({ kind: "error", text: "Send failed: " + (j.error ?? "unknown") });
      else if (j.skipped)
        toast.push({ kind: "info", text: "Already sent — duplicate skipped." });
      setText("");
      setPickingTemplate(false);
      load();
    } finally {
      setSending(false);
    }
  }

  async function patch(p: Partial<Thread>) {
    const r = await fetch(`/api/whatsapp/threads/${thread!.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p),
    });
    const j = await r.json();
    if (j.thread) onChange({ ...thread!, ...j.thread, contact: thread!.contact });
  }

  async function draftReply() {
    setDrafting(true);
    try {
      const r = await fetch(`/api/whatsapp/threads/${thread!.id}/draft`, { method: "POST" });
      const j = await r.json();
      if (j.error) { toast.push({ kind: "error", text: "AI draft failed: " + j.error }); return; }
      if (j.action === "escalate") {
        toast.push({
          kind: "info",
          text: "AI suggests escalating to a human: " + (j.reason || "needs human attention"),
        });
        return;
      }
      if (j.draft) setText(j.draft);
      else toast.push({ kind: "info", text: "AI returned no draft." });
    } finally { setDrafting(false); }
  }

  return (
    <div style={{
      background: "var(--pm-card)", border: "1px solid var(--pm-border)", borderRadius: 12,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{
        padding: isMobile ? 10 : 14,
        borderBottom: "1px solid var(--pm-border)",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "center",
        justifyContent: "space-between",
        gap: isMobile ? 8 : 0,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
          {isMobile && (
            <button type="button" onClick={onBack} aria-label="Back to inbox"
              style={{
                flexShrink: 0, width: 36, height: 36, borderRadius: 8,
                border: "1px solid var(--pm-border)", background: "var(--pm-card)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: "var(--pm-muted)",
              }}>
              <ChevronLeft size={18} />
            </button>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, color: "var(--pm-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {thread.contact.name || thread.contact.phone}
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, color: "var(--pm-muted)" }}>{thread.contact.phone}</span>
          </div>
          <WindowTimer lastInboundAt={lastInboundAt} />
          {/* Status / ticket / priority live in the <select> dropdowns on the right —
              the read-only Pills here were a duplicate and have been removed. */}
          {thread.escalation_reason &&
            (thread.ticket_status === "open" || thread.ticket_status === "pending") && (
            <div style={{ fontSize: 12, color: "#92400e", marginTop: 6 }}>
              <AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {thread.escalation_reason}
            </div>
          )}
          </div>
          {isMobile && (
            <button type="button" onClick={onShowDetails} aria-label="Customer details"
              style={{
                flexShrink: 0, width: 36, height: 36, borderRadius: 8,
                border: "1px solid var(--pm-border)", background: "var(--pm-card)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: "var(--pm-muted)",
              }}>
              <UserIcon size={18} />
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          {(thread.ticket_status === "open" || thread.ticket_status === "pending") && (
            <button type="button" onClick={() => patch({ ticket_status: "resolved" })}
              title="Mark this ticket resolved"
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: "1px solid var(--pm-green)", background: "var(--pm-green)", color: "#fff",
                cursor: "pointer", whiteSpace: "nowrap",
              }}>
              <CheckCircle2 size={13} /> Resolve ticket
            </button>
          )}
          {/* Handled-by / assignee / ticket / priority controls moved to the
              right-rail CustomerPanel ("Conversation" card) — prominent
              buttons there instead of four cramped dropdowns here. */}
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: isMobile ? 10 : 18, background: "#f0f2f5" }}>
        {messages.map((m) => {
          const out = m.direction === "outbound";
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: out ? "flex-end" : "flex-start", marginBottom: 8 }}>
              <div style={{
                maxWidth: isMobile ? "85%" : "70%", background: out ? "#dcf8c6" : "var(--pm-card)",
                color: "var(--pm-ink)", padding: "8px 12px", borderRadius: 10,
                boxShadow: "0 1px 1px rgba(0,0,0,0.06)", fontSize: 14, lineHeight: 1.45,
              }}>
                {m.template_name && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: BRAND, marginBottom: 4 }}>
                    Template · {m.template_name}
                  </div>
                )}
                {m.media_url && <MediaView url={m.media_url} type={m.type} />}
                <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 4, fontSize: 10, color: "var(--pm-muted)" }}>
                  {m.sent_by === "bot" && <span style={{ color: WA_GREEN, fontWeight: 600 }}><Sparkles size={10} style={{ verticalAlign: -1 }} /> AI</span>}
                  <span title={new Date(m.created_at).toLocaleString("en-IN")}>{msgTime(m.created_at)}</span>
                  {out && <span>· {m.status}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {pickingTemplate ? (
        <TemplatePicker
          templates={templates}
          busy={sending}
          onCancel={() => setPickingTemplate(false)}
          onSend={(tpl, vars) => send("template", { name: tpl.name, language: tpl.language, vars })}
        />
      ) : (
        <div style={{
          padding: isMobile ? "10px 10px calc(10px + env(safe-area-inset-bottom, 0px))" : 12,
          borderTop: "1px solid var(--pm-border)",
          display: "flex", gap: 8, alignItems: "center",
        }}>
          <button type="button" onClick={() => setPickingTemplate(true)} title="Send template" aria-label="Send template"
            style={{
              minWidth: 44, minHeight: 44, padding: isMobile ? 0 : "10px 14px", borderRadius: 10, border: "1px solid var(--pm-border)",
              background: "var(--pm-card)", cursor: "pointer", color: BRAND, fontWeight: 600, fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0,
            }}>
            <Megaphone size={isMobile ? 18 : 14} /> {!isMobile && "Template"}
          </button>
          <button type="button" onClick={draftReply} disabled={drafting} title="AI-draft a reply" aria-label="AI draft"
            style={{
              minWidth: 44, minHeight: 44, padding: isMobile ? 0 : "10px 14px", borderRadius: 10, border: "1px solid var(--pm-border)",
              background: "var(--pm-card)", cursor: drafting ? "wait" : "pointer", color: WA_GREEN, fontWeight: 600, fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0,
            }}>
            <Sparkles size={isMobile ? 18 : 14} /> {!isMobile && (drafting ? "Drafting…" : "AI draft")}
          </button>
          <input
            value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && text.trim() && !sending) send("text"); }}
            placeholder="Type a message…"
            enterKeyHint="send"
            style={{
              flex: 1, minWidth: 0, minHeight: 44, padding: "10px 14px", borderRadius: 10,
              border: "1px solid var(--pm-border)", outline: "none",
              fontSize: isMobile ? 16 : 13.5, /* 16 on mobile prevents iOS zoom */
              background: "var(--pm-card2)", transition: "background .14s, border-color .14s",
            }}
            onFocus={(e) => { e.currentTarget.style.background = "var(--pm-card)"; e.currentTarget.style.borderColor = "var(--pm-terra)"; }}
            onBlur={(e) => { e.currentTarget.style.background = "var(--pm-card2)"; e.currentTarget.style.borderColor = "var(--pm-border)"; }}
          />
          <button type="button" disabled={!text.trim() || sending} onClick={() => send("text")} aria-label="Send message"
            style={{
              minWidth: 44, minHeight: 44, padding: isMobile ? 0 : "10px 16px", borderRadius: 10, border: "none",
              background: text.trim() ? BRAND : "var(--pm-border)",
              color: "var(--pm-card)", fontWeight: 600, cursor: text.trim() ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0,
            }}>
            <Send size={isMobile ? 18 : 14} /> {!isMobile && "Send"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* CUSTOMER PANEL — CRM context for the open conversation             */
/* ----------------------------------------------------------------- */

type CustomerOrder = {
  order_number: string;
  placed_at: string;
  total: string;
  financial_status: string | null;
  fulfillment_status: string;
  items: { name: string; qty: number }[];
  tracking_url: string | null;
  order_status_url: string | null;
  admin_url: string | null;
};
type CustomerData = {
  wa_id: string;
  contact: {
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    tags: string[] | null;
    status: string | null;
    total_orders: number | null;
    total_spent: number | null;
    last_purchase_date: string | null;
    city: string | null;
    state: string | null;
  } | null;
  orders: CustomerOrder[];
  order_count: number;
};

/* Right-rail customer 360: the WhatsApp chat stitched to Shopify orders and
   the CRM contact record, matched by the customer's WhatsApp number. */
function CustomerPanel({ thread, isMobile = false, visible = true, onClose, members = [], onChange }: {
  thread: Thread | null;
  isMobile?: boolean;
  visible?: boolean;
  onClose?: () => void;
  members?: TeamMember[];
  onChange?: (t: Thread) => void;
}) {
  const [data, setData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(false);
  const threadId = thread?.id;

  useEffect(() => {
    if (!threadId) { setData(null); return; }
    let live = true;
    setLoading(true);
    // Keyed on the id, not the object: status/ticket patches swap the thread
    // object but must not refetch the Shopify/CRM data.
    fetch(`/api/whatsapp/threads/${threadId}/customer`)
      .then((r) => r.json())
      .then((j) => { if (live) setData(j?.error ? null : j); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [threadId]);

  async function patch(p: Partial<Thread>) {
    if (!thread) return;
    const r = await fetch(`/api/whatsapp/threads/${thread.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p),
    });
    const j = await r.json();
    if (j.thread) onChange?.({ ...thread, ...j.thread, contact: thread.contact });
  }

  if (!visible) return null;

  const wrap: React.CSSProperties = isMobile
    ? {
        position: "fixed", inset: 0, zIndex: 60,
        background: "var(--pm-card)", overflowY: "auto",
        padding: "12px 14px calc(14px + env(safe-area-inset-bottom, 0px))",
      }
    : {
        background: "var(--pm-card)", border: "1px solid var(--pm-border)", borderRadius: 12,
        overflowY: "auto", padding: 14,
      };

  if (!thread) {
    return (
      <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--pm-hint)", fontSize: 13 }}>
        Customer details
      </div>
    );
  }
  if (loading && !data) {
    return <div style={{ ...wrap, color: "var(--pm-hint)", fontSize: 13 }}>Loading customer…</div>;
  }

  const c = data?.contact ?? null;
  const orders = data?.orders ?? [];
  const fullName = c ? [c.first_name, c.last_name].filter(Boolean).join(" ") : "";
  const display = (thread.contact.name || fullName || thread.contact.phone || "").trim();

  return (
    <div style={wrap}>
      {isMobile && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid var(--pm-border)",
        }}>
          <strong style={{ fontSize: 15 }}>Customer details</strong>
          <button type="button" onClick={onClose} aria-label="Close details"
            style={{
              width: 36, height: 36, borderRadius: 8,
              border: "1px solid var(--pm-border)", background: "var(--pm-card)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "var(--pm-muted)",
            }}>
            <X size={18} />
          </button>
        </div>
      )}
      {/* conversation controls — moved here from the chat header so they get
          real, labeled buttons instead of four cramped dropdowns */}
      <div style={{ border: "1px solid var(--pm-border)", borderRadius: 10, padding: 12, marginBottom: 14, background: "var(--pm-card2)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--pm-muted)", marginBottom: 10 }}>
          Conversation
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Handled by</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {([["bot", "Bot"], ["human", "Human"], ["snoozed", "Snoozed"], ["closed", "Closed"]] as const).map(([v, l]) => {
            const on = thread.status === v;
            const onColor = v === "bot" ? "var(--pm-green)" : v === "human" ? "#1d4ed8" : "var(--pm-muted)";
            return (
              <button key={v} type="button" onClick={() => patch({ status: v })}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12, cursor: "pointer",
                  fontWeight: on ? 700 : 500,
                  border: `1px solid ${on ? onColor : "var(--pm-border)"}`,
                  background: on ? onColor : "var(--pm-card)",
                  color: on ? "#fff" : "var(--pm-ink)",
                }}>
                {v === "bot" && <Bot size={12} style={{ verticalAlign: -2, marginRight: 3 }} />}
                {v === "human" && <UserIcon size={12} style={{ verticalAlign: -2, marginRight: 3 }} />}
                {l}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Assigned to</div>
        <select aria-label="Assigned to" value={thread.assigned_to ?? ""}
          onChange={(e) => patch({ assigned_to: e.target.value || null })}
          style={{
            width: "100%", padding: "9px 10px", borderRadius: 8, marginBottom: 12,
            border: "1px solid var(--pm-border)", fontSize: 13, background: "var(--pm-card)",
          }}>
          <option value="">Unassigned</option>
          {members.filter((m) => m.email).map((m) => (
            <option key={m.id} value={m.email!}>{m.name}</option>
          ))}
        </select>

        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          Ticket{thread.ticket_status !== "none" && (
            <span style={{ color: "var(--pm-muted)", fontWeight: 500 }}> · #{thread.ticket_number}</span>
          )}
        </div>
        {thread.ticket_status === "none" ? (
          <button type="button" onClick={() => patch({ ticket_status: "open" })}
            style={{
              width: "100%", padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 600,
              border: "1px solid var(--pm-border)", background: "var(--pm-card)", color: "var(--pm-ink)",
              cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
              gap: 6, marginBottom: 12,
            }}>
            <TicketIcon size={14} /> Open a ticket
          </button>
        ) : (
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {(["open", "pending", "resolved", "closed"] as const).map((v) => {
              const on = thread.ticket_status === v;
              const st = ticketStatusStyle[v];
              return (
                <button key={v} type="button" onClick={() => patch({ ticket_status: v })}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12, cursor: "pointer",
                    fontWeight: on ? 700 : 500,
                    border: `1px solid ${on ? st.color : "var(--pm-border)"}`,
                    background: on ? st.bg : "var(--pm-card)",
                    color: on ? st.color : "var(--pm-ink)",
                  }}>
                  {st.label}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Priority</div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["low", "normal", "high", "urgent"] as const).map((v) => {
            const on = (thread.ticket_priority ?? "normal") === v;
            const st = priorityStyle[v];
            return (
              <button key={v} type="button" onClick={() => patch({ ticket_priority: v })}
                style={{
                  flex: 1, padding: "7px 0", borderRadius: 8, fontSize: 12, cursor: "pointer",
                  textTransform: "capitalize", fontWeight: on ? 700 : 500,
                  border: `1px solid ${on ? st.color : "var(--pm-border)"}`,
                  background: on ? st.bg : "var(--pm-card)",
                  color: on ? st.color : "var(--pm-ink)",
                }}>
                {v}
              </button>
            );
          })}
        </div>
      </div>

      {/* identity */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 999, background: "var(--pm-green-soft)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <UserIcon size={18} style={{ color: "var(--pm-green)" }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--pm-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {display || "Unknown"}
          </div>
          <div style={{ fontSize: 12, color: "var(--pm-hint)" }}>{thread.contact.phone}</div>
        </div>
      </div>

      {/* CRM contact */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pm-hint)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
        CRM contact
      </div>
      {c ? (
        <div style={{ border: "1px solid var(--pm-border)", borderRadius: 8, padding: 10, marginBottom: 14 }}>
          {c.email && <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 4, wordBreak: "break-all" }}>{c.email}</div>}
          {(c.city || c.state) && (
            <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <MapPin size={11} /> {[c.city, c.state].filter(Boolean).join(", ")}
            </div>
          )}
          <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--pm-muted)", margin: "6px 0" }}>
            <span><strong style={{ color: "var(--pm-ink)" }}>{c.total_orders ?? 0}</strong> orders</span>
            <span>LTV <strong style={{ color: "var(--pm-ink)" }}>₹{Number(c.total_spent ?? 0).toLocaleString("en-IN")}</strong></span>
          </div>
          {c.tags && c.tags.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
              {c.tags.slice(0, 6).map((t) => (
                <span key={t} style={{ fontSize: 10, background: "rgba(185,28,74,0.08)", color: BRAND, padding: "1px 6px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <Tag size={9} /> {t}
                </span>
              ))}
            </div>
          )}
          <a href={`/dashboard/contacts/${c.id}`} target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: BRAND, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
            Open full profile <ExternalLink size={11} />
          </a>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--pm-hint)", marginBottom: 14 }}>
          No CRM contact matched this number yet.
        </div>
      )}

      {/* Shopify orders */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pm-hint)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
        <ShoppingBag size={12} /> Orders ({data?.order_count ?? 0})
      </div>
      {orders.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--pm-hint)" }}>
          No Shopify orders matched this WhatsApp number.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {orders.map((o) => {
            const link = o.admin_url || o.order_status_url || o.tracking_url;
            return (
              <div key={o.order_number} style={{ border: "1px solid var(--pm-border)", borderRadius: 8, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{o.order_number}</span>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{o.total}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--pm-hint)", marginBottom: 6 }}>{o.placed_at}</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: o.financial_status === "paid" ? "rgba(16,185,129,0.14)" : "rgba(245,183,49,0.14)", color: o.financial_status === "paid" ? "var(--pm-green)" : "#92400e", fontWeight: 600 }}>
                    {o.financial_status ?? "—"}
                  </span>
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: o.fulfillment_status === "fulfilled" ? "rgba(16,185,129,0.14)" : "rgba(229,231,235,0.7)", color: o.fulfillment_status === "fulfilled" ? "var(--pm-green)" : "var(--pm-muted)", fontWeight: 600 }}>
                    {o.fulfillment_status}
                  </span>
                </div>
                {o.items.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--pm-muted)", marginBottom: 6 }}>
                    {o.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}
                  </div>
                )}
                {link && (
                  <a href={link} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, color: BRAND, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>
                    {o.admin_url ? "View in Shopify" : "Track order"} <ExternalLink size={10} />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TemplatePicker({ templates, onCancel, onSend, busy }: {
  templates: Template[]; onCancel: () => void; onSend: (t: Template, vars: Record<string, string>) => void; busy?: boolean;
}) {
  const isMobile = useIsMobile();
  const [pick, setPick] = useState<Template | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const varNames = useMemo(() => {
    if (!pick) return [];
    const m = pick.body.match(/\{\{(\d+)\}\}/g) ?? [];
    return Array.from(new Set(m.map((s) => s.replace(/[{}]/g, ""))));
  }, [pick]);
  const preview = useMemo(() => {
    if (!pick) return "";
    return pick.body.replace(/\{\{(\d+)\}\}/g, (_, n) => vars[n] ?? `{{${n}}}`);
  }, [pick, vars]);

  return (
    <div style={{ padding: 12, borderTop: "1px solid var(--pm-border)", maxHeight: 320, overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Send approved template</strong>
        <button type="button" onClick={onCancel} style={{ background: "none", border: "none", color: "var(--pm-muted)", cursor: "pointer" }}>Cancel</button>
      </div>
      {!pick && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
          {templates.length === 0 && <div style={{ fontSize: 12, color: "var(--pm-hint)" }}>No approved templates yet.</div>}
          {templates.map((t) => (
            <button type="button" key={t.id} onClick={() => setPick(t)} style={{
              textAlign: "left", padding: 10, borderRadius: 8, border: "1px solid var(--pm-border)",
              background: "var(--pm-card)", cursor: "pointer",
            }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: "var(--pm-muted)", marginTop: 2 }}>{t.category} · {t.language}</div>
              <div style={{ fontSize: 12, color: "var(--pm-ink)", marginTop: 6, lineHeight: 1.3 }}>
                {t.body.slice(0, 100)}{t.body.length > 100 ? "…" : ""}
              </div>
            </button>
          ))}
        </div>
      )}
      {pick && (
        <div>
          <div style={{ marginBottom: 8, fontSize: 13 }}><strong>{pick.name}</strong> ({pick.language})</div>
          {varNames.map((n) => (
            <input key={n} placeholder={`{{${n}}}`} value={vars[n] ?? ""}
              onChange={(e) => setVars({ ...vars, [n]: e.target.value })}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--pm-border)", borderRadius: 8, marginBottom: 6, fontSize: 13 }} />
          ))}
          <div style={{ background: "var(--pm-app)", border: "1px solid var(--pm-border)", borderRadius: 8, padding: 10, fontSize: 13, whiteSpace: "pre-wrap", marginBottom: 8 }}>
            {preview}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setPick(null)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--pm-border)", background: "var(--pm-card)", cursor: "pointer", fontSize: 13 }}>Back</button>
            <button type="button" disabled={busy} onClick={() => onSend(pick, vars)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: BRAND, color: "var(--pm-card)", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1, fontWeight: 600, fontSize: 13 }}>{busy ? "Sending…" : "Send"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
