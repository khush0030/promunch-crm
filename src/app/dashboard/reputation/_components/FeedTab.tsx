"use client";

// Feed: every review, comment and mention, newest first. Filters stay on the
// page; clicking a row opens the drawer (?m=<id>).

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { needsReply } from "@/lib/orm/filters";
import type { OrmMention } from "@/lib/orm/types";
import { errText } from "./api";
import {
  authorOf,
  CASE_LABEL,
  CASE_TONE,
  compact,
  Mark,
  relTime,
  SentimentMark,
  SOURCE_SHORT,
  Stars,
  STATUS_LABEL,
  STATUS_TONE,
  topicLabel,
  UrgencyMark,
  useMentions,
  useOrmSettings,
  type FeedFilters,
} from "./ui";
import s from "../reputation.module.css";

const STATUS_CHIPS: { key: string; label: string }[] = [
  { key: "new", label: "New" },
  { key: "needs_reply", label: "Needs reply" },
  { key: "cases", label: "Cases" },
  { key: "all", label: "All" },
  { key: "handled", label: "Handled" },
];

const SOURCE_OPTIONS: { key: string; label: string }[] = [
  { key: "", label: "All sources" },
  { key: "judgeme", label: "Website reviews" },
  { key: "amazon", label: "Amazon" },
  { key: "youtube", label: "YouTube" },
  { key: "reddit", label: "Reddit" },
  { key: "rss", label: "News and web" },
];

const SENTIMENT_OPTIONS = [
  { key: "", label: "Any feeling" },
  { key: "neg", label: "Negative" },
  { key: "neu", label: "Neutral" },
  { key: "pos", label: "Positive" },
];

const EMPTY_TEXT: Record<string, string> = {
  new: "Nothing new. You are all caught up.",
  needs_reply: "Nothing needs a reply right now.",
  handled: "Nothing handled yet. Replied and ignored mentions show here.",
  cases: "No open cases. Unhappy customers we are still helping show here.",
  all: "No mentions match these filters.",
};

export function FeedTab({ onOpen, onSettings }: { onOpen: (id: string) => void; onSettings: () => void }) {
  const [f, setF] = useState<FeedFilters>({ status: "new", source: "", sentiment: "", q: "" });
  const [qInput, setQInput] = useState("");
  // Search waits for a short pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setF((p) => (p.q === qInput ? p : { ...p, q: qInput })), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const list = useMentions(f);
  const settings = useOrmSettings();
  const rows = list.data?.pages.flatMap((p) => p.mentions) ?? [];
  const anySourceOn = settings.data?.sources.some((x) => x.enabled) ?? true;
  const filtered = !!(f.source || f.sentiment || f.q.trim());

  return (
    <div>
      <div className={s.chips} role="tablist" aria-label="Show">
        {STATUS_CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={f.status === c.key}
            className={`${s.chip}${f.status === c.key ? ` ${s.chipOn}` : ""}`}
            onClick={() => setF((p) => ({ ...p, status: c.key }))}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className={s.filters}>
        <select
          className={s.select}
          aria-label="Source"
          value={f.source}
          onChange={(e) => setF((p) => ({ ...p, source: e.target.value }))}
        >
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className={s.select}
          aria-label="Feeling"
          value={f.sentiment}
          onChange={(e) => setF((p) => ({ ...p, sentiment: e.target.value }))}
        >
          {SENTIMENT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <label className={s.search}>
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search text or name"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            aria-label="Search mentions"
          />
        </label>
      </div>

      {list.isLoading ? (
        <p className={s.hint} style={{ marginTop: 20 }}>
          Loading mentions…
        </p>
      ) : list.error ? (
        <p className={s.err} style={{ marginTop: 20 }}>
          {errText(list.error)}
        </p>
      ) : rows.length === 0 ? (
        <div className={s.empty}>
          {!anySourceOn ? (
            <>
              <b>No mentions yet.</b>
              <span>Turn on a source in Settings, for example website reviews or Reddit. New mentions show up here within the hour.</span>
              <button type="button" className="pm-btn sm" onClick={onSettings}>
                Open Settings
              </button>
            </>
          ) : (
            <>
              <b>{filtered ? "No mentions match these filters." : EMPTY_TEXT[f.status]}</b>
              {f.status !== "all" && (
                <span>
                  Try <button type="button" className={s.linkBtn} onClick={() => setF((p) => ({ ...p, status: "all" }))}>All</button> to see everything.
                </span>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <ul className={s.feed}>
            {rows.map((m) => (
              <li key={m.id}>
                <MentionRow m={m} onOpen={onOpen} />
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <div className={s.more}>
              <button
                type="button"
                className="pm-btn sm"
                onClick={() => list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
              >
                {list.isFetchingNextPage ? "Loading…" : "Show older"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MentionRow({ m, onOpen }: { m: OrmMention; onOpen: (id: string) => void }) {
  const text = [m.title, m.body].filter(Boolean).join(" · ");
  const reply = needsReply(m);
  return (
    <button type="button" className={s.row} onClick={() => onOpen(m.id)} title={m.summary ?? undefined}>
      <span className={s.rowTop}>
        <span className={s.src}>{SOURCE_SHORT[m.source] ?? m.source}</span>
        <span className={s.author}>
          {authorOf(m)}
          {m.author_followers != null && m.author_followers > 0 && (
            <span className={s.followers}> · {compact(m.author_followers)} followers</span>
          )}
        </span>
        <Stars rating={m.rating} />
        <span className={s.when}>{relTime(m.posted_at ?? m.collected_at)}</span>
      </span>
      <span className={s.text}>{text || "(no text)"}</span>
      {m.summary && <span className={s.summary}>{m.summary}</span>}
      <span className={s.meta}>
        <UrgencyMark urgency={m.urgency} />
        <SentimentMark value={m.sentiment} />
        {m.topics.slice(0, 3).map((t) => (
          <span key={t} className={s.topic}>
            {topicLabel(t)}
          </span>
        ))}
        {m.case_status && m.case_status !== "resolved" && (
          <Mark tone={CASE_TONE[m.case_status]}>Case {CASE_LABEL[m.case_status].toLowerCase()}</Mark>
        )}
        {m.status !== "new" ? (
          <Mark tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Mark>
        ) : reply ? (
          <Mark tone="info">Needs reply</Mark>
        ) : null}
      </span>
    </button>
  );
}
