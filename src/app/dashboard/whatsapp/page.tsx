"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Send, Bot, User as UserIcon, Search, Plus, Upload, RefreshCw, Trash2,
  Tag, AlertTriangle, CheckCircle2, FileText, Sparkles, Megaphone, Ticket as TicketIcon,
  ExternalLink, ShoppingBag, MapPin, Archive, ArchiveRestore, ChevronLeft, X, ChevronDown,
  Check, CheckCheck, Phone, Clock,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import AnalyticsView from "@/components/whatsapp/AnalyticsView";
import { msgTime, mostRecent, timeAgo } from "./format";
import type {
  Tab, Contact, Thread, Message, Template, TemplateButton, KbDoc,
  TeamMember, Campaign, Recipient, RecipientSummary,
} from "@/components/whatsapp/types";
import {
  BRAND, WA_GREEN, priorityStyle, ticketStatusStyle, templateStatusColor,
  campaignStatusStyle, inputStyle, cardStyle, primaryBtn, smallBtn, chip, chipOn, fmtBtn,
} from "@/components/whatsapp/styles";
import { Modal, Field, Pill } from "@/components/whatsapp/primitives";
import TemplatesView from "@/components/whatsapp/TemplatesView";
import { WhatsAppPreview } from "@/components/whatsapp/WhatsAppPreview";


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

export default function WhatsAppPage() {
  const [tab, setTab] = useState<Tab>("inbox");

  return (
    <div className="pm-page">
      <Header />
      <StatusMeter />
      <Tabs tab={tab} onChange={setTab} />
      <div>
        {tab === "inbox" && <InboxView ticketsOnly={false} />}
        {tab === "tickets" && <InboxView ticketsOnly={true} />}
        {tab === "templates" && <TemplatesView />}
        {tab === "campaigns" && <CampaignsView />}
        {tab === "analytics" && <AnalyticsView />}
        {tab === "kb" && <KbView />}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="pm-head">
      <div>
        <h1>WhatsApp</h1>
        <p>Inbox, AI agent, templates &amp; tickets</p>
      </div>
    </div>
  );
}

/* WhatsApp uptime / health meter — polls /api/whatsapp/health every 30s.
   Collapsed to a single status pill above the inbox; click to expand the
   full uptime detail. */
