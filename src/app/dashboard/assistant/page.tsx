"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  CornerDownRight,
  Database,
  Loader,
  Plus,
  SendHorizonal,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/pm";
import { Markdown } from "@/components/assistant/Markdown";
import { ToolResult } from "@/components/assistant/ToolResult";
import styles from "./assistant.module.css";

type Convo = { id: string; title: string | null; updated_at: string };
type StoredMessage = { id: string; role: "user" | "assistant"; content: string };

// Suggested questions, grouped the way people think about the business.
const SUGGESTION_GROUPS = [
  { kicker: "Sales", qs: ["Revenue in the last 7 days vs the 7 before, by channel", "Which channel brought the most orders this month?"] },
  { kicker: "Marketing", qs: ["How did WhatsApp sends perform this week?", "How are email campaigns doing this month?"] },
  { kicker: "B2B & Amazon", qs: ["How is the B2B pipeline looking?", "How is Amazon doing this week?"] },
  { kicker: "Health & policy", qs: ["Is everything working right now?", "What is our shipping and COD policy?"] },
];

// Where an answer's numbers came from, by the tool Maya used.
const SOURCE_LABELS: Record<string, string> = {
  query_orders: "Shopify orders",
  get_whatsapp_stats: "WhatsApp",
  get_system_health: "System health",
  get_leads_pipeline: "B2B pipeline",
  get_email_stats: "Email",
  get_amazon_stats: "Amazon",
  search_customer: "Customers",
  search_kb: "Knowledge base",
  get_audit_log: "Audit log",
};

function sourcesOf(parts: { type: string }[]): string[] {
  const out = new Set<string>();
  for (const p of parts) {
    if (!p.type.startsWith("tool-")) continue;
    const name = p.type.slice(5);
    out.add(SOURCE_LABELS[name] ?? name.replace(/_/g, " "));
  }
  return [...out];
}

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function MayaAvatar() {
  return (
    <span className={styles.avatar} aria-hidden>
      <Sparkles size={14} />
    </span>
  );
}

// useSearchParams needs a Suspense boundary in the App Router.
export default function AssistantPage() {
  return (
    <Suspense fallback={null}>
      <AssistantInner />
    </Suspense>
  );
}

