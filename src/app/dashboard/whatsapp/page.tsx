"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare, Send, Bot, User as UserIcon, Search, Plus, Upload, RefreshCw, Trash2,
  Tag, AlertTriangle, CheckCircle2, Inbox as InboxIcon, FileText, Sparkles, Megaphone, Ticket as TicketIcon,
} from "lucide-react";

type Tab = "inbox" | "templates" | "kb" | "tickets";

type Contact = { id: string; wa_id: string; phone: string; name: string | null; tags?: string[] | null };
type Thread = {
  id: string;
  wa_id: string;
  status: "bot" | "human" | "snoozed" | "closed";
  ticket_status: "none" | "open" | "pending" | "resolved" | "closed";
  ticket_number: number;
  ticket_priority: "low" | "normal" | "high" | "urgent" | null;
  ticket_category: string | null;
  ticket_subject: string | null;
  ticket_assignee: string | null;
  escalation_reason: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_message_snippet: string | null;
  unread_count: number;
  contact: Contact;
};
type Message = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  media_url: string | null;
  status: string;
  template_name: string | null;
  sent_by: string | null;
  ai_meta: any;
  created_at: string;
};
type Template = {
  id: string;
  name: string;
  language: string;
  category: "marketing" | "utility" | "authentication" | "offer";
  status: string;
  body: string;
  footer: string | null;
  header_text: string | null;
  variables: any;
};
type KbDoc = {
  id: string;
  name: string;
  source_type: string;
  mime_type: string | null;
  status: "pending" | "processing" | "ready" | "failed";
  chunk_count: number;
  error: string | null;
  created_at: string;
};

const BRAND = "var(--accent)";
const BRAND_DARK = "#8B1539";
const WA_GREEN = "#25D366";

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const priorityStyle: Record<string, { bg: string; color: string }> = {
  urgent: { bg: "rgba(239,68,68,0.12)", color: "var(--accent)" },
  high:   { bg: "rgba(249,115,22,0.12)", color: "var(--amber)" },
  normal: { bg: "rgba(59,130,246,0.10)", color: "#1d4ed8" },
  low:    { bg: "rgba(107,114,128,0.10)", color: "var(--text-2)" },
};

const ticketStatusStyle: Record<string, { bg: string; color: string; label: string }> = {
  open:     { bg: "rgba(245,183,49,0.14)", color: "#92400e", label: "Open" },
  pending:  { bg: "rgba(59,130,246,0.14)", color: "#1d4ed8", label: "Pending" },
  resolved: { bg: "rgba(16,185,129,0.14)", color: "var(--green)", label: "Resolved" },
  closed:   { bg: "rgba(107,114,128,0.14)", color: "var(--text-2)", label: "Closed" },
  none:     { bg: "rgba(229,231,235,0.6)",  color: "var(--text-2)", label: "—" },
};

