"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Send, Bot, User as UserIcon, Search, RefreshCw, Instagram, Handshake,
  ShoppingBag, Ban, HelpCircle, Settings as SettingsIcon, ChevronLeft, ExternalLink,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "./instagram.module.css";

type Classification = "collab" | "order" | "spam" | "unknown";
type Stage = "new" | "in_convo" | "terms_sent" | "agreed" | "shipped" | "posted" | "declined";

type Thread = {
  id: string;
  ig_user_id: string;
  handle: string | null;
  full_name: string | null;
  status: "bot" | "human";
  classification: Classification;
  collab_stage: Stage | null;
  followers: number | null;
  engagement_rate: number | null;
  band_fit: boolean | null;
  last_activity_at: string | null;
  last_message_snippet: string | null;
  unread_count: number;
  ticket_status: string | null;
  ticket_priority: string | null;
};
type Message = {
  id: string;
  direction: "inbound" | "outbound";
  kind: string;
  text: string | null;
  status: string;
  sent_by: string | null;
  ai_generated: boolean;
  created_at: string;
};
type Settings = {
  paused: boolean;
  auto_reply_enabled: boolean;
  auto_reply_scope: "routine_only" | "all";
  auto_reply_comments: boolean;
  escalate_to_slack: boolean;
  min_followers: number;
  max_followers: number;
  barter_terms: string | null;
};

type Tab = "inbox" | "collab" | "needs_human" | "spam" | "settings";

const STAGES: Stage[] = ["new", "in_convo", "terms_sent", "agreed", "shipped", "posted", "declined"];
const STAGE_LABEL: Record<Stage, string> = {
  new: "New", in_convo: "In convo", terms_sent: "Terms sent", agreed: "Agreed",
  shipped: "Shipped", posted: "Posted", declined: "Declined",
};
const CLASS_META: Record<Classification, { label: string; cls: string; icon: ReactNode }> = {
  collab: { label: "Collab", cls: styles.tagCollab, icon: <Handshake size={12} /> },
  order: { label: "Order/Q", cls: styles.tagOrder, icon: <ShoppingBag size={12} /> },
  spam: { label: "Spam", cls: styles.tagSpam, icon: <Ban size={12} /> },
  unknown: { label: "Unknown", cls: styles.tagUnknown, icon: <HelpCircle size={12} /> },
};