function StatusMeter() {
  const [h, setH] = useState<any>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/whatsapp/health");
      setH(await r.json());
    } catch { /* keep last good reading */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const status: string = h?.status ?? "unknown";
  const dot = status === "up" ? WA_GREEN : status === "down" ? "var(--pm-terra)" : "var(--pm-hint)";
  const failed: number = h?.failedOutbound24h ?? 0;
  const statusLabel = status === "up" ? "Operational" : status === "down" ? "Down" : "Unknown";

  const cells: Array<{ label: string; value: string; color?: string; dot?: boolean }> = [
    { label: "Cloud API", dot: true, color: dot,
      value: statusLabel },
    { label: "Uptime 24h", value: h?.uptime24h != null ? `${h.uptime24h}%` : "—" },
    { label: "Uptime 7d", value: h?.uptime7d != null ? `${h.uptime7d}%` : "—" },
    { label: "Last message in", value: timeAgo(h?.lastInboundAt ?? null) },
    { label: "Outbound 24h", value: failed > 0 ? `${failed} failed` : "OK",
      color: failed > 0 ? "var(--pm-terra)" : WA_GREEN },
    { label: "AI replies 24h", value: String(h?.aiReplies24h ?? 0) },
  ];

  return (
    <div style={{ margin: "2px 0 14px" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={open ? "Hide health detail" : "Show health detail"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "var(--pm-card)", border: "1px solid var(--pm-border)",
          borderRadius: 999, padding: "6px 13px", fontSize: 13, fontWeight: 600,
          color: "var(--pm-ink)", cursor: "pointer",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: dot, display: "inline-block" }} />
        WhatsApp · {statusLabel}
        {failed > 0 && (
          <span style={{ color: "var(--pm-terra)", fontWeight: 600 }}>· {failed} failed</span>
        )}
        <ChevronDown
          size={13}
          style={{
            color: "var(--pm-hint)", transition: "transform .15s",
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </button>
      {open && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {cells.map((c) => (
            <div key={c.label} style={{
              flex: "1 1 120px", background: "var(--pm-card)", border: "1px solid var(--pm-border)",
              borderRadius: 10, padding: "9px 12px",
            }}>
              <div style={{ fontSize: 11, color: "var(--pm-hint)", marginBottom: 3, display: "flex", alignItems: "center", gap: 5 }}>
                {c.dot && <span style={{ width: 8, height: 8, borderRadius: 999, background: dot, display: "inline-block" }} />}
                {c.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: c.color ?? "var(--pm-ink)" }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const items: Array<{ key: Tab; label: string }> = [
    { key: "inbox", label: "Inbox" },
    { key: "tickets", label: "Tickets" },
    { key: "templates", label: "Templates" },
    { key: "campaigns", label: "Campaigns" },
    { key: "analytics", label: "Analytics" },
    { key: "kb", label: "Knowledge Base" },
  ];
  return (
    <div className="pm-tabs">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`pm-tab${tab === it.key ? " on" : ""}`}
          onClick={() => onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* INBOX                                                              */
/* ----------------------------------------------------------------- */

function InboxView({ ticketsOnly }: { ticketsOnly: boolean }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selected, setSelected] = useState<Thread | null>(null);
  const [status, setStatus] = useState<string>("");
  const [ticket, setTicket] = useState<string>(ticketsOnly ? "open" : "");
  const [search, setSearch] = useState("");
  const [assignFilter, setAssignFilter] = useState<"" | "mine" | "unassigned">("");
  const { members, me } = useTeam();
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const isMobile = useIsMobile();
  // On mobile we route between three full-width views; on desktop everything is visible.
  const [mobileView, setMobileView] = useState<"list" | "conv" | "details">("list");

  const load = useCallback(async () => {
    setLoading(true);
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
    setThreads(j.threads ?? []);
    setLoading(false);
  }, [status, ticket, search, assignFilter, me.email]);

  // Archive (hide) or unarchive a thread — never deletes messages.
  const archiveThread = useCallback(async (id: string, archived: boolean) => {
    await fetch(`/api/whatsapp/threads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    setSelected((s) => (s?.id === id ? null : s));
    load();
  }, [load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

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
                  {t.unread_count > 0 && (
                    <span style={{
                      marginLeft: "auto", background: BRAND, color: "var(--pm-card)", fontSize: 11,
                      fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                    }}>{t.unread_count}</span>
                  )}
                </div>
                {(isMobile || hover === t.id) && (
                  <button
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
          members={members}
        />
      </div>

      <CustomerPanel
        thread={selected}
        isMobile={isMobile}
        visible={!isMobile || mobileView === "details"}
        onClose={() => setMobileView("conv")}
      />
    </div>
  );
}


function ConversationPane({ thread, onChange, isMobile = false, onBack, onShowDetails, members = [] }: {
  thread: Thread | null;
  onChange: (t: Thread) => void;
  isMobile?: boolean;
  onBack?: () => void;
  onShowDetails?: () => void;
  members?: TeamMember[];
}) {
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [pickingTemplate, setPickingTemplate] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!thread) return;
    const r = await fetch(`/api/whatsapp/threads/${thread.id}`);
    const j = await r.json();
    setMessages(j.messages ?? []);
    setTimeout(() => scrollRef.current?.scrollTo({ top: 9e9, behavior: "smooth" }), 50);
  }, [thread]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/whatsapp/templates?status=approved").then((r) => r.json()).then((j) => setTemplates(j.templates ?? []));
  }, []);
  useEffect(() => {
    if (!thread) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load, thread]);

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
            <button onClick={onBack} aria-label="Back to inbox"
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
            <button onClick={onShowDetails} aria-label="Customer details"
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
            <button onClick={() => patch({ ticket_status: "resolved" })}
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
          {/* Labeled controls — without the tiny caption the three dropdowns
              read as mystery values ("Bot / Closed / Normal"). */}
          <div className="ctl">
            {!isMobile && <span>Handled by</span>}
            <select aria-label="Handled by" value={thread.status} onChange={(e) => patch({ status: e.target.value as any })}
              className="select">
              <option value="bot">Bot</option>
              <option value="human">Human</option>
              <option value="snoozed">Snoozed</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="ctl">
            {!isMobile && <span>Assigned</span>}
            <select aria-label="Assigned to" value={thread.assigned_to ?? ""} onChange={(e) => patch({ assigned_to: e.target.value || null })}
              className="select">
              <option value="">Unassigned</option>
              {members.filter((m) => m.email).map((m) => (
                <option key={m.id} value={m.email!}>{m.name}</option>
              ))}
            </select>
          </div>
          <div className="ctl">
            {!isMobile && <span>Ticket</span>}
            <select aria-label="Ticket status" value={thread.ticket_status} onChange={(e) => patch({ ticket_status: e.target.value as any })}
              className="select">
              <option value="none">No ticket</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="ctl">
            {!isMobile && <span>Priority</span>}
            <select aria-label="Ticket priority" value={thread.ticket_priority ?? "normal"} onChange={(e) => patch({ ticket_priority: e.target.value as any })}
              className="select">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
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
          onCancel={() => setPickingTemplate(false)}
          onSend={(tpl, vars) => send("template", { name: tpl.name, language: tpl.language, vars })}
        />
      ) : (
        <div style={{
          padding: isMobile ? "10px 10px calc(10px + env(safe-area-inset-bottom, 0px))" : 12,
          borderTop: "1px solid var(--pm-border)",
          display: "flex", gap: 8, alignItems: "center",
        }}>
          <button onClick={() => setPickingTemplate(true)} title="Send template" aria-label="Send template"
            style={{
              minWidth: 44, minHeight: 44, padding: isMobile ? 0 : "10px 14px", borderRadius: 10, border: "1px solid var(--pm-border)",
              background: "var(--pm-card)", cursor: "pointer", color: BRAND, fontWeight: 600, fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0,
            }}>
            <Megaphone size={isMobile ? 18 : 14} /> {!isMobile && "Template"}
          </button>
          <button onClick={draftReply} disabled={drafting} title="AI-draft a reply" aria-label="AI draft"
            style={{
              minWidth: 44, minHeight: 44, padding: isMobile ? 0 : "10px 14px", borderRadius: 10, border: "1px solid var(--pm-border)",
              background: "var(--pm-card)", cursor: drafting ? "wait" : "pointer", color: WA_GREEN, fontWeight: 600, fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0,
            }}>
            <Sparkles size={isMobile ? 18 : 14} /> {!isMobile && (drafting ? "Drafting…" : "AI draft")}
          </button>
          <input
            value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) send("text"); }}
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
          <button disabled={!text.trim() || sending} onClick={() => send("text")} aria-label="Send message"
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
function CustomerPanel({ thread, isMobile = false, visible = true, onClose }: {
  thread: Thread | null;
  isMobile?: boolean;
  visible?: boolean;
  onClose?: () => void;
}) {
  const [data, setData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!thread) { setData(null); return; }
    let live = true;
    setLoading(true);
    fetch(`/api/whatsapp/threads/${thread.id}/customer`)
      .then((r) => r.json())
      .then((j) => { if (live) setData(j?.error ? null : j); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [thread]);

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
          <button onClick={onClose} aria-label="Close details"
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

function TemplatePicker({ templates, onCancel, onSend }: {
  templates: Template[]; onCancel: () => void; onSend: (t: Template, vars: Record<string, string>) => void;
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
        <button onClick={onCancel} style={{ background: "none", border: "none", color: "var(--pm-muted)", cursor: "pointer" }}>Cancel</button>
      </div>
      {!pick && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
          {templates.length === 0 && <div style={{ fontSize: 12, color: "var(--pm-hint)" }}>No approved templates yet.</div>}
          {templates.map((t) => (
            <button key={t.id} onClick={() => setPick(t)} style={{
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
            <button onClick={() => setPick(null)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--pm-border)", background: "var(--pm-card)", cursor: "pointer", fontSize: 13 }}>Back</button>
            <button onClick={() => onSend(pick, vars)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: BRAND, color: "var(--pm-card)", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* TEMPLATES                                                          */
/* ----------------------------------------------------------------- */





/* ----------------------------------------------------------------- */
/* KNOWLEDGE BASE                                                     */
/* ----------------------------------------------------------------- */

function KbView() {
  const toast = useToast();
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const r = await fetch("/api/whatsapp/kb");
    const j = await r.json();
    setDocs(j.documents ?? []);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, []);

  async function upload(f: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("name", f.name);
      const r = await fetch("/api/whatsapp/kb", { method: "POST", body: fd });
      const j = await r.json();
      if (j.error) toast.push({ kind: "error", text: j.error });
      load();
    } finally { setUploading(false); }
  }

  async function reingest(id: string) {
    await fetch(`/api/whatsapp/kb/${id}`, { method: "POST" });
    load();
  }
  async function remove(id: string) {
    if (!confirm("Delete document and all embeddings?")) return;
    await fetch(`/api/whatsapp/kb/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "var(--pm-muted)" }}>
          Documents feed the AI agent. Upload PDFs/TXT or paste content. PDFs are parsed, chunked, and embedded.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setManualOpen(true)} style={smallBtn}><FileText size={14} /> Paste text</button>
          <button onClick={() => fileRef.current?.click()} style={primaryBtn} disabled={uploading}>
            <Upload size={14} /> {uploading ? "Uploading…" : "Upload PDF"}
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
        {docs.length === 0 && (
          <div style={{ gridColumn: "1/-1", padding: 32, textAlign: "center", color: "var(--pm-hint)", fontSize: 13 }}>
            No documents yet. Upload to start training the AI agent.
          </div>
        )}
        {docs.map((d) => (
          <div key={d.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
              <KbStatus s={d.status} />
            </div>
            <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 8 }}>
              {d.source_type} · {d.mime_type ?? "—"}
            </div>
            <div style={{ fontSize: 12, color: "var(--pm-ink)" }}>
              {d.chunk_count} chunks · {timeAgo(d.created_at)} ago
            </div>
            {d.error && <div style={{ fontSize: 11, color: "var(--pm-terra)", marginTop: 6 }}>{d.error}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button onClick={() => reingest(d.id)} style={smallBtn}><RefreshCw size={12} /> Re-ingest</button>
              <button onClick={() => remove(d.id)} style={{ ...smallBtn, color: "var(--pm-terra)" }}><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      {manualOpen && <ManualKbModal onClose={() => { setManualOpen(false); load(); }} />}
    </div>
  );
}

function KbStatus({ s }: { s: KbDoc["status"] }) {
  const map: Record<KbDoc["status"], { c: string; bg: string; icon: any }> = {
    ready:      { c: "var(--pm-green)", bg: "rgba(16,185,129,0.12)", icon: CheckCircle2 },
    processing: { c: "#1d4ed8", bg: "rgba(59,130,246,0.12)", icon: RefreshCw },
    pending:    { c: "#92400e", bg: "rgba(245,183,49,0.12)", icon: RefreshCw },
    failed:     { c: "var(--pm-terra)", bg: "rgba(239,68,68,0.12)",  icon: AlertTriangle },
  };
  const m = map[s];
  const I = m.icon;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: m.bg, color: m.c, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999 }}>
      <I size={11} /> {s}
    </span>
  );
}

function ManualKbModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    await fetch("/api/whatsapp/kb", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || "manual entry", text }),
    });
    setSaving(false);
    onClose();
  }
  return (
    <Modal onClose={onClose} title="Paste knowledge">
      <Field label="Title"><input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Return policy" /></Field>
      <Field label="Content">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12}
          style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
          placeholder="Paste FAQ, policy, product info…" />
      </Field>
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={smallBtn}>Cancel</button>
        <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? "Saving…" : "Ingest"}</button>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- */
/* Tiny UI primitives                                                 */
/* ----------------------------------------------------------------- */




/* ----------------------------------------------------------------- */
/* CAMPAIGNS — bulk marketing broadcast                               */
/* ----------------------------------------------------------------- */


// Per-campaign "who did this actually go to" view. Groups by contact, shows each
// person's final status + flags anyone messaged more than once (duplicate).
function RecipientsModal({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [data, setData] = useState<{ summary: RecipientSummary; recipients: Recipient[] } | null>(null);
  const [filter, setFilter] = useState<"all" | "received" | "failed" | "duplicate">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/whatsapp/campaigns/${campaign.id}/recipients`)
      .then((r) => r.json()).then((j) => setData(j)).catch(() => {}).finally(() => setLoading(false));
  }, [campaign.id]);

  const sb = data?.summary;
  const rows = (data?.recipients ?? []).filter((r) =>
    filter === "all" ? true :
    filter === "received" ? ["sent", "delivered", "read"].includes(r.status) :
    filter === "failed" ? r.status === "failed" :
    r.duplicate);

  const statusColor = (s: string) => s === "read" ? "var(--pm-green)" : s === "delivered" ? "var(--pm-green)" : s === "sent" ? "#1d4ed8" : s === "failed" ? "var(--pm-terra)" : "var(--pm-muted)";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--pm-card)", borderRadius: 14, width: "min(720px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--pm-border)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--pm-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{campaign.name}</div>
            <div style={{ fontSize: 12, color: "var(--pm-hint)" }}>Recipients &amp; delivery status</div>
          </div>
          <button type="button" title="Close" aria-label="Close" onClick={onClose} style={{ ...smallBtn, padding: "6px 9px" }}><X size={14} /></button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--pm-hint)" }}>Loading…</div>
        ) : !sb ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--pm-hint)" }}>No data.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, padding: "12px 20px", flexWrap: "wrap", borderBottom: "1px solid var(--pm-line)" }}>
              {[
                { k: "received", n: sb.received, l: "received", c: "var(--pm-green)" },
                { k: "read", n: sb.read, l: "read", c: "var(--pm-green)" },
                { k: "failed", n: sb.failed, l: "failed", c: "var(--pm-terra)" },
                { k: "duplicates", n: sb.duplicates, l: "got duplicates", c: sb.duplicates > 0 ? "var(--pm-terra)" : "var(--pm-muted)" },
                { k: "contacts", n: sb.contacts, l: "unique people", c: "var(--pm-ink)" },
              ].map((s) => (
                <div key={s.k} style={{ minWidth: 92 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: s.c }}>{s.n.toLocaleString("en-IN")}</div>
                  <div style={{ fontSize: 11, color: "var(--pm-hint)" }}>{s.l}</div>
                </div>
              ))}
            </div>

            <div className="pm-chips" style={{ padding: "10px 20px 4px" }}>
              {(["all", "received", "failed", "duplicate"] as const).map((f) => (
                <button key={f} type="button" className={`pm-chip${filter === f ? " on" : ""}`} onClick={() => setFilter(f)} style={{ fontSize: 12 }}>
                  {f === "all" ? "All" : f === "received" ? "Received" : f === "failed" ? "Failed" : "Duplicates"}
                </button>
              ))}
            </div>

            <div style={{ overflowY: "auto", padding: "8px 20px 16px" }}>
              {rows.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "var(--pm-hint)", fontSize: 13 }}>None.</div>
              ) : rows.map((r) => (
                <div key={r.contact_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--pm-line)" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.name || r.wa_id || "Unknown"}</span>
                    {r.name && r.wa_id && <span style={{ fontSize: 11, color: "var(--pm-hint)" }}> · {r.wa_id}</span>}
                    {r.error && <span style={{ display: "block", fontSize: 11, color: "var(--pm-terra)" }}>{r.error}</span>}
                  </span>
                  {r.duplicate && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--pm-terra)", background: "var(--pm-terra-soft)", padding: "2px 7px", borderRadius: 20 }}>×{r.attempts} DUP</span>}
                  <span style={{ fontSize: 12, fontWeight: 600, color: statusColor(r.status), textTransform: "capitalize", minWidth: 64, textAlign: "right" }}>{r.status}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CampaignsView() {
  const toast = useToast();
  const [list, setList] = useState<Campaign[]>([]);
  const [creating, setCreating] = useState(false);
  const [createSeg, setCreateSeg] = useState<string[] | null>(null);
  const [segs, setSegs] = useState<{ rfm_tier: string; customers: number; spend: number; avg_recency: number }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [recipientsFor, setRecipientsFor] = useState<Campaign | null>(null);
  const [recovery, setRecovery] = useState<
    { enrolled: number; recovered: number; delivered: number; retrying: number; missed: number; reached: number; reachRate: number } | null
  >(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/whatsapp/campaigns");
    const j = await r.json();
    setList(j.campaigns ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/whatsapp/segments").then((r) => r.json()).then((j) => setSegs(j.segments ?? [])).catch(() => {});
  }, []);
  useEffect(() => {
    const f = () => fetch("/api/whatsapp/cart-recovery").then((r) => r.json()).then((j) => setRecovery(j.stats ?? null)).catch(() => {});
    f();
    const t = setInterval(f, 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function send(c: Campaign) {
    if (!confirm(`Send "${c.name}" now? This messages every matching opted-in contact and is billed by Meta.`)) return;
    setBusy(c.id);
    try {
      const r = await fetch(`/api/whatsapp/campaigns/${c.id}/send`, { method: "POST" });
      const j = await r.json();
      if (j.error) toast.push({ kind: "error", text: "Send failed: " + j.error });
      else
        toast.push({
          kind: "success",
          text: `Done — ${j.sent} sent, ${j.failed} failed${j.remaining ? `, ${j.remaining} remaining (click Resume to continue)` : ""}.`,
        });
      load();
    } finally { setBusy(null); }
  }
  async function remove(id: string) {
    if (!confirm("Delete campaign?")) return;
    await fetch(`/api/whatsapp/campaigns/${id}`, { method: "DELETE" });
    load();
  }
  async function unschedule(id: string) {
    await fetch(`/api/whatsapp/campaigns/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "draft", scheduled_at: null }),
    });
    load();
  }
  async function importContacts() {
    if (!confirm("Import all Shopify-synced contacts (with a phone number) into WhatsApp contacts? Existing contacts are left untouched.")) return;
    setImporting(true);
    try {
      const r = await fetch("/api/whatsapp/import-contacts", { method: "POST" });
      const j = await r.json();
      if (j.error) toast.push({ kind: "error", text: "Import failed: " + j.error });
      else
        toast.push({
          kind: "success",
          text: `Imported ${j.imported} new contact(s) · scanned ${j.scanned}, skipped ${j.skipped} (no valid phone / duplicate) · ${j.total_wa_contacts} WhatsApp contacts total.`,
        });
    } finally { setImporting(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--pm-muted)" }}>
          Broadcast an approved marketing template to opted-in WhatsApp contacts. Meta bills per message.
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <button onClick={importContacts} disabled={importing} style={smallBtn}>
            <Upload size={14} /> {importing ? "Importing…" : "From Shopify"}
          </button>
          <button onClick={() => setCsvOpen(true)} style={smallBtn}>
            <FileText size={14} /> Upload CSV
          </button>
          <button onClick={() => setCreating(true)} style={primaryBtn}><Plus size={14} /> New campaign</button>
        </div>
      </div>

      {recovery && recovery.enrolled > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pm-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Abandoned-cart recovery · last 30 days
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10 }}>
            {[
              { n: recovery.reached, l: "Reached", hint: `${recovery.reachRate}% of ${recovery.enrolled} carts got a message`, color: "var(--pm-green)" },
              { n: recovery.recovered, l: "Recovered", hint: "checked out after the nudge", color: "var(--pm-green)" },
              { n: recovery.retrying, l: "Retrying", hint: "in-flight, not yet delivered", color: "var(--pm-gold)" },
              { n: recovery.missed, l: "Missed", hint: "deadline passed, never delivered", color: recovery.missed > 0 ? "var(--pm-terra)" : "var(--pm-hint)" },
            ].map((s) => (
              <div key={s.l} style={cardStyle}>
                <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.6, color: s.color }}>{s.n.toLocaleString("en-IN")}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pm-muted)", marginTop: 2 }}>{s.l}</div>
                <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 3, lineHeight: 1.3 }}>{s.hint}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {segs.length > 0 && (() => {
        const byTier = Object.fromEntries(segs.map((s) => [s.rfm_tier, s]));
        return (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pm-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
              Customer segments
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 10 }}>
              {SEGMENTS.map((seg) => {
                const rows = seg.tags.map((t) => byTier[t]).filter(Boolean);
                const customers = rows.reduce((a, r) => a + Number(r.customers), 0);
                const spend = rows.reduce((a, r) => a + Number(r.spend), 0);
                return (
                  <div key={seg.key} style={cardStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{seg.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--pm-green)" }}>{customers.toLocaleString("en-IN")}</div>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--pm-hint)", margin: "2px 0 8px" }}>{seg.hint}</div>
                    <div style={{ fontSize: 11, color: "var(--pm-muted)", marginBottom: 10 }}>
                      ₹{Math.round(spend).toLocaleString("en-IN")} lifetime spend
                    </div>
                    <button type="button" onClick={() => setCreateSeg([seg.key])} disabled={customers === 0} style={{ ...smallBtn, width: "100%", justifyContent: "center" }}>
                      <Megaphone size={12} /> Campaign
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 12 }}>
        {list.length === 0 && (
          <div style={{ gridColumn: "1/-1", padding: 32, textAlign: "center", color: "var(--pm-hint)", fontSize: 13 }}>
            No campaigns yet.
          </div>
        )}
        {list.map((c) => {
          const ss = campaignStatusStyle[c.status] ?? campaignStatusStyle.draft;
          const tags = c.audience_filter?.tags ?? [];
          return (
            <div key={c.id} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontWeight: 700 }}>{c.name}</div>
                <span style={{
                  background: ss.bg, color: ss.color, fontSize: 11, fontWeight: 700,
                  padding: "2px 8px", borderRadius: 999, textTransform: "capitalize",
                }}>{c.status}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 8 }}>
                <Megaphone size={11} style={{ verticalAlign: -1 }} /> {c.template?.name ?? "— no template —"}
                {tags.length ? ` · tags: ${tags.join(", ")}` : " · all opted-in"}
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 12, marginBottom: 8, flexWrap: "wrap" }}>
                <span><strong>{c.sent_count}</strong> sent</span>
                <span><strong>{c.delivered_count}</strong> delivered</span>
                <span><strong>{c.read_count}</strong> read</span>
                {c.failed_count > 0 && <span style={{ color: "var(--pm-terra)" }}><strong>{c.failed_count}</strong> failed</span>}
              </div>
              {c.last_error && <div style={{ fontSize: 11, color: "var(--pm-terra)", marginBottom: 8 }}>{c.last_error}</div>}
              {c.status === "scheduled" && c.scheduled_at && (
                <div style={{ fontSize: 11, color: "#1d4ed8", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                  <Clock size={11} /> {c.repeat_rule ? "Next" : "Scheduled for"} {new Date(c.scheduled_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              )}
              {c.repeat_rule && (
                <div style={{ fontSize: 11, color: "var(--pm-green)", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                  <RefreshCw size={11} /> Repeats {c.repeat_rule}{c.repeat_until ? ` until ${new Date(c.repeat_until).toLocaleDateString("en-IN", { dateStyle: "medium" })}` : ""}
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--pm-hint)", marginBottom: 10 }}>{timeAgo(c.created_at)} ago</div>
              <div style={{ display: "flex", gap: 6 }}>
                {(c.status === "draft" || c.status === "scheduled" || c.status === "failed") && (
                  <button onClick={() => send(c)} disabled={busy === c.id} style={primaryBtn}>
                    <Send size={13} /> {busy === c.id ? "Sending…" : "Send now"}
                  </button>
                )}
                {c.status === "scheduled" && (
                  <button type="button" onClick={() => unschedule(c.id)} style={smallBtn}>Unschedule</button>
                )}
                {c.status === "sending" && (
                  <button onClick={() => send(c)} disabled={busy === c.id} style={smallBtn}>
                    <RefreshCw size={12} /> {busy === c.id ? "Working…" : "Resume"}
                  </button>
                )}
                {(c.sent_count > 0 || c.failed_count > 0 || c.status === "completed" || c.status === "sending" || c.status === "cancelled") && (
                  <button type="button" onClick={() => setRecipientsFor(c)} style={smallBtn}>
                    <UserIcon size={12} /> Recipients
                  </button>
                )}
                <button type="button" title="Delete campaign" onClick={() => remove(c.id)} style={{ ...smallBtn, color: "var(--pm-terra)" }}><Trash2 size={12} /></button>
              </div>
            </div>
          );
        })}
      </div>

      {creating && <CampaignModal onClose={() => { setCreating(false); load(); }} />}
      {createSeg && <CampaignModal initialSegment={createSeg} onClose={() => { setCreateSeg(null); load(); }} />}
      {csvOpen && <CsvImportModal onClose={() => setCsvOpen(false)} />}
      {recipientsFor && <RecipientsModal campaign={recipientsFor} onClose={() => setRecipientsFor(null)} />}
    </div>
  );
}

// RFM segment presets → rfm:* tags written on wa_contacts by recompute_wa_rfm_tags()
// (nightly via wa-rfm-tick). Multi-select unions the tags, e.g. Loyal + VIP = repeat buyers.
const SEGMENTS: { key: string; label: string; hint: string; tags: string[] }[] = [
  { key: "vip", label: "VIP", hint: "₹3k+ spent or 5+ orders", tags: ["rfm:vip"] },
  { key: "loyal", label: "Loyal", hint: "2–4 orders, last ≤90d", tags: ["rfm:loyal"] },
  { key: "first", label: "First-time", hint: "single order so far", tags: ["rfm:new", "rfm:one_time"] },
  { key: "at_risk", label: "At-risk", hint: "lapsing, last 3–6 months", tags: ["rfm:at_risk"] },
  { key: "dormant", label: "Dormant", hint: "silent 6+ months", tags: ["rfm:dormant"] },
  // Prospects: opted-in phones with no purchase history yet (₹0 spend). Targeted by source tag.
  { key: "crm_import", label: "CRM contacts", hint: "imported, no order yet", tags: ["crm_import"] },
  { key: "order_phone", label: "Order phones", hint: "phone from an order, no spend matched", tags: ["order_phone"] },
  { key: "lead", label: "Leads", hint: "B2B / scraped prospects", tags: ["lead"] },
];

function CampaignModal({ onClose, initialSegment }: { onClose: () => void; initialSegment?: string[] }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [audienceMode, setAudienceMode] = useState<"all" | "segment" | "tags">(initialSegment?.length ? "segment" : "all");
  const [segSel, setSegSel] = useState<string[]>(initialSegment ?? []);
  const [tags, setTags] = useState("");
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [personalize, setPersonalize] = useState(false);
  const [brief, setBrief] = useState("");
  const [sendMode, setSendMode] = useState<"now" | "schedule">("now");
  const [scheduleAt, setScheduleAt] = useState("");
  const [repeatRule, setRepeatRule] = useState<"" | "daily" | "weekly" | "monthly">("");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/whatsapp/templates?status=approved")
      .then((r) => r.json()).then((j) => setTemplates(j.templates ?? []));
  }, []);

  const tpl = useMemo(() => templates.find((t) => t.id === templateId) ?? null, [templates, templateId]);
  const varNames = useMemo(() => {
    if (!tpl) return [];
    const m = tpl.body.match(/\{\{(\d+)\}\}/g) ?? [];
    return Array.from(new Set(m.map((s) => s.replace(/[{}]/g, ""))));
  }, [tpl]);

  // Resolve the active audience to a flat tag list. Segments are stored as
  // rfm:* tags on wa_contacts; "all" = no filter (every opted-in contact).
  const effectiveTags = useMemo(() => {
    if (audienceMode === "segment") {
      const out = new Set<string>();
      for (const key of segSel) {
        const seg = SEGMENTS.find((s) => s.key === key);
        for (const t of seg?.tags ?? []) out.add(t);
      }
      return Array.from(out);
    }
    if (audienceMode === "tags") return tags.split(",").map((t) => t.trim()).filter(Boolean);
    return [];
  }, [audienceMode, segSel, tags]);

  useEffect(() => {
    const qs = effectiveTags.length ? `?tags=${encodeURIComponent(effectiveTags.join(","))}` : "";
    fetch(`/api/whatsapp/audience${qs}`).then((r) => r.json()).then((j) => setAudienceCount(j.count ?? 0));
  }, [effectiveTags]);

  const preview = useMemo(() => {
    if (!tpl) return "";
    return tpl.body.replace(/\{\{(\d+)\}\}/g, (_, n) => vars[n] || `{{${n}}}`);
  }, [tpl, vars]);

  async function create(action: "draft" | "send" | "schedule") {
    if (!name.trim()) { toast.push({ kind: "error", text: "Campaign name required" }); return; }
    if (!templateId) { toast.push({ kind: "error", text: "Pick an approved template" }); return; }
    let scheduledIso: string | null = null;
    if (action === "schedule") {
      const ms = scheduleAt ? new Date(scheduleAt).getTime() : NaN;
      if (!ms) { toast.push({ kind: "error", text: "Pick a date & time to schedule." }); return; }
      if (ms <= Date.now()) { toast.push({ kind: "error", text: "Schedule time must be in the future." }); return; }
      scheduledIso = new Date(scheduleAt).toISOString();
    }
    setSaving(true);
    try {
      const audience_filter = effectiveTags.length ? { tags: effectiveTags } : {};
      const template_vars = personalize && brief.trim()
        ? { ...vars, _ai_brief: brief.trim() }
        : vars;
      const r = await fetch("/api/whatsapp/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, template_id: templateId, template_vars, audience_filter, scheduled_at: scheduledIso,
          repeat_rule: repeatRule || null,
          repeat_until: repeatRule && repeatUntil ? new Date(repeatUntil).toISOString() : null,
        }),
      });
      const j = await r.json();
      if (j.error) { toast.push({ kind: "error", text: j.error }); return; }
      if (action === "schedule") {
        toast.push({
          kind: "success",
          text: `Scheduled "${name}" for ${new Date(scheduledIso!).toLocaleString("en-IN")} — ≈${audienceCount ?? "?"} recipient(s). Auto-sends once the template is approved.`,
        });
        onClose(); return;
      }
      if (action === "send" && j.campaign?.id) {
        if (!confirm(`Send "${name}" to ≈${audienceCount ?? "?"} contact(s) now? Meta bills per message.`)) {
          onClose(); return;
        }
        const sr = await fetch(`/api/whatsapp/campaigns/${j.campaign.id}/send`, { method: "POST" });
        const sj = await sr.json();
        if (sj.error) toast.push({ kind: "error", text: "Send failed: " + sj.error });
        else
          toast.push({
            kind: "success",
            text: `Done — ${sj.sent} sent, ${sj.failed} failed${sj.remaining ? `, ${sj.remaining} remaining` : ""}.`,
          });
      }
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title="New marketing campaign">
      <Field label="Campaign name">
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Diwali offer 2026" />
      </Field>
      <Field label="Template — approved marketing templates only">
        <select aria-label="Campaign template" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setVars({}); }} style={inputStyle}>
          <option value="">— pick a template —</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
        </select>
      </Field>
      {templates.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--pm-terra)", marginBottom: 10 }}>
          No approved templates yet. Create one in the Templates tab and get it approved by Meta first.
        </div>
      )}
      {varNames.length > 0 && (
        <Field label="Template variables — tip: type {name} to insert each contact's name">
          {varNames.map((n) => (
            <input key={n} placeholder={`{{${n}}}`} value={vars[n] ?? ""}
              onChange={(e) => setVars({ ...vars, [n]: e.target.value })}
              style={{ ...inputStyle, marginBottom: 6 }} />
          ))}
        </Field>
      )}
      {tpl && (
        <div style={{ marginBottom: 10 }}>
          <WhatsAppPreview headerType={tpl.header_type} headerMediaUrl={tpl.header_media_url}
            headerText={tpl.header_text} body={preview} footer={tpl.footer} buttons={tpl.buttons} />
        </div>
      )}
      {tpl && (
        <Field label="AI personalization (optional)">
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={personalize} onChange={(e) => setPersonalize(e.target.checked)} />
            <Sparkles size={13} style={{ color: WA_GREEN }} /> Personalize each message with AI
          </label>
          {personalize && (
            <div style={{ marginTop: 8 }}>
              <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3}
                style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
                placeholder="Brief for the AI — e.g. 'Recommend a snack based on the customer's tags; mention our Diwali 15% offer; keep it short and warm.'" />
              <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 4 }}>
                OpenAI fills the template variables per contact from this brief + their profile. The values above are the fallback if AI fails. Sending is slower — one AI call per contact.
              </div>
            </div>
          )}
        </Field>
      )}
      <Field label="Audience">
        <div style={{ display: "flex", gap: 14, marginBottom: 8 }}>
          <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" checked={audienceMode === "all"} onChange={() => setAudienceMode("all")} /> Everyone
          </label>
          <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" checked={audienceMode === "segment"} onChange={() => setAudienceMode("segment")} /> By segment
          </label>
          <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" checked={audienceMode === "tags"} onChange={() => setAudienceMode("tags")} /> By tags
          </label>
        </div>
        {audienceMode === "segment" && (
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SEGMENTS.map((s) => {
                const on = segSel.includes(s.key);
                return (
                  <button key={s.key} type="button" title={s.hint}
                    onClick={() => setSegSel((prev) => on ? prev.filter((k) => k !== s.key) : [...prev, s.key])}
                    style={{
                      fontSize: 12, padding: "5px 10px", borderRadius: 999, cursor: "pointer",
                      border: `1px solid ${on ? "var(--pm-green)" : "var(--pm-border)"}`,
                      background: on ? "var(--pm-green)" : "transparent",
                      color: on ? "#fff" : "var(--pm-ink)", fontWeight: on ? 600 : 400,
                    }}>
                    {s.label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 6 }}>
              {segSel.length
                ? SEGMENTS.filter((s) => segSel.includes(s.key)).map((s) => `${s.label}: ${s.hint}`).join("  ·  ")
                : "Pick one or more segments. Refreshed nightly from Shopify order history."}
            </div>
          </div>
        )}
        {audienceMode === "tags" && (
          <input value={tags} onChange={(e) => setTags(e.target.value)} style={inputStyle}
            placeholder="vip, repeat_buyer (comma-separated)" />
        )}
      </Field>
      <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 12 }}>
        ≈ <strong>{audienceCount ?? "…"}</strong> opted-in recipient(s) will receive this.
      </div>
      <Field label="When to send">
        <div style={{ display: "flex", gap: 14, marginBottom: 8 }}>
          <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" checked={sendMode === "now"} onChange={() => setSendMode("now")} /> Send now
          </label>
          <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" checked={sendMode === "schedule"} onChange={() => setSendMode("schedule")} />
            <Clock size={13} /> Schedule for later
          </label>
        </div>
        {sendMode === "schedule" && (
          <>
            <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} style={inputStyle} />
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--pm-muted)" }}>Repeat</span>
              <select value={repeatRule} onChange={(e) => setRepeatRule(e.target.value as typeof repeatRule)} style={{ ...inputStyle, width: "auto", flex: "0 0 auto" }}>
                <option value="">One-time</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              {repeatRule && (
                <>
                  <span style={{ fontSize: 12, color: "var(--pm-muted)" }}>until</span>
                  <input type="date" value={repeatUntil} onChange={(e) => setRepeatUntil(e.target.value)} style={{ ...inputStyle, width: "auto", flex: "0 0 auto" }} />
                  <span style={{ fontSize: 11, color: "var(--pm-hint)" }}>(blank = forever)</span>
                </>
              )}
            </div>
            <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 4 }}>
              Your local time. Fires within ~15 min of this slot. If the template isn't Meta-approved yet, it waits and auto-sends once it is.
              {repeatRule && " Each occurrence is a fresh send, so opted-in contacts get it every cycle."}
            </div>
          </>
        )}
      </Field>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={smallBtn}>Cancel</button>
        <button onClick={() => create("draft")} disabled={saving} style={smallBtn}>Save draft</button>
        {sendMode === "schedule" ? (
          <button onClick={() => create("schedule")} disabled={saving} style={primaryBtn}>
            <Clock size={13} /> {saving ? "Working…" : "Schedule"}
          </button>
        ) : (
          <button onClick={() => create("send")} disabled={saving} style={primaryBtn}>
            <Send size={13} /> {saving ? "Working…" : "Save & send"}
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- */
/* CSV CONTACT IMPORT                                                 */
/* ----------------------------------------------------------------- */

// Minimal RFC-4180-ish CSV parser: handles quotes, escaped quotes ("")
// and embedded commas/newlines inside quoted fields.
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { endField(); i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { endField(); endRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length > 0) { endField(); endRow(); }
  const all = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  const headers = all.shift() ?? [];
  return { headers, rows: all };
}

function CsvImportModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState("");
  const [phoneCol, setPhoneCol] = useState(-1);
  const [nameCol, setNameCol] = useState(-1);
  const [emailCol, setEmailCol] = useState(-1);
  const [importing, setImporting] = useState(false);

  function onFile(f: File) {
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const { headers: h, rows: r } = parseCSV(String(reader.result ?? ""));
      setHeaders(h);
      setRows(r);
      const find = (kws: string[]) => h.findIndex((x) => kws.some((k) => x.toLowerCase().includes(k)));
      setPhoneCol(find(["phone", "mobile", "whatsapp", "number", "contact"]));
      setNameCol(find(["first name", "full name", "name"]));
      setEmailCol(find(["email", "e-mail", "mail"]));
    };
    reader.readAsText(f);
  }

  async function doImport() {
    if (phoneCol < 0) { toast.push({ kind: "error", text: "Pick the phone-number column." }); return; }
    setImporting(true);
    try {
      const payload = rows.map((r) => ({
        phone: r[phoneCol] ?? "",
        name: nameCol >= 0 ? (r[nameCol] ?? "") : "",
        email: emailCol >= 0 ? (r[emailCol] ?? "") : "",
      }));
      const res = await fetch("/api/whatsapp/import-csv", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload, tag: "csv_import" }),
      });
      const j = await res.json();
      if (j.error) toast.push({ kind: "error", text: "Import failed: " + j.error });
      else
        toast.push({
          kind: "success",
          text: `Imported ${j.imported} new contact(s) · scanned ${j.scanned}, skipped ${j.skipped} (no valid phone / duplicate) · ${j.total_wa_contacts} WhatsApp contacts total.`,
        });
      onClose();
    } finally { setImporting(false); }
  }

  const colSelect = (value: number, set: (n: number) => void, label: string, optional: boolean) => (
    <select aria-label={label} value={value} onChange={(e) => set(Number(e.target.value))} style={inputStyle}>
      <option value={-1}>{optional ? "— none —" : "— select —"}</option>
      {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
    </select>
  );

  return (
    <Modal onClose={onClose} title="Upload contacts from CSV">
      <input type="file" accept=".csv,text/csv" aria-label="CSV file"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        style={{ marginBottom: 12, fontSize: 13 }} />
      {headers.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 10 }}>
            {fileName} — {rows.length} row(s), {headers.length} column(s). Map the columns:
          </div>
          <Field label="Phone column (required)">{colSelect(phoneCol, setPhoneCol, "Phone column", false)}</Field>
          <Field label="Name column (optional)">{colSelect(nameCol, setNameCol, "Name column", true)}</Field>
          <Field label="Email column (optional)">{colSelect(emailCol, setEmailCol, "Email column", true)}</Field>
          <div style={{ fontSize: 11, color: "var(--pm-hint)", marginBottom: 12 }}>
            Phone numbers are normalised automatically (10-digit Indian numbers get +91). Imported contacts are tagged
            <strong> csv_import</strong> and marked opted-in — only upload customers who agreed to WhatsApp messages.
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={smallBtn}>Cancel</button>
        <button onClick={doImport} disabled={importing || headers.length === 0} style={primaryBtn}>
          <Upload size={14} /> {importing ? "Importing…" : "Import"}
        </button>
      </div>
    </Modal>
  );
}