export default function WhatsAppPage() {
  const [tab, setTab] = useState<Tab>("inbox");

  return (
    <div className="page">
      <Header />
      <Tabs tab={tab} onChange={setTab} />
      <div>
        {tab === "inbox" && <InboxView ticketsOnly={false} />}
        {tab === "tickets" && <InboxView ticketsOnly={true} />}
        {tab === "templates" && <TemplatesView />}
        {tab === "kb" && <KbView />}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="page-head">
      <div>
        <h1>
          <span className="head-icon" style={{ background: "var(--green-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.9">
              <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 21l2-5.5a8.5 8.5 0 0 1 7.5-12 8.38 8.38 0 0 1 8.5 8z" />
            </svg>
          </span>
          WhatsApp
        </h1>
        <div className="sub">Inbox, AI agent, templates &amp; tickets</div>
      </div>
    </div>
  );
}

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const items: Array<{ key: Tab; label: string }> = [
    { key: "inbox", label: "Inbox" },
    { key: "tickets", label: "Tickets" },
    { key: "templates", label: "Templates" },
    { key: "kb", label: "Knowledge Base" },
  ];
  return (
    <div className="tabs">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`tab${tab === it.key ? " active" : ""}`}
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (ticket) qs.set("ticket", ticket);
    if (search) qs.set("search", search);
    qs.set("limit", "60");
    const res = await fetch(`/api/whatsapp/threads?${qs}`);
    const j = await res.json();
    setThreads(j.threads ?? []);
    setLoading(false);
  }, [status, ticket, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 16, height: "calc(100vh - 200px)" }}>
      <div style={{
        background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12,
        overflow: "hidden", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
          <div style={{ position: "relative", marginBottom: 8 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--text-3)" }} />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search phone or message…"
              style={{
                width: "100%", padding: "8px 8px 8px 32px", borderRadius: 8,
                border: "1px solid var(--border)", fontSize: 13, outline: "none",
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
                ]
            ).map((f) => {
              const active = ticketsOnly ? ticket === f.k : status === f.k;
              return (
                <button key={f.l}
                  onClick={() => (ticketsOnly ? setTicket(f.k) : setStatus(f.k))}
                  style={{
                    padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                    border: "1px solid " + (active ? BRAND : "var(--border)"),
                    background: active ? "rgba(185,28,74,0.08)" : "var(--card-bg)",
                    color: active ? BRAND : "var(--text-2)", cursor: "pointer",
                  }}>{f.l}</button>
              );
            })}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && <div style={{ padding: 24, color: "var(--text-3)", fontSize: 13 }}>Loading…</div>}
          {!loading && threads.length === 0 && (
            <div style={{ padding: 24, color: "var(--text-3)", fontSize: 13 }}>No conversations yet.</div>
          )}
          {threads.map((t) => {
            const active = selected?.id === t.id;
            return (
              <button key={t.id} onClick={() => setSelected(t)}
                style={{
                  width: "100%", textAlign: "left", padding: 12,
                  border: "none", borderBottom: "1px solid var(--border)",
                  background: active ? "rgba(185,28,74,0.06)" : "var(--card-bg)",
                  cursor: "pointer",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
                    {t.contact.name || t.contact.phone}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>{timeAgo(t.last_inbound_at)}</div>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.last_message_snippet || "—"}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Pill icon={t.status === "bot" ? Bot : UserIcon} label={t.status}
                    bg={t.status === "bot" ? "rgba(37,211,102,0.12)" : "rgba(59,130,246,0.12)"}
                    color={t.status === "bot" ? "var(--green)" : "#1d4ed8"} />
                  {t.ticket_status !== "none" && (
                    <Pill icon={TicketIcon} label={`#${t.ticket_number} ${ticketStatusStyle[t.ticket_status].label}`}
                      bg={ticketStatusStyle[t.ticket_status].bg} color={ticketStatusStyle[t.ticket_status].color} />
                  )}
                  {t.ticket_priority && t.ticket_status !== "none" && (
                    <Pill icon={AlertTriangle} label={t.ticket_priority}
                      bg={priorityStyle[t.ticket_priority].bg} color={priorityStyle[t.ticket_priority].color} />
                  )}
                  {t.unread_count > 0 && (
                    <span style={{
                      marginLeft: "auto", background: BRAND, color: "var(--card-bg)", fontSize: 11,
                      fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                    }}>{t.unread_count}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <ConversationPane thread={selected} onChange={(t) => { setSelected(t); load(); }} />
    </div>
  );
}

function Pill({ icon: Icon, label, bg, color }: { icon: any; label: string; bg: string; color: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: bg, color, fontSize: 11, fontWeight: 600,
      padding: "2px 8px", borderRadius: 999, textTransform: "capitalize",
    }}>
      <Icon size={11} /> {label}
    </span>
  );
}

function ConversationPane({ thread, onChange }: { thread: Thread | null; onChange: (t: Thread) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [pickingTemplate, setPickingTemplate] = useState(false);
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
        background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12,
        display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 14,
      }}>
        Pick a conversation
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
      if (j.ok === false || j.error) alert("Send failed: " + (j.error ?? "unknown"));
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

  return (
    <div style={{
      background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{ padding: 14, borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 700, color: "var(--text)" }}>
            {thread.contact.name || thread.contact.phone}
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, color: "var(--text-2)" }}>{thread.contact.phone}</span>
          </div>
          <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Pill icon={thread.status === "bot" ? Bot : UserIcon} label={thread.status}
              bg={thread.status === "bot" ? "rgba(37,211,102,0.12)" : "rgba(59,130,246,0.12)"}
              color={thread.status === "bot" ? "var(--green)" : "#1d4ed8"} />
            {thread.ticket_status !== "none" && (
              <Pill icon={TicketIcon} label={`#${thread.ticket_number} ${ticketStatusStyle[thread.ticket_status].label}`}
                bg={ticketStatusStyle[thread.ticket_status].bg} color={ticketStatusStyle[thread.ticket_status].color} />
            )}
            {thread.ticket_priority && thread.ticket_status !== "none" && (
              <Pill icon={AlertTriangle} label={thread.ticket_priority}
                bg={priorityStyle[thread.ticket_priority].bg} color={priorityStyle[thread.ticket_priority].color} />
            )}
          </div>
          {thread.escalation_reason && (
            <div style={{ fontSize: 12, color: "#92400e", marginTop: 6 }}>
              <AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {thread.escalation_reason}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <select value={thread.status} onChange={(e) => patch({ status: e.target.value as any })}
            style={selectStyle}>
            <option value="bot">Bot</option>
            <option value="human">Human</option>
            <option value="snoozed">Snoozed</option>
            <option value="closed">Closed</option>
          </select>
          <select value={thread.ticket_status} onChange={(e) => patch({ ticket_status: e.target.value as any })}
            style={selectStyle}>
            <option value="none">No ticket</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <select value={thread.ticket_priority ?? "normal"} onChange={(e) => patch({ ticket_priority: e.target.value as any })}
            style={selectStyle}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 18, background: "#f0f2f5" }}>
        {messages.map((m) => {
          const out = m.direction === "outbound";
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: out ? "flex-end" : "flex-start", marginBottom: 8 }}>
              <div style={{
                maxWidth: "70%", background: out ? "#dcf8c6" : "var(--card-bg)",
                color: "var(--text)", padding: "8px 12px", borderRadius: 10,
                boxShadow: "0 1px 1px rgba(0,0,0,0.06)", fontSize: 14, lineHeight: 1.45,
              }}>
                {m.template_name && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: BRAND, marginBottom: 4 }}>
                    Template · {m.template_name}
                  </div>
                )}
                {m.media_url && (
                  <a href={m.media_url} target="_blank" rel="noreferrer" style={{ color: "#1d4ed8", fontSize: 12 }}>
                    [media: {m.type}]
                  </a>
                )}
                <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 4, fontSize: 10, color: "var(--text-2)" }}>
                  {m.sent_by === "bot" && <span style={{ color: WA_GREEN, fontWeight: 600 }}><Sparkles size={10} style={{ verticalAlign: -1 }} /> AI</span>}
                  <span>{timeAgo(m.created_at)}</span>
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
        <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
          <button onClick={() => setPickingTemplate(true)} title="Send template"
            style={{
              padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)",
              background: "var(--card-bg)", cursor: "pointer", color: BRAND, fontWeight: 600, fontSize: 13,
              display: "flex", alignItems: "center", gap: 6,
            }}>
            <Megaphone size={14} /> Template
          </button>
          <input
            value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) send("text"); }}
            placeholder="Type a message…"
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 10,
              border: "1px solid var(--border)", outline: "none", fontSize: 14,
            }}
          />
          <button disabled={!text.trim() || sending} onClick={() => send("text")}
            style={{
              padding: "10px 16px", borderRadius: 10, border: "none",
              background: text.trim() ? BRAND : "var(--border)",
              color: "var(--card-bg)", fontWeight: 600, cursor: text.trim() ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", gap: 6,
            }}>
            <Send size={14} /> Send
          </button>
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12,
  background: "var(--card-bg)", color: "var(--text)", outline: "none",
};