export default function InstagramPage() {
  const { push } = useToast();
  const notifyErr = useCallback((label: string, e: unknown) => push({ kind: "error", text: `${label}: ${String(e)}` }), [push]);
  const [tab, setTab] = useState<Tab>("inbox");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [classCounts, setClassCounts] = useState<Record<string, number>>({});
  const [needsHuman, setNeedsHuman] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ tab: tab === "settings" ? "inbox" : tab });
      if (q) params.set("q", q);
      const r = await fetch(`/api/instagram/threads?${params}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "load failed");
      setThreads(d.threads ?? []);
      setClassCounts(d.classCounts ?? {});
      setNeedsHuman(d.needsHuman ?? 0);
      setSettings(d.settings ?? null);
    } catch (e) {
      notifyErr("Couldn't load Instagram threads", e);
    } finally {
      setLoading(false);
    }
  }, [tab, q, notifyErr]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  const openThread = useCallback(async (id: string) => {
    setActiveId(id);
    try {
      const r = await fetch(`/api/instagram/threads/${id}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "load failed");
      setActiveThread(d.thread);
      setMessages(d.messages ?? []);
      setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, unread_count: 0 } : t)));
      setTimeout(() => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight), 50);
    } catch (e) {
      notifyErr("Couldn't open thread", e);
    }
  }, [notifyErr]);

  const sendReply = useCallback(async () => {
    if (!activeId || !reply.trim()) return;
    setSending(true);
    try {
      const r = await fetch(`/api/instagram/threads/${activeId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply.trim() }),
      });
      const d = await r.json();
      if (!r.ok || d.ok === false) throw new Error(d.error || "send failed");
      setReply("");
      await openThread(activeId);
    } catch (e) {
      notifyErr("Send failed", e);
    } finally {
      setSending(false);
    }
  }, [activeId, reply, openThread, notifyErr]);

  const patchThread = useCallback(async (id: string, patch: Record<string, unknown>) => {
    try {
      const r = await fetch(`/api/instagram/threads/${id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "update failed");
      setActiveThread((t) => (t && t.id === id ? { ...t, ...d.thread } : t));
      loadThreads();
    } catch (e) {
      notifyErr("Update failed", e);
    }
  }, [loadThreads, notifyErr]);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    try {
      const r = await fetch(`/api/instagram/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "save failed");
      setSettings(d.settings);
      push({ kind: "success", text: "Settings saved" });
    } catch (e) {
      notifyErr("Couldn't save settings", e);
    }
  }, [push, notifyErr]);

  const tabs: { key: Tab; label: string; count?: number }[] = useMemo(() => [
    { key: "inbox", label: "Inbox" },
    { key: "collab", label: "Collabs", count: classCounts.collab },
    { key: "needs_human", label: "Needs human", count: needsHuman },
    { key: "spam", label: "Spam", count: classCounts.spam },
    { key: "settings", label: "Settings" },
  ], [classCounts, needsHuman]);

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div className={styles.title}>
          <Instagram size={22} /> <span>Instagram</span>
          {settings?.paused && <span className={styles.pausedPill}>Bot paused</span>}
        </div>
        <div className={styles.toolbar}>
          <div className={styles.searchBox}>
            <Search size={15} />
            <input
              className={styles.search}
              placeholder="Search handle or message…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadThreads()}
            />
          </div>
          <button className="pm-btn" onClick={loadThreads} disabled={loading}>
            <RefreshCw size={15} className={loading ? styles.spin : ""} /> Refresh
          </button>
        </div>
      </header>

      <nav className={styles.tabs}>
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`${styles.tab} ${tab === t.key ? styles.tabOn : ""}`}
            onClick={() => { setTab(t.key); setActiveId(null); }}
          >
            {t.key === "settings" && <SettingsIcon size={14} />}
            {t.label}
            {typeof t.count === "number" && t.count > 0 && <span className={styles.tabCount}>{t.count}</span>}
          </button>
        ))}
      </nav>

      {tab === "settings" ? (
        <SettingsPanel key={settings ? "ready" : "loading"} settings={settings} onSave={saveSettings} />
      ) : (
        <div className={styles.body}>
          <div className={`${styles.list} ${activeId ? styles.listHiddenMobile : ""}`}>
            {threads.length === 0 && !loading && (
              <div className={styles.empty}>
                No threads yet. Inbound DMs and comments will land here once the Instagram webhook is live.
              </div>
            )}
            {threads.map((t) => {
              const cm = CLASS_META[t.classification] ?? CLASS_META.unknown;
              return (
                <button
                  key={t.id}
                  className={`${styles.threadRow} ${activeId === t.id ? styles.threadOn : ""}`}
                  onClick={() => openThread(t.id)}
                >
                  <div className={styles.threadTop}>
                    <span className={styles.handle}>{t.handle ? `@${t.handle}` : "Instagram user"}</span>
                    <span className={`${styles.tag} ${cm.cls}`}>{cm.icon}{cm.label}</span>
                  </div>
                  <div className={styles.snippet}>{t.last_message_snippet || "—"}</div>
                  <div className={styles.threadMeta}>
                    {t.classification === "collab" && t.collab_stage && (
                      <span className={styles.stagePill}>{STAGE_LABEL[t.collab_stage]}</span>
                    )}
                    {t.followers != null && (
                      <span className={t.band_fit ? styles.fitYes : styles.fitNo}>
                        {fmtNum(t.followers)} followers{t.band_fit ? " · fits" : ""}
                      </span>
                    )}
                    {t.ticket_status === "open" && <span className={styles.openTicket}>needs human</span>}
                    {t.unread_count > 0 && <span className={styles.unread}>{t.unread_count}</span>}
                  </div>
                </button>
              );
            })}
          </div>

          <div className={`${styles.convo} ${activeId ? "" : styles.convoHiddenMobile}`}>
            {!activeThread ? (
              <div className={styles.convoEmpty}>Select a conversation</div>
            ) : (
              <>
                <div className={styles.convoHead}>
                  <button className={styles.backBtn} onClick={() => setActiveId(null)}><ChevronLeft size={18} /></button>
                  <div className={styles.convoWho}>
                    <a
                      href={activeThread.handle ? `https://instagram.com/${activeThread.handle}` : "#"}
                      target="_blank" rel="noreferrer" className={styles.convoHandle}
                    >
                      {activeThread.handle ? `@${activeThread.handle}` : "Instagram user"}
                      <ExternalLink size={13} />
                    </a>
                    <div className={styles.convoSub}>
                      {activeThread.status === "human" ? "You're handling this" : "Bot is handling this"}
                      {activeThread.followers != null && ` · ${fmtNum(activeThread.followers)} followers`}
                      {activeThread.engagement_rate != null && ` · ${(activeThread.engagement_rate * 100).toFixed(1)}% ER`}
                    </div>
                  </div>
                </div>

                {activeThread.classification === "collab" && (
                  <div className={styles.stageBar}>
                    <span className={styles.stageBarLabel}>Pipeline:</span>
                    {STAGES.map((s) => (
                      <button
                        key={s}
                        className={`${styles.stageStep} ${activeThread.collab_stage === s ? styles.stageStepOn : ""}`}
                        onClick={() => patchThread(activeThread.id, { collab_stage: s })}
                      >
                        {STAGE_LABEL[s]}
                      </button>
                    ))}
                  </div>
                )}

                <div className={styles.messages} ref={scrollRef}>
                  {messages.map((m) => (
                    <div key={m.id} className={`${styles.msg} ${m.direction === "inbound" ? styles.msgIn : styles.msgOut}`}>
                      <div className={styles.msgText}>{m.text}</div>
                      <div className={styles.msgMeta}>
                        {m.direction === "outbound" && (m.ai_generated ? <Bot size={11} /> : <UserIcon size={11} />)}
                        {m.kind === "comment" && "comment · "}
                        {m.kind === "private_reply" && "private reply · "}
                        {new Date(m.created_at).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
                        {m.status === "failed" && <span className={styles.failed}> · failed</span>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className={styles.composer}>
                  <textarea
                    className={styles.composerInput}
                    placeholder="Reply (sends as you, inside the 24h window)…"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendReply(); }}
                  />
                  <div className={styles.composerActions}>
                    {activeThread.status === "human" && (
                      <button className="pm-btn" onClick={() => patchThread(activeThread.id, { status: "bot" })}>
                        Hand back to bot
                      </button>
                    )}
                    {activeThread.ticket_status === "open" && (
                      <button className="pm-btn" onClick={() => patchThread(activeThread.id, { resolve_ticket: true })}>
                        Resolve
                      </button>
                    )}
                    <button className="pm-btn pm-btn-primary" onClick={sendReply} disabled={sending || !reply.trim()}>
                      <Send size={15} /> {sending ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function SettingsPanel({ settings, onSave }: { settings: Settings | null; onSave: (p: Partial<Settings>) => void }) {
  // State is initialised from props at mount; the parent remounts this panel
  // (via key) when settings load, so no prop→state sync effect is needed.
  const [terms, setTerms] = useState(settings?.barter_terms ?? "");
  const [min, setMin] = useState(settings?.min_followers ?? 20000);
  const [max, setMax] = useState(settings?.max_followers ?? 100000);
  if (!settings) return <div className={styles.empty}>Loading settings…</div>;

  return (
    <div className={styles.settings}>
      <Toggle label="Bot paused" desc="Stop all auto-replies. Inbound is still captured." value={settings.paused} onChange={(v) => onSave({ paused: v })} />
      <Toggle label="Auto-reply enabled" desc="AI answers inbound DMs. Off = triage + escalate only." value={settings.auto_reply_enabled} onChange={(v) => onSave({ auto_reply_enabled: v })} />
      <Toggle label="Auto-reply to comments" desc="Send a Private Reply DM to comments on our posts/reels." value={settings.auto_reply_comments} onChange={(v) => onSave({ auto_reply_comments: v })} />
      <Toggle label="Escalate collabs to Slack" desc="Ping the team when a real barter inquiry lands." value={settings.escalate_to_slack} onChange={(v) => onSave({ escalate_to_slack: v })} />

      <div className={styles.setRow}>
        <div className={styles.setLabel}>
          <strong>Collab reply mode</strong>
          <span>How the bot handles a barter inquiry.</span>
        </div>
        <select
          className="pm-input"
          value={settings.auto_reply_scope}
          onChange={(e) => onSave({ auto_reply_scope: e.target.value as Settings["auto_reply_scope"] })}
        >
          <option value="routine_only">Acknowledge + escalate (safe)</option>
          <option value="all">Reply with terms + escalate</option>
        </select>
      </div>

      <div className={styles.setRow}>
        <div className={styles.setLabel}>
          <strong>Target follower band</strong>
          <span>Used to flag whether a collab inquiry fits (Business Discovery).</span>
        </div>
        <div className={styles.bandInputs}>
          <input className="pm-input" type="number" value={min} onChange={(e) => setMin(+e.target.value)} onBlur={() => onSave({ min_followers: min })} />
          <span>to</span>
          <input className="pm-input" type="number" value={max} onChange={(e) => setMax(+e.target.value)} onBlur={() => onSave({ max_followers: max })} />
        </div>
      </div>

      <div className={styles.setCol}>
        <div className={styles.setLabel}>
          <strong>Barter terms</strong>
          <span>What we offer + what we expect. The bot uses this for collab replies (in &quot;reply with terms&quot; mode).</span>
        </div>
        <textarea
          className="pm-input"
          rows={5}
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          placeholder="e.g. We send a PROMUNCH hamper (worth ₹X) in exchange for 1 reel + 2 stories tagging @promunch within 2 weeks…"
        />
        <button className="pm-btn pm-btn-primary" onClick={() => onSave({ barter_terms: terms })} style={{ alignSelf: "flex-start" }}>
          Save terms
        </button>
      </div>
    </div>
  );
}

function Toggle({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={styles.setRow}>
      <div className={styles.setLabel}><strong>{label}</strong><span>{desc}</span></div>
      <button className={`${styles.switch} ${value ? styles.switchOn : ""}`} onClick={() => onChange(!value)} aria-pressed={value}>
        <span className={styles.knob} />
      </button>
    </div>
  );
}