function AssistantInner() {
  const qc = useQueryClient();
  // ?q= prefills the box (suggested questions on Home); nothing is sent until they press send.
  const params = useSearchParams();
  const [input, setInput] = useState(() => params.get("q") ?? "");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, status, setMessages, error, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/assistant/chat" }),
    onFinish: () => qc.invalidateQueries({ queryKey: ["assistant-convos"] }),
  });
  const busy = status === "submitted" || status === "streaming";

  const { data: convos } = useQuery<Convo[]>({
    queryKey: ["assistant-convos"],
    queryFn: async () => {
      const res = await fetch("/api/assistant/conversations", { cache: "no-store" });
      if (!res.ok) throw new Error("failed to load conversations");
      return (await res.json()).conversations ?? [];
    },
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // If a send fails (the error banner shows), put the draft back in the box.
  const lastSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (error && lastSentRef.current) {
      const draft = lastSentRef.current;
      lastSentRef.current = null;
      setInput((cur) => (cur ? cur : draft));
    }
  }, [error]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    let id = activeId;
    if (!id) {
      try {
        const res = await fetch("/api/assistant/conversations", { method: "POST" });
        if (res.ok) {
          id = (await res.json()).id as string;
          setActiveId(id);
          qc.invalidateQueries({ queryKey: ["assistant-convos"] });
        }
      } catch {
        // proceed without a conversation id; the send below reports failures
      }
    }
    // Clear only once the request is underway; if it fails, the effect below
    // restores the draft so nothing typed is lost.
    lastSentRef.current = trimmed;
    setInput("");
    try {
      await sendMessage({ text: trimmed }, { body: { conversationId: id } });
    } catch {
      setInput((cur) => (cur ? cur : trimmed));
    }
  }

  async function openConvo(id: string) {
    if (busy || id === activeId) return;
    setActiveId(id);
    const res = await fetch(`/api/assistant/conversations/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const stored: StoredMessage[] = (await res.json()).messages ?? [];
    setMessages(
      stored
        .filter((m) => m.content)
        .map(
          (m): UIMessage => ({
            id: m.id,
            role: m.role,
            parts: [{ type: "text", text: m.content }],
          })
        )
    );
  }

  function newChat() {
    if (busy) return;
    setActiveId(null);
    setMessages([]);
    inputRef.current?.focus();
  }

  async function deleteConvo(id: string) {
    if (!confirm("Delete this conversation?")) return;
    await fetch(`/api/assistant/conversations/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["assistant-convos"] });
    if (id === activeId) newChat();
  }

  function copyAnswer(id: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1600);
    });
  }

  const lastMessage = messages[messages.length - 1];
  const waitingForMaya =
    busy && (lastMessage?.role === "user" || (lastMessage?.role === "assistant" && !lastMessage.parts.some((p) => p.type === "text")));

  return (
    <div className={styles.page}>
      <PageHeader crumb="Your data, plain answers" title="Ask Maya" />
      <div className="pm2-body">
      <p className={styles.sum}>
        Ask about sales, orders, WhatsApp, email, B2B leads, Amazon or system health. Maya reads the live data before she answers, and shows where the numbers came from.
      </p>
      <div className={styles.wrap}>
        <aside className={styles.rail}>
          <button type="button" className={styles.newChat} onClick={newChat}>
            <Plus size={14} /> New conversation
          </button>
          <div className={styles.railHead}>Your questions</div>
          <div className={styles.railList}>
            {(convos ?? []).map((c) => (
              <div key={c.id} className={`${styles.railItem} ${c.id === activeId ? styles.railItemOn : ""}`}>
                <button type="button" className={styles.railOpen} onClick={() => openConvo(c.id)}>
                  <span className={styles.railTitle}>{c.title || "New conversation"}</span>
                  <span className={styles.railTime}>{ago(c.updated_at)}</span>
                </button>
                <button
                  type="button"
                  className={styles.railDelete}
                  aria-label="Delete conversation"
                  onClick={() => deleteConvo(c.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {convos && convos.length === 0 && <div className={styles.railEmpty}>Questions you ask stay here.</div>}
          </div>
        </aside>

        <section className={styles.chat}>
          {messages.length === 0 ? (
            <div className={styles.hero}>
              <div className={styles.heroGrid}>
                {SUGGESTION_GROUPS.map((g, gi) => (
                  <div key={g.kicker} className={styles.heroCard} style={{ animationDelay: `${gi * 60}ms` }}>
                    <span className={styles.heroKicker}>{g.kicker}</span>
                    {g.qs.map((q) => (
                      <button key={q} type="button" className={styles.qcard} onClick={() => send(q)}>
                        <CornerDownRight size={15} aria-hidden />
                        <span>{q}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.scroll} ref={scrollRef}>
              {messages.map((m, mi) => {
                if (m.role === "user") {
                  const text = m.parts
                    .filter((p) => p.type === "text")
                    .map((p) => (p as { text: string }).text)
                    .join("\n\n");
                  return (
                    <div key={m.id} className={styles.userRow}>
                      <div className={styles.userQ}>{text}</div>
                    </div>
                  );
                }
                const fullText = m.parts
                  .filter((p) => p.type === "text")
                  .map((p) => (p as { text: string }).text)
                  .join("\n\n");
                const isStreamingThis = busy && mi === messages.length - 1;
                const sources = sourcesOf(m.parts);
                return (
                  <div key={m.id} className={styles.mayaBlock}>
                    <div className={styles.mayaName}>
                      <MayaAvatar />
                      <b>Maya</b>
                      {sources.length > 0 && <span className={styles.looked}>· looked at {sources.join(", ")}</span>}
                    </div>
                    <div className={styles.mayaBody}>
                      {m.parts.map((p, i) => {
                        if (p.type === "text") {
                          const t = (p as { text: string }).text;
                          if (!t) return null;
                          return (
                            <div key={i} className={styles.prose}>
                              <Markdown text={t} className={styles.md} />
                            </div>
                          );
                        }
                        if (p.type.startsWith("tool-")) {
                          return (
                            <div key={i} className={styles.toolSlot}>
                              <ToolResult part={p as { type: string; state?: string; output?: unknown }} />
                            </div>
                          );
                        }
                        return null;
                      })}
                      {isStreamingThis && <span className={styles.caret} aria-hidden />}
                    </div>
                    {fullText && !isStreamingThis && (
                      <div className={styles.ansFoot}>
                        <span className={styles.sources}>
                          <Database size={14} aria-hidden />
                          {sources.length ? `Sources: ${sources.join(", ")}` : "Answered from what Maya already knows about PROMUNCH"}
                        </span>
                        <button
                          type="button"
                          className={styles.copyBtn}
                          aria-label="Copy answer"
                          onClick={() => copyAnswer(m.id, fullText)}
                        >
                          {copiedId === m.id ? <Check size={14} /> : <Copy size={14} />}
                          {copiedId === m.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {waitingForMaya && (
                <div className={styles.mayaBlock}>
                  <div className={styles.mayaName}>
                    <span className={`${styles.avatar} ${styles.avatarSpin}`} aria-hidden>
                      <Loader size={14} />
                    </span>
                    <b>Maya is checking</b>
                  </div>
                  <div className={styles.thinking}>
                    Reading the live data
                    <span className={styles.dots}>
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <div className={styles.error}>Something went wrong: {error.message}</div>}

          <form
            className={styles.composer}
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <Sparkles size={17} className={styles.askMark} aria-hidden />
            <textarea
              ref={inputRef}
              className={styles.input}
              rows={1}
              value={input}
              placeholder={messages.length ? "Ask a follow-up…" : "Ask anything…"}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
            />
            {busy ? (
              <button type="button" className={styles.stopBtn} onClick={() => stop()} aria-label="Stop">
                <Square size={13} />
              </button>
            ) : (
              <button type="submit" className={styles.sendBtn} disabled={!input.trim()} aria-label="Send">
                <span>Ask</span>
                <SendHorizonal size={15} aria-hidden />
              </button>
            )}
          </form>
          <div className={styles.hint}>Maya reads live data, so answers can take a few seconds. Enter to send · Shift+Enter for a new line.</div>
        </section>
      </div>
      </div>
    </div>
  );
}
