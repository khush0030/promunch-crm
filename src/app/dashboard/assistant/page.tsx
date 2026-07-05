"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, SendHorizonal, Sparkles, Trash2 } from "lucide-react";
import { PageHead } from "@/components/pm";
import { Markdown } from "@/components/assistant/Markdown";
import styles from "./assistant.module.css";

type Convo = { id: string; title: string | null; updated_at: string };
type StoredMessage = { id: string; role: "user" | "assistant"; content: string };

const TOOL_LABELS: Record<string, string> = {
  query_orders: "Checked Shopify orders",
  get_whatsapp_stats: "Checked WhatsApp stats",
  get_system_health: "Ran system health checks",
  get_leads_pipeline: "Checked B2B pipeline",
  get_email_stats: "Checked email stats",
  get_amazon_stats: "Checked Amazon",
  search_customer: "Looked up customer",
  search_kb: "Read the knowledge base",
  get_audit_log: "Checked the audit log",
};

const SUGGESTIONS = [
  "Is everything working right now?",
  "Revenue in the last 7 days vs the 7 before, by channel",
  "How did WhatsApp sends perform this week?",
  "Any failed jobs or connector errors today?",
  "What is our shipping and COD policy?",
];

export default function AssistantPage() {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, setMessages, error } = useChat({
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

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    let id = activeId;
    if (!id) {
      const res = await fetch("/api/assistant/conversations", { method: "POST" });
      if (res.ok) {
        id = (await res.json()).id as string;
        setActiveId(id);
        qc.invalidateQueries({ queryKey: ["assistant-convos"] });
      }
    }
    sendMessage({ text: trimmed }, { body: { conversationId: id } });
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
  }

  async function deleteConvo(id: string) {
    if (!confirm("Delete this conversation?")) return;
    await fetch(`/api/assistant/conversations/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["assistant-convos"] });
    if (id === activeId) newChat();
  }

  return (
    <div className="pm-page">
      <PageHead
        title="Ask Maya"
        subtitle="Your PROMUNCH data assistant. Ask about revenue, WhatsApp, leads, Amazon or whether everything is running."
      />
      <div className={styles.wrap}>
        <aside className={styles.rail}>
          <button type="button" className="pm-btn sm" onClick={newChat}>
            <Plus size={14} /> New chat
          </button>
          <div className={styles.railList}>
            {(convos ?? []).map((c) => (
              <div
                key={c.id}
                className={`${styles.railItem} ${c.id === activeId ? styles.railItemOn : ""}`}
                onClick={() => openConvo(c.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && openConvo(c.id)}
              >
                <span className={styles.railTitle}>{c.title || "New conversation"}</span>
                <button
                  type="button"
                  className={styles.railDelete}
                  aria-label="Delete conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConvo(c.id);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className={styles.chat}>
          {messages.length === 0 ? (
            <div className={styles.suggest}>
              <Sparkles size={26} color="var(--pm-gold)" />
              <div className={styles.suggestTitle}>Hi, I&apos;m Maya</div>
              <div className={styles.suggestSub}>
                I can read Shopify orders, WhatsApp, email, B2B leads, Amazon and the system health
                checks. Everything I say comes from live data.
              </div>
              <div className={styles.chips}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className={styles.chip} onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.scroll} ref={scrollRef}>
              {messages.map((m) => {
                const toolParts = m.parts.filter((p) => p.type.startsWith("tool-"));
                const text = m.parts
                  .filter((p) => p.type === "text")
                  .map((p) => (p as { text: string }).text)
                  .join("\n\n");
                return (
                  <div key={m.id} style={{ display: "contents" }}>
                    {toolParts.length > 0 && (
                      <div className={styles.toolChips}>
                        {toolParts.map((p, i) => {
                          const name = p.type.replace(/^tool-/, "");
                          const state = (p as { state?: string }).state;
                          const done = state === "output-available" || state === "output-error";
                          return (
                            <span key={i} className={styles.toolChip}>
                              <span className={`${styles.toolDot} ${done ? styles.toolDotDone : ""}`} />
                              {TOOL_LABELS[name] ?? name}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {text &&
                      (m.role === "user" ? (
                        <div className={styles.msgUser}>{text}</div>
                      ) : (
                        <div className={styles.msgAssistant}>
                          <Markdown text={text} className={styles.md} />
                        </div>
                      ))}
                  </div>
                );
              })}
              {busy && messages[messages.length - 1]?.role === "user" && (
                <div className={styles.thinking}>Maya is looking at the data…</div>
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
            <textarea
              className={styles.input}
              rows={1}
              value={input}
              placeholder="Ask Maya about PROMUNCH data…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
            />
            <button type="submit" className="pm-btn primary" disabled={busy || !input.trim()}>
              <SendHorizonal size={15} />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
