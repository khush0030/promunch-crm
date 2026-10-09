"use client";

// One mention: full text, what the AI made of it, status actions, the
// complaint case, the reply box and a team note. "Copy and open" copies the
// reply, opens the post, and marks the mention replied. Website (Judge.me)
// reviews can also be answered publicly from here, after a confirm, through
// POST /api/orm/mentions/[id]/reply (one reply per review, ever).

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Sparkles } from "lucide-react";
import { ORM_CASE_OUTCOMES, type OrmAlert, type OrmCaseStatus, type OrmMention, type OrmStatus } from "@/lib/orm/types";
import { api, errText, QK } from "./api";
import {
  authorOf,
  CASE_LABEL,
  CASE_TONE,
  CloseBtn,
  compact,
  dateTime,
  Drawer,
  INTENT_LABEL,
  Mark,
  OPEN_ON,
  OUTCOME_LABEL,
  relTime,
  type ReplyClaim,
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
        <MentionBody
          m={q.data.mention}
          alerts={q.data.alerts}
          claim={q.data.reply_claim ?? null}
          waThreadId={q.data.wa_thread_id ?? null}
          onClose={onClose}
        />
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

function MentionBody({
  m,
  alerts,
  claim,
  waThreadId,
  onClose,
}: {
  m: OrmMention;
  alerts: OrmAlert[];
  claim: ReplyClaim | null;
  waThreadId: string | null;
  onClose: () => void;
}) {
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

  const [confirmPost, setConfirmPost] = useState(false);
  const post = useMutation({
    mutationFn: (retry: boolean) =>
      api<{ ok: boolean }>(`/api/orm/mentions/${m.id}/reply`, { method: "POST", body: { reply: reply.trim(), retry } }),
    onSuccess: () => {
      setConfirmPost(false);
      refresh();
    },
    onError: () => {
      setConfirmPost(false);
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
  const postedViaApi = m.reply_channel === "judgeme_api" || claim?.status === "posted";
  const claimFailed = claim?.status === "failed";
  const claimBusy = claim?.status === "claimed";
  const canPostJudgeme = m.source === "judgeme" && /^\d+$/.test(m.external_id) && !postedViaApi && m.status !== "replied";
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
          {m.language && m.language !== "en" && m.language.toLowerCase() !== "english" && (
            <>
              <dt>Language</dt>
              <dd>{m.language}</dd>
            </>
          )}
        </dl>
      </section>

      <CaseSection m={m} waThreadId={waThreadId} onSaved={refresh} />

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
        {canPostJudgeme ? (
          <>
            <div className={s.replyFoot}>
              <span className={s.hint}>{reply.length} characters. Posts on our website under the review.</span>
              <button
                type="button"
                className="pm-btn sm"
                disabled={!reply.trim() || patch.isPending || post.isPending}
                onClick={copyAndOpen}
              >
                Copy and open
              </button>
              {!confirmPost && (
                <button
                  type="button"
                  className="pm-btn primary sm"
                  disabled={!reply.trim() || post.isPending || claimBusy}
                  onClick={() => setConfirmPost(true)}
                >
                  {claimFailed ? "Try again" : "Post reply on the website"}
                </button>
              )}
            </div>
            {confirmPost && (
              <div className={s.confirm} role="alertdialog" aria-label="Post this reply publicly?">
                <p>
                  <b>This posts publicly under PROMUNCH</b> on the product page, below this review. Anyone can read it and it
                  cannot be taken back from here.
                </p>
                <div className={s.confirmActs}>
                  <button type="button" className="pm-btn sm" disabled={post.isPending} onClick={() => setConfirmPost(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="pm-btn primary sm"
                    disabled={post.isPending}
                    onClick={() => post.mutate(claimFailed)}
                  >
                    {post.isPending ? "Posting…" : "Yes, post it"}
                  </button>
                </div>
              </div>
            )}
            {claimFailed && !post.isPending && !post.error && (
              <p className={s.err}>The last try did not post{claim?.error ? `: ${claim.error}` : "."}</p>
            )}
            {claimBusy && <p className={s.hint}>A reply is being posted right now. Refresh in a minute.</p>}
            {post.error && <p className={s.err}>{errText(post.error)}</p>}
          </>
        ) : (
          <div className={s.replyFoot}>
            <span className={s.hint}>
              {reply.length} characters. {postedViaApi ? "" : "Check it before posting. We never post for you."}
            </span>
            {!postedViaApi && (
              <button type="button" className="pm-btn primary sm" disabled={!reply.trim() || patch.isPending} onClick={copyAndOpen}>
                {m.url ? "Copy and open" : "Copy and mark replied"}
              </button>
            )}
          </div>
        )}
        {draft.error && <p className={s.err}>{errText(draft.error)}</p>}
        {copied && <p className={s.ok}>{copied}</p>}
        {m.replied_at && (
          <p className={postedViaApi ? s.ok : s.hint} style={{ marginTop: 8 }}>
            {postedViaApi ? "Posted on the website" : "Marked replied"} {dateTime(m.replied_at)}
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

// ── complaint case ──────────────────────────────────────────────────────────

const CASE_STEPS: { key: OrmCaseStatus | "none"; label: string }[] = [
  { key: "none", label: "No case" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "resolved", label: "Resolved" },
];

function CaseSection({ m, waThreadId, onSaved }: { m: OrmMention; waThreadId: string | null; onSaved: () => void }) {
  const [resolving, setResolving] = useState(false);
  const [outcome, setOutcome] = useState<string>(m.case_outcome ?? "");
  const [owner, setOwner] = useState(m.assignee ?? "");
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ mention: OrmMention }>(`/api/orm/mentions/${m.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      setResolving(false);
      onSaved();
    },
  });
  const cur = m.case_status ?? "none";

  const pick = (k: OrmCaseStatus | "none") => {
    if (k === cur) return;
    if (k === "resolved") {
      setResolving(true);
      return;
    }
    setResolving(false);
    save.mutate({ case_status: k === "none" ? null : k });
  };

  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <h3 className={s.sectionTitle}>Case</h3>
        {m.case_status && <Mark tone={CASE_TONE[m.case_status]}>{CASE_LABEL[m.case_status]}</Mark>}
      </div>
      <p className={s.hint} style={{ margin: "0 0 10px" }}>
        Track an unhappy customer until it is sorted. Closing a case asks how it ended.
      </p>
      <div className={s.seg} role="group" aria-label="Case status">
        {CASE_STEPS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`${s.segBtn}${(resolving ? "resolved" : cur) === c.key ? ` ${s.segOn}` : ""}`}
            aria-pressed={cur === c.key}
            disabled={save.isPending}
            onClick={() => pick(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {resolving && (
        <div className={s.caseResolve}>
          <label className={s.field}>
            <span className={s.label}>How did it end?</span>
            <select className={s.select} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">Pick one</option>
              {ORM_CASE_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABEL[o]}
                </option>
              ))}
            </select>
          </label>
          <div className={s.confirmActs}>
            <button type="button" className="pm-btn sm" onClick={() => setResolving(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="pm-btn primary sm"
              disabled={!outcome || save.isPending}
              onClick={() => save.mutate({ case_status: "resolved", case_outcome: outcome })}
            >
              {save.isPending ? "Saving…" : "Resolve case"}
            </button>
          </div>
        </div>
      )}
      {save.error && <p className={s.err}>{errText(save.error)}</p>}

      <dl className={s.kv}>
        {m.case_opened_at && (
          <>
            <dt>Opened</dt>
            <dd>{dateTime(m.case_opened_at)}</dd>
          </>
        )}
        {m.case_status === "resolved" && (
          <>
            <dt>Outcome</dt>
            <dd>
              {m.case_outcome ? OUTCOME_LABEL[m.case_outcome] ?? m.case_outcome : <span className={s.hint}>Not set</span>}
              {m.case_resolved_at && <span className={s.hint}> · {dateTime(m.case_resolved_at)}</span>}
            </dd>
          </>
        )}
        <dt>Owner</dt>
        <dd>
          <span className={s.ownerRow}>
            <input
              className={s.input}
              value={owner}
              maxLength={120}
              placeholder="Who is on it"
              onChange={(e) => setOwner(e.target.value)}
            />
            <button
              type="button"
              className="pm-btn sm"
              disabled={save.isPending || owner.trim() === (m.assignee ?? "").trim()}
              onClick={() => save.mutate({ assignee: owner })}
            >
              Save
            </button>
          </span>
        </dd>
        <dt>Customer</dt>
        <dd>
          {m.contact_id ? (
            <span className={s.linkRow}>
              <Link className={s.inlineLink} href={`/dashboard/contacts/${m.contact_id}`}>
                Open customer{m.order_ref ? ` (order ${m.order_ref})` : ""}
              </Link>
              {waThreadId && (
                <Link className={s.inlineLink} href={`/dashboard/inbox?open=wa-${waThreadId}`}>
                  Message on WhatsApp
                </Link>
              )}
            </span>
          ) : m.order_ref ? (
            <span>
              Order {m.order_ref} <span className={s.hint}>· no customer match</span>
            </span>
          ) : (
            <span className={s.hint}>No match found</span>
          )}
        </dd>
      </dl>
    </section>
  );
}
