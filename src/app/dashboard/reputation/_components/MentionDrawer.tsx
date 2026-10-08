"use client";

// One mention: full text, what the AI made of it, status actions, the reply
// box and a team note. Nothing here posts publicly: "Copy and open" copies the
// reply, opens the post, and marks the mention replied.

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Sparkles } from "lucide-react";
import type { OrmAlert, OrmMention, OrmStatus } from "@/lib/orm/types";
import { api, errText, QK } from "./api";
import {
  authorOf,
  CloseBtn,
  compact,
  dateTime,
  Drawer,
  INTENT_LABEL,
  Mark,
  OPEN_ON,
  relTime,
  SentimentMark,
  SOURCE_SHORT,
  Stars,
  STATUS_LABEL,
  STATUS_TONE,
  topicLabel,
  UrgencyMark,
  useMention,
} from "./ui";
import s from "../reputation.module.css";

export function MentionDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useMention(id);
  return (
    <Drawer onClose={onClose} label="Mention">
      {q.isLoading ? (
        <div className={s.drawerHead}>
          <p className={s.hint}>Loading…</p>
          <CloseBtn onClose={onClose} />
        </div>
      ) : q.error || !q.data ? (
        <div className={s.drawerHead}>
          <p className={s.err}>{errText(q.error) ?? "This mention was not found."}</p>
          <CloseBtn onClose={onClose} />
        </div>
      ) : (
        <MentionBody m={q.data.mention} alerts={q.data.alerts} onClose={onClose} />
      )}
    </Drawer>
  );
}

const ALERT_KIND: Record<string, string> = {
  critical: "food safety or serious problem",
  low_rating: "low star rating",
  negative: "negative post by a big account",
  spike: "sudden rise in mentions",
};

