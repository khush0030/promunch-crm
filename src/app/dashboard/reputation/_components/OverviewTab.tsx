"use client";

// Overview: four questions, top to bottom (docs/plans/2026-10-09-orm-v2-spec.md §2).
//   1. How are we doing?          score, band, change, 12-week line, 4 KPIs
//   2. Where is it going wrong?   product scorecard, worst first
//   3. What do people love/hate?  diverging bars per topic
//   4. Are we on top of it?       response row, channels, competitors
// Every number carries a one-line plain-English explanation under it.

import { useState } from "react";
import { scoreBand, type ScoreBand } from "@/lib/orm/score";
import type {
  ChannelStats,
  CompetitorSnapshot,
  OrmSummary,
  ProductRow,
} from "@/lib/orm/types";
import { errText } from "./api";
import { DivergingBars, LineChart, MixBars } from "./charts";
import { Mark, Stars, topicLabel, useSummary, type Tone } from "./ui";
import s from "../reputation.module.css";

const PERIODS = [7, 30, 90] as const;

export function OverviewTab({ onSettings }: { onSettings: () => void }) {
  const [days, setDays] = useState<number>(30);
  const q = useSummary(days);

  return (
    <div>
      <div className={s.filters} style={{ marginTop: 0 }}>
        <div className={s.seg} role="group" aria-label="Period">
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              className={`${s.segBtn}${days === d ? ` ${s.segOn}` : ""}`}
              aria-pressed={days === d}
              onClick={() => setDays(d)}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>
      {q.isLoading ? (
        <p className={s.hint} style={{ marginTop: 20 }}>
          Loading…
        </p>
      ) : q.error || !q.data ? (
        <p className={s.err} style={{ marginTop: 20 }}>
          {errText(q.error) ?? "Could not load the overview."}
        </p>
      ) : q.data.total === 0 ? (
        <div className={s.empty}>
          <b>No mentions in the last {days} days.</b>
          <span>
            {q.data.sources.some((x) => x.enabled)
              ? "Sources are on. Numbers show up here as mentions come in."
              : "Turn on a source in Settings to start collecting reviews and mentions."}
          </span>
          {!q.data.sources.some((x) => x.enabled) && (
            <button type="button" className="pm-btn sm" onClick={onSettings}>
              Open Settings
            </button>
          )}
        </div>
      ) : (
        <div
          style={{
            opacity: q.isFetching && !q.isLoading ? 0.7 : 1,
            transition: "opacity .15s",
          }}
        >
          <Overview sum={q.data} />
        </div>
      )}
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

const BAND_TONE: Record<ScoreBand, Tone> = {
  Excellent: "good",
  Good: "good",
  "Needs work": "warn",
  "At risk": "crit",
};

const weekLabel = (w: string) =>
  new Date(`${w}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

function hours(h: number | null): string {
  if (h == null) return "None yet";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

/** Lower bound for the score line: 10 below the lowest week, floored to 10. */
function sparkMin(weekly: OrmSummary["score_weekly"]): number {
  const vals = weekly.map((w) => w.score).filter((v): v is number => v != null);
  if (!vals.length) return 0;
  return Math.max(0, Math.floor((Math.min(...vals) - 10) / 10) * 10);
}

const one = (n: number | null | undefined, digits = 1) =>
  n == null ? "" : n.toFixed(digits);

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

// ── layout ──────────────────────────────────────────────────────────────────

function Overview({ sum }: { sum: OrmSummary }) {
  return (
    <>
      <ScoreSection sum={sum} />
      <Question
        n={2}
        title="Where is it going wrong?"
        lead="Each product, worst first: its stars, how often it came up, and how many people were unhappy."
      >
        <ProductTable products={sum.products} />
      </Question>
      <Question
        n={3}
        title="What do people love and hate?"
        lead="Topics people bring up. Complaints on the left, praise on the right."
      >
        {sum.drivers.length ? (
          <DivergingBars
            caption="Complaints and praise per topic"
            leftLabel="Complaints"
            rightLabel="Praise"
            rows={sum.drivers.map((d) => ({
              key: d.topic,
              label: topicLabel(d.topic),
              left: d.complaints,
              right: d.praise,
              tip: `${topicLabel(d.topic)}: ${d.complaints} complaints, ${d.praise} praise, ${d.neutral} neutral`,
            }))}
          />
        ) : (
          <p className={s.muted}>
            No topics yet. They show up once the AI has read the mentions.
          </p>
        )}
      </Question>
      <Question
        n={4}
        title="Are we on top of it?"
        lead="How fast we answer unhappy customers, and how each channel is trending."
      >
        <ResponseRow sum={sum} />
        {sum.channels.length > 0 && (
          <div className={s.channels}>
            {sum.channels.map((c) => (
              <Channel key={c.key} c={c} />
            ))}
          </div>
        )}
        {sum.competitors.length > 0 && <Competitors rows={sum.competitors} />}
      </Question>
    </>
  );
}

function Question({
  n,
  title,
  lead,
  children,
}: {
  n: number;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <section className={s.q}>
      <div className={s.qHead}>
        <span className={s.qNum}>{n}</span>
        <div>
          <h2 className={s.qTitle}>{title}</h2>
          <p className={s.qLead}>{lead}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

// ── 1. score ────────────────────────────────────────────────────────────────

function ScoreSection({ sum }: { sum: OrmSummary }) {
  const sc = sum.score;
  const band = scoreBand(sc.score);
  const prev = sum.score_prev.score;
  const delta = sc.score != null && prev != null ? sc.score - prev : null;
  const weekly = sum.score_weekly;
  const hasWeekly = weekly.some((w) => w.score != null);
  const parts = sc.parts;

  return (
    <section
      className={s.q}
      style={{ borderTop: 0, paddingTop: 0, marginTop: 22 }}
    >
      <div className={s.qHead}>
        <span className={s.qNum}>1</span>
        <div>
          <h2 className={s.qTitle}>How are we doing?</h2>
          <p className={s.qLead}>
            Last {sum.days} days, from {sum.total} mentions.
          </p>
        </div>
      </div>
      <div className={s.hero}>
        <div className={s.heroMain}>
          <span className={s.kpiL}>Reputation score</span>
          <div className={s.heroRow}>
            <span className={s.heroV}>{sc.score ?? "None"}</span>
            {sc.score != null && <span className={s.heroOf}>/ 100</span>}
          </div>
          <div className={s.heroMeta}>
            {band && <Mark tone={BAND_TONE[band]}>{band}</Mark>}
            {delta != null && (
              <span
                className={
                  delta > 0 ? s.t_good : delta < 0 ? s.t_crit : s.t_neu
                }
              >
                <b>{delta === 0 ? "No change" : signed(delta)}</b>
                <span className={s.heroVs}> vs the {sum.days} days before</span>
              </span>
            )}
          </div>
          <p className={s.kpiD}>
            Out of 100. Mixes star ratings, how people feel, how many complaints
            we answered and open serious issues.
          </p>
        </div>
        <div className={s.heroChart}>
          <span className={s.kpiL}>Score, last 12 weeks</span>
          {hasWeekly ? (
            <LineChart
              ariaLabel="Reputation score per week, last 12 weeks"
              points={weekly.map((w) => ({
                key: w.week_start,
                label: weekLabel(w.week_start),
                value: w.score,
                tip:
                  w.score == null
                    ? `Week of ${weekLabel(w.week_start)}: no mentions`
                    : `Week of ${weekLabel(w.week_start)}: ${w.score} from ${w.mentions} mentions`,
              }))}
              min={sparkMin(weekly)}
              max={100}
              height={104}
              format={(v) => String(Math.round(v))}
            />
          ) : (
            <p className={s.muted}>Not enough weeks yet.</p>
          )}
        </div>
      </div>

      <div className={s.kpiRow}>
        <Kpi
          label="Net feeling"
          value={
            sc.net_sentiment_raw == null
              ? "None"
              : signed(Math.round(sc.net_sentiment_raw))
          }
          tone={
            sc.net_sentiment_raw == null
              ? undefined
              : sc.net_sentiment_raw < 0
                ? "crit"
                : undefined
          }
          sub="Share of happy posts minus unhappy ones. Above 0 means more love than complaints."
        />
        <Kpi
          label="Average rating"
          value={sc.avg_rating == null ? "None" : `${one(sc.avg_rating)}★`}
          sub={
            sc.counts.rated
              ? `Across ${sc.counts.rated} star reviews on every channel.`
              : "No star reviews in this period."
          }
        />
        <Kpi
          label="Reply rate"
          value={
            sc.counts.negative
              ? `${Math.round(parts?.reply_rate ?? 0)}%`
              : "All clear"
          }
          tone={
            sc.counts.negative && (parts?.reply_rate ?? 0) < 50
              ? "crit"
              : undefined
          }
          sub={
            sc.counts.negative
              ? `Share of negative mentions we answered or closed (${sc.counts.negatives_handled} of ${sc.counts.negative}).`
              : "Share of negative mentions we answered or closed. None this period."
          }
        />
        <Kpi
          label="Open serious issues"
          value={String(sc.counts.open_critical)}
          tone={sc.counts.open_critical ? "crit" : undefined}
          sub="Food safety or other critical posts nobody has handled yet."
        />
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "crit";
}) {
  return (
    <div className={s.kpi2}>
      <span className={s.kpiL}>{label}</span>
      <span className={`${s.kpiV}${tone === "crit" ? ` ${s.t_crit}` : ""}`}>
        {value}
      </span>
      <span className={s.kpiD}>{sub}</span>
    </div>
  );
}

// ── 2. products ─────────────────────────────────────────────────────────────

function negTone(p: number | null): Tone {
  if (p == null) return "neu";
  if (p >= 30) return "crit";
  if (p >= 15) return "warn";
  return "good";
}

const TREND: Record<
  ProductRow["trend"],
  { arrow: string; word: string; tone: Tone }
> = {
  up: { arrow: "↑", word: "Better", tone: "good" },
  down: { arrow: "↓", word: "Worse", tone: "crit" },
  flat: { arrow: "→", word: "Steady", tone: "neu" },
};

function ProductTable({ products }: { products: ProductRow[] }) {
  if (!products.length)
    return <p className={s.muted}>No products named yet.</p>;
  return (
    <div className={s.ptable} role="table" aria-label="Product scorecard">
      <div className={`${s.prow} ${s.phead}`} role="row">
        <span role="columnheader">Product</span>
        <span role="columnheader">Rating</span>
        <span role="columnheader">Mentions</span>
        <span role="columnheader">Negative</span>
        <span role="columnheader">Top complaint</span>
        <span role="columnheader">Rating trend</span>
      </div>
      {products.map((p) => {
        const t = TREND[p.trend];
        return (
          <div key={p.product} className={s.prow} role="row">
            <span className={s.pName} role="cell">
              {p.product}
            </span>
            <span className={s.pRating} role="cell">
              {p.avg_rating == null ? (
                <span className={s.hint}>No stars</span>
              ) : (
                <>
                  <b>{one(p.avg_rating)}</b>
                  <Stars rating={p.avg_rating} />
                </>
              )}
            </span>
            <span className={s.pMeta}>
              <span className={s.pNum} role="cell">
                {p.mentions}
                <span className={s.pUnit}>
                  {" "}
                  {p.mentions === 1 ? "mention" : "mentions"}
                </span>
              </span>
              <span role="cell" className={s.pNeg}>
                {p.pct_negative == null ? (
                  <span className={s.hint}>Not scored</span>
                ) : (
                  <Mark tone={negTone(p.pct_negative)}>
                    {p.pct_negative}% negative
                  </Mark>
                )}
              </span>
              <span role="cell" className={s.pTopic}>
                {p.top_complaint_topic ? (
                  topicLabel(p.top_complaint_topic)
                ) : (
                  <span className={s.hint}>None</span>
                )}
              </span>
              <span
                role="cell"
                className={`${s.pTrend} ${s[`t_${t.tone}`]}`}
                title="Average rating vs the period before"
              >
                <span aria-hidden="true">{t.arrow}</span> {t.word}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── 4. response, channels, competitors ──────────────────────────────────────

function ResponseRow({ sum }: { sum: OrmSummary }) {
  const r = sum.response;
  const c = r.cases;
  return (
    <>
      <div className={s.kpiRow}>
        <Kpi
          label="Unanswered complaints"
          value={String(r.open_negatives)}
          tone={r.open_negatives ? "crit" : undefined}
          sub="Negative mentions nobody has replied to or closed yet."
        />
        <Kpi
          label="Typical reply time"
          value={hours(r.median_reply_hours)}
          sub="Half of our replies went out faster than this, counted from when the post went up."
        />
        <Kpi
          label="Oldest unanswered"
          value={
            r.oldest_unanswered_days == null
              ? "None"
              : r.oldest_unanswered_days === 0
                ? "Today"
                : `${r.oldest_unanswered_days} ${r.oldest_unanswered_days === 1 ? "day" : "days"}`
          }
          tone={(r.oldest_unanswered_days ?? 0) >= 3 ? "crit" : undefined}
          sub="How long the longest-waiting complaint has gone without an answer."
        />
        <Kpi
          label="Won back"
          value={c.recovery_rate == null ? "None yet" : `${c.recovery_rate}%`}
          sub={
            c.resolved
              ? `Closed cases where the customer ended happy (${c.recovered} of ${c.resolved}).`
              : "Closed cases where the customer ended happy. No cases closed yet."
          }
        />
      </div>
      <p className={s.casesLine}>
        <b>Cases:</b> <Mark tone={c.open ? "crit" : "neu"}>{c.open} open</Mark>
        <Mark tone={c.in_progress ? "warn" : "neu"}>
          {c.in_progress} in progress
        </Mark>
        <Mark tone="good">{c.resolved} resolved</Mark>
      </p>
    </>
  );
}

const STAR_KEYS = ["5", "4", "3", "2", "1"] as const;

function Channel({ c }: { c: ChannelStats }) {
  const rated = c.reviews > 0 || c.weekly.some((w) => w.avg_rating != null);
  const total = STAR_KEYS.reduce((a, k) => a + c.star_mix[k], 0);
  return (
    <div className={s.chan}>
      <div className={s.chanHead}>
        <h3 className={s.chanTitle}>{c.label}</h3>
        <span className={s.chanMeta}>
          {c.avg_rating != null && (
            <span className={s.chanBig}>
              {one(c.avg_rating)}
              <span className={s.chanStar}>★</span>
            </span>
          )}
          <span>
            {c.reviews ? `${c.reviews} star reviews this period · ` : ""}
            {c.velocity_per_week} a week lately
          </span>
        </span>
      </div>
      {rated ? (
        <div className={s.chanBody}>
          <div className={s.chanChart}>
            <span className={s.kpiL}>Average stars per week</span>
            <LineChart
              ariaLabel={`${c.label}: average stars per week, last 12 weeks`}
              points={c.weekly.map((w) => ({
                key: w.week_start,
                label: weekLabel(w.week_start),
                value: w.avg_rating,
                tip:
                  w.avg_rating == null
                    ? `Week of ${weekLabel(w.week_start)}: ${w.count ? `${w.count} mentions, no stars` : "nothing"}`
                    : `Week of ${weekLabel(w.week_start)}: ${one(w.avg_rating)}★ from ${w.count} ${w.count === 1 ? "review" : "reviews"}`,
              }))}
              min={1}
              max={5}
              ticks={[1, 3, 5]}
              height={132}
              format={(v) => `${one(v)}★`}
            />
          </div>
          <div className={s.chanMix}>
            <span className={s.kpiL}>Star mix this period</span>
            {total ? (
              <MixBars
                caption={`${c.label}: reviews per star rating`}
                rows={STAR_KEYS.map((k) => ({
                  key: k,
                  label: `${k}★`,
                  value: c.star_mix[k],
                  tip: `${k} stars: ${c.star_mix[k]} ${c.star_mix[k] === 1 ? "review" : "reviews"}`,
                }))}
              />
            ) : (
              <p className={s.muted}>No star reviews in this period.</p>
            )}
          </div>
        </div>
      ) : (
        <p className={s.muted}>
          No star ratings on this channel. Mentions only.
        </p>
      )}
    </div>
  );
}

function Competitors({ rows }: { rows: CompetitorSnapshot[] }) {
  const max = Math.max(1, ...rows.map((r) => r.review_count ?? 0));
  const latest = rows.reduce((a, r) => (r.taken_on > a ? r.taken_on : a), "");
  return (
    <div className={s.comp}>
      <h3 className={s.chanTitle}>Us vs competitors on Amazon</h3>
      <p className={s.qLead}>
        Star rating and number of ratings on each product page. Checked once a
        month, last on{" "}
        {new Date(`${latest}T00:00:00Z`).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        })}
        .
      </p>
      <ul className={s.compList}>
        {rows.map((r) => (
          <li key={r.asin} className={r.is_ours ? s.compOurs : undefined}>
            <span className={s.compName}>
              <b>{r.is_ours ? "PROMUNCH" : r.brand || r.asin}</b>
              <span className={s.hint}>
                {r.label && r.label !== r.brand ? r.label : r.asin}
              </span>
            </span>
            <span className={s.compRating}>
              {r.rating == null ? (
                <span className={s.hint}>No rating</span>
              ) : (
                <>
                  <b>{one(r.rating)}</b>
                  <Stars rating={r.rating} />
                </>
              )}
            </span>
            <span
              className={s.compCount}
              title={`${r.review_count ?? 0} ratings`}
            >
              <span className={s.mixTrack}>
                <span
                  className={r.is_ours ? s.compBarOurs : s.compBar}
                  style={{ width: `${((r.review_count ?? 0) / max) * 100}%` }}
                />
              </span>
              <span className={s.mixV}>
                {(r.review_count ?? 0).toLocaleString("en-IN")}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
