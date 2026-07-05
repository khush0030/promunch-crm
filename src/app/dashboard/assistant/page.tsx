"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  Copy,
  HeartPulse,
  MessageCircle,
  Plus,
  SendHorizonal,
  Sparkles,
  Square,
  TrendingUp,
  Trash2,
} from "lucide-react";
import { PageHead } from "@/components/pm";
import { Markdown } from "@/components/assistant/Markdown";
import { ToolResult } from "@/components/assistant/ToolResult";
import styles from "./assistant.module.css";

type Convo = { id: string; title: string | null; updated_at: string };
type StoredMessage = { id: string; role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  { icon: HeartPulse, kicker: "System health", q: "Is everything working right now?" },
  { icon: TrendingUp, kicker: "Revenue", q: "Revenue in the last 7 days vs the 7 before, by channel" },
  { icon: MessageCircle, kicker: "WhatsApp", q: "How did WhatsApp sends perform this week?" },
  { icon: BookOpen, kicker: "Brand & policy", q: "What is our shipping and COD policy?" },
];

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
      <Sparkles size={13} />
    </span>
  );
}

export default function AssistantPage() {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
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
    <div className="pm-page">
      <PageHead
        title="Ask Maya"
        subtitle="Your PROMUNCH data analyst. Every answer is read live from Shopify, WhatsApp, email, leads and Amazon."
      />
      <div className={styles.wrap}>
        <aside className={styles.rail}>
          <button type="button" className={styles.newChat} onClick={newChat}>
            <Plus size={14} /> New conversation
          </button>
          <div className={styles.railHead}>Recent</div>
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
            {convos && convos.length === 0 && <div className={styles.railEmpty}>Nothing yet</div>}
          </div>
        </aside>

        <section className={styles.chat}>
          {messages.length === 0 ? (
            <div className={styles.hero}>
              <div className={styles.heroMark}>
                <Sparkles size={22} />
              </div>
              <h2 className={styles.heroTitle}>Ask Maya.</h2>
              <p className={styles.heroSub}>
                She reads the live PROMUNCH data before she answers: orders, WhatsApp, email, B2B
                leads, Amazon, cron jobs and the Master KB.
              </p>
              <div className={styles.heroGrid}>
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s.q}
                    type="button"
                    className={styles.heroCard}
                    style={{ animationDelay: `${i * 70}ms` }}
                    onClick={() => send(s.q)}
                  >
                    <span className={styles.heroIcon}>
                      <s.icon size={15} />
                    </span>
                    <span>
                      <span className={styles.heroKicker}>{s.kicker}</span>
                      <span className={styles.heroQ}>{s.q}</span>
                    </span>
                  </button>
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
                      <div className={styles.userPill}>{text}</div>
                    </div>
                  );
                }
                const fullText = m.parts
                  .filter((p) => p.type === "text")
                  .map((p) => (p as { text: string }).text)
                  .join("\n\n");
                const isStreamingThis = busy && mi === messages.length - 1;
                return (
                  <div key={m.id} className={styles.mayaBlock}>
                    <div className={styles.mayaName}>
                      <MayaAvatar />
                      Maya
                      {fullText && !isStreamingThis && (
                        <button
                          type="button"
                          className={styles.copyBtn}
                          aria-label="Copy answer"
                          onClick={() => copyAnswer(m.id, fullText)}
                        >
                          {copiedId === m.id ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      )}
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
                  </div>
                );
              })}
              {waitingForMaya && (
                <div className={styles.mayaBlock}>
                  <div className={styles.mayaName}>
                    <MayaAvatar />
                    Maya
                  </div>
                  <div className={styles.thinking}>
                    reading the data
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
            <textarea
              ref={inputRef}
              className={styles.input}
              rows={1}
              value={input}
              placeholder="Ask about revenue, campaigns, customers or system health…"
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
                <SendHorizonal size={15} />
              </button>
            )}
          </form>
          <div className={styles.hint}>Maya reads live data, so answers can take a few seconds. Enter to send · Shift+Enter for a new line.</div>
        </section>
      </div>
    </div>
  );
}