function MentionBody({ m, alerts, onClose }: { m: OrmMention; alerts: OrmAlert[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState(m.reply_text ?? m.reply_draft ?? "");
  const [note, setNote] = useState(m.note ?? "");
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: QK.mention(m.id) });
    qc.invalidateQueries({ queryKey: QK.mentions });
    qc.invalidateQueries({ queryKey: ["orm", "summary"] });
  };

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ mention: OrmMention }>(`/api/orm/mentions/${m.id}`, { method: "PATCH", body }),
    onSuccess: refresh,
  });

  const draft = useMutation({
    mutationFn: () => api<{ draft: string }>(`/api/orm/mentions/${m.id}/draft`, { method: "POST" }),
    onSuccess: (d) => {
      setReply(d.draft);
      qc.invalidateQueries({ queryKey: QK.mention(m.id) });
    },
  });

  const setStatus = (status: OrmStatus) => patch.mutate({ status });

  const copyAndOpen = async () => {
    const text = reply.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(m.url ? "Reply copied. Paste it on the page that just opened." : "Reply copied.");
    } catch {
      setCopied("Could not copy automatically. Select the text and copy it.");
    }
    if (m.url) window.open(m.url, "_blank", "noopener,noreferrer");
    patch.mutate({ status: "replied", reply_text: text });
  };

  const handled = m.status === "replied" || m.status === "ignored";
  const when = m.posted_at ?? m.collected_at;

  return (
    <>
      <div className={s.drawerHead}>
        <div style={{ minWidth: 0 }}>
          <span className={s.eyebrow}>
            {SOURCE_SHORT[m.source]} · {relTime(when)}
          </span>
          <h2 className={s.drawerTitle}>{authorOf(m)}</h2>
          <div className={s.headMeta}>
            {m.author_handle && m.author_name && <span className={s.muted}>{m.author_handle}</span>}
            {m.author_followers != null && m.author_followers > 0 && (
              <span className={s.muted}>{compact(m.author_followers)} followers</span>
            )}
            <Stars rating={m.rating} />
            <Mark tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Mark>
          </div>
        </div>
        <CloseBtn onClose={onClose} />
      </div>

      <div className={s.actsRow}>
        {m.status === "new" && (
          <button type="button" className="pm-btn sm" disabled={patch.isPending} onClick={() => setStatus("seen")}>
            Mark seen
          </button>
        )}
        {!handled && (
          <button type="button" className="pm-btn sm" disabled={patch.isPending} onClick={() => setStatus("ignored")}>
            Ignore
          </button>
        )}
        {m.status !== "escalated" && !handled && (
          <button type="button" className="pm-btn sm" disabled={patch.isPending} onClick={() => setStatus("escalated")}>
            Escalate
          </button>
        )}
        {(handled || m.status === "escalated") && (
          <button type="button" className="pm-btn sm" disabled={patch.isPending} onClick={() => setStatus("new")}>
            Reopen
          </button>
        )}
        {m.url && (
          <a className={s.extLink} href={m.url} target="_blank" rel="noopener noreferrer">
            {OPEN_ON[m.source]} <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
      </div>
      {patch.error && <p className={s.err}>{errText(patch.error)}</p>}

      <section className={s.section}>
        {m.title && <h3 className={s.postTitle}>{m.title}</h3>}
        <p className={s.fullText}>{m.body || "(no text)"}</p>
        <p className={s.hint} style={{ marginTop: 8 }}>
          Posted {dateTime(when)}
          {m.is_owned ? " · on our own page or listing" : ""}
        </p>
      </section>

      <section className={s.section}>
        <h3 className={s.sectionTitle}>What the AI sees</h3>
        {m.enriched_at ? (
          <>
            {m.summary && <p className={s.aiSummary}>{m.summary}</p>}
            <div className={s.headMeta} style={{ marginTop: 8 }}>
              <UrgencyMark urgency={m.urgency} />
              <SentimentMark value={m.sentiment} />
              {m.intent && <span className={s.topic}>{INTENT_LABEL[m.intent] ?? m.intent}</span>}
              {m.topics.map((t) => (
                <span key={t} className={s.topic}>
                  {topicLabel(t)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className={s.muted}>
            {m.enrich_attempts >= 3
              ? "The AI could not read this one. Read the text above."
              : "Not scored yet. The AI reads new mentions within 15 minutes."}
          </p>
        )}
        <dl className={s.kv}>
          <dt>Product</dt>
          <dd>{m.product ?? <span className={s.hint}>Not mentioned</span>}</dd>
          {m.order_ref && (
            <>
              <dt>Order</dt>
              <dd>{m.order_ref}</dd>
            </>
          )}
          <dt>Customer</dt>
          <dd>
            {m.contact_id ? (
              <Link className={s.inlineLink} href={`/dashboard/contacts/${m.contact_id}`}>
                Open customer
              </Link>
            ) : (
              <span className={s.hint}>No match found</span>
            )}
          </dd>
          {m.language && m.language !== "en" && m.language.toLowerCase() !== "english" && (
            <>
              <dt>Language</dt>
              <dd>{m.language}</dd>
            </>
          )}
        </dl>
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <h3 className={s.sectionTitle}>Reply</h3>
          <button
            type="button"
            className="pm-btn sm"
            disabled={draft.isPending}
            onClick={() => draft.mutate()}
          >
            <Sparkles size={14} aria-hidden="true" />
            {draft.isPending ? "Writing…" : reply ? "Draft again with AI" : "Draft with AI"}
          </button>
        </div>
        <textarea
          className={s.textarea}
          rows={5}
          value={reply}
          maxLength={4000}
          placeholder="Write a reply, or let the AI draft one from the Master KB."
          onChange={(e) => setReply(e.target.value)}
          onBlur={() => {
            if (m.status !== "replied" && reply.trim() !== (m.reply_draft ?? "").trim()) patch.mutate({ reply_draft: reply });
          }}
        />
        <div className={s.replyFoot}>
          <span className={s.hint}>
            {reply.length} characters. Check it before posting. We never post for you.
          </span>
          <button type="button" className="pm-btn primary sm" disabled={!reply.trim() || patch.isPending} onClick={copyAndOpen}>
            {m.url ? "Copy and open" : "Copy and mark replied"}
          </button>
        </div>
        {draft.error && <p className={s.err}>{errText(draft.error)}</p>}
        {copied && <p className={s.ok}>{copied}</p>}
        {m.replied_at && (
          <p className={s.hint} style={{ marginTop: 8 }}>
            Marked replied {dateTime(m.replied_at)}
            {m.replied_by ? ` by ${m.replied_by}` : ""}.
          </p>
        )}
      </section>

      <section className={s.section}>
        <h3 className={s.sectionTitle}>Team note</h3>
        <textarea
          className={s.textarea}
          rows={3}
          value={note}
          maxLength={2000}
          placeholder="Only the team sees this. For example: called the customer, sending a new pack."
          onChange={(e) => setNote(e.target.value)}
        />
        <div className={s.replyFoot}>
          <span />
          <button
            type="button"
            className="pm-btn sm"
            disabled={patch.isPending || note.trim() === (m.note ?? "").trim()}
            onClick={() => patch.mutate({ note })}
          >
            Save note
          </button>
        </div>
      </section>

      {alerts.length > 0 && (
        <section className={s.section}>
          <h3 className={s.sectionTitle}>WhatsApp alerts</h3>
          <ul className={s.alerts}>
            {alerts.map((a) => (
              <li key={a.id}>
                <Mark tone={a.status === "sent" ? "good" : a.status === "failed" ? "crit" : "neu"}>
                  {a.status === "sent" ? "Sent" : a.status === "failed" ? "Failed" : a.status === "skipped" ? "Not needed" : "Sending"}
                </Mark>
                <span>{ALERT_KIND[a.kind] ?? a.kind}</span>
                <span className={s.hint}>{dateTime(a.sent_at ?? a.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