function TemplatePicker({ templates, onCancel, onSend }: {
  templates: Template[]; onCancel: () => void; onSend: (t: Template, vars: Record<string, string>) => void;
}) {
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
    <div style={{ padding: 12, borderTop: "1px solid var(--border)", maxHeight: 320, overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Send approved template</strong>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: "var(--text-2)", cursor: "pointer" }}>Cancel</button>
      </div>
      {!pick && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {templates.length === 0 && <div style={{ fontSize: 12, color: "var(--text-3)" }}>No approved templates yet.</div>}
          {templates.map((t) => (
            <button key={t.id} onClick={() => setPick(t)} style={{
              textAlign: "left", padding: 10, borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--card-bg)", cursor: "pointer",
            }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }}>{t.category} · {t.language}</div>
              <div style={{ fontSize: 12, color: "var(--text)", marginTop: 6, lineHeight: 1.3 }}>
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
              style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 6, fontSize: 13 }} />
          ))}
          <div style={{ background: "var(--canvas)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontSize: 13, whiteSpace: "pre-wrap", marginBottom: 8 }}>
            {preview}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setPick(null)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card-bg)", cursor: "pointer", fontSize: 13 }}>Back</button>
            <button onClick={() => onSend(pick, vars)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: BRAND, color: "var(--card-bg)", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* TEMPLATES                                                          */
/* ----------------------------------------------------------------- */

function TemplatesView() {
  const [list, setList] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);

  async function load() {
    const r = await fetch("/api/whatsapp/templates");
    const j = await r.json();
    setList(j.templates ?? []);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    const r = await fetch("/api/whatsapp/templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    const j = await r.json();
    if (j.error) { alert(j.error); return; }
    setEditing(null);
    load();
  }
  async function remove(id: string) {
    if (!confirm("Delete template?")) return;
    await fetch(`/api/whatsapp/templates/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "var(--text-2)" }}>
          Templates sent through Meta WABA. Submit them for approval, then send to opted-in contacts.
        </div>
        <button onClick={() => setEditing({ category: "marketing", language: "en", status: "draft", body: "" })}
          style={primaryBtn}>
          <Plus size={14} /> New template
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 12 }}>
        {list.map((t) => (
          <div key={t.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>{t.name}</div>
              <Pill icon={t.category === "offer" ? Megaphone : FileText} label={t.category}
                bg="rgba(185,28,74,0.08)" color={BRAND} />
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
              {t.language} · <span style={{
                color: t.status === "approved" ? "var(--green)" : t.status === "rejected" ? "var(--accent)" : "#92400e", fontWeight: 600,
              }}>{t.status}</span>
            </div>
            {t.header_text && <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{t.header_text}</div>}
            <div style={{ fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{t.body}</div>
            {t.footer && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>{t.footer}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button onClick={() => setEditing(t)} style={smallBtn}>Edit</button>
              <button onClick={() => remove(t.id)} style={{ ...smallBtn, color: "var(--accent)" }}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "Edit template" : "New template"}>
          <Field label="Name (lowercase, underscores)">
            <input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="diwali_offer_2026" style={inputStyle} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Field label="Category">
              <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as any })} style={inputStyle}>
                <option value="marketing">Marketing</option>
                <option value="offer">Offer</option>
                <option value="utility">Utility</option>
                <option value="authentication">Authentication</option>
              </select>
            </Field>
            <Field label="Language"><input value={editing.language ?? "en"} onChange={(e) => setEditing({ ...editing, language: e.target.value })} style={inputStyle} /></Field>
            <Field label="Status">
              <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as any })} style={inputStyle}>
                <option value="draft">Draft</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="disabled">Disabled</option>
              </select>
            </Field>
          </div>
          <Field label="Header text (optional)">
            <input value={editing.header_text ?? ""} onChange={(e) => setEditing({ ...editing, header_text: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Body — use {{1}}, {{2}} for variables">
            <textarea value={editing.body ?? ""} onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              rows={6} style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }} />
          </Field>
          <Field label="Footer (optional)">
            <input value={editing.footer ?? ""} onChange={(e) => setEditing({ ...editing, footer: e.target.value })} style={inputStyle} />
          </Field>
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button onClick={() => setEditing(null)} style={smallBtn}>Cancel</button>
            <button onClick={save} style={primaryBtn}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* KNOWLEDGE BASE                                                     */
/* ----------------------------------------------------------------- */

function KbView() {
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
      if (j.error) alert(j.error);
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
        <div style={{ fontSize: 13, color: "var(--text-2)" }}>
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
          <div style={{ gridColumn: "1/-1", padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            No documents yet. Upload to start training the AI agent.
          </div>
        )}
        {docs.map((d) => (
          <div key={d.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
              <KbStatus s={d.status} />
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
              {d.source_type} · {d.mime_type ?? "—"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text)" }}>
              {d.chunk_count} chunks · {timeAgo(d.created_at)} ago
            </div>
            {d.error && <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 6 }}>{d.error}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button onClick={() => reingest(d.id)} style={smallBtn}><RefreshCw size={12} /> Re-ingest</button>
              <button onClick={() => remove(d.id)} style={{ ...smallBtn, color: "var(--accent)" }}><Trash2 size={12} /></button>
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
    ready:      { c: "var(--green)", bg: "rgba(16,185,129,0.12)", icon: CheckCircle2 },
    processing: { c: "#1d4ed8", bg: "rgba(59,130,246,0.12)", icon: RefreshCw },
    pending:    { c: "#92400e", bg: "rgba(245,183,49,0.12)", icon: RefreshCw },
    failed:     { c: "var(--accent)", bg: "rgba(239,68,68,0.12)",  icon: AlertTriangle },
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

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--card-bg)", borderRadius: 12, padding: 20, width: "min(560px,92vw)", maxHeight: "88vh", overflowY: "auto",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", border: "1px solid var(--border)",
  borderRadius: 8, fontSize: 13, outline: "none", background: "var(--card-bg)", color: "var(--text)",
};
const cardStyle: React.CSSProperties = {
  background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 14,
};
const primaryBtn: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 8, border: "none", background: BRAND,
  color: "var(--card-bg)", fontWeight: 600, fontSize: 13, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
};
const smallBtn: React.CSSProperties = {
  padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--card-bg)", color: "var(--text)", fontSize: 12, fontWeight: 600,
  cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
};
