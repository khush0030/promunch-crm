"use client";

// Overview: the headline numbers on one hairline row, how people felt each
// day, what they talk about, and where the mentions come from.

import { useState } from "react";
import type { OrmSummary } from "@/lib/orm/types";
import { errText } from "./api";
import { topicLabel, useSummary } from "./ui";
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
        <Overview sum={q.data} />
      )}
    </div>
  );
}

function Overview({ sum }: { sum: OrmSummary }) {
  const scored = sum.sentiment.neg + sum.sentiment.neu + sum.sentiment.pos;
  const pctNeg = scored ? Math.round((sum.sentiment.neg / scored) * 100) : null;
  const rated = sum.by_source.filter((b) => b.avg_rating != null);

  return (
    <>
      <div className={s.kpis}>
        <Kpi label="Mentions" value={String(sum.total)} sub={`${sum.new_count} new`} />
        {rated.map((b) => (
          <Kpi key={b.key} label={`${shortLabel(b.label)} rating`} value={`${b.avg_rating}★`} sub={`${b.count} reviews`} />
        ))}
        <Kpi
          label="Negative"
          value={pctNeg == null ? "None" : `${pctNeg}%`}
          sub={scored ? `${sum.sentiment.neg} of ${scored} scored` : "Nothing scored yet"}
        />
        <Kpi
          label="Unanswered negatives"
          value={String(sum.unanswered_negative)}
          sub={sum.unanswered_negative ? "Waiting for a reply" : "All handled"}
          tone={sum.unanswered_negative ? "crit" : undefined}
        />
      </div>

      <div className={s.ovGrid}>
        <section className={s.ovBlock}>
          <h3 className={s.sectionTitle}>How people felt, day by day</h3>
          <Trend trend={sum.trend} />
        </section>

        <section className={s.ovBlock}>
          <h3 className={s.sectionTitle}>What they talk about</h3>
          {sum.top_topics.length === 0 ? (
            <p className={s.muted}>No topics yet.</p>
          ) : (
            <Bars items={sum.top_topics.map((t) => ({ label: topicLabel(t.topic), value: t.count }))} />
          )}
        </section>

        <section className={s.ovBlock}>
          <h3 className={s.sectionTitle}>Where mentions come from</h3>
          <Bars
            items={sum.by_source.map((b) => ({
              label: b.label,
              value: b.count,
              extra: b.avg_rating != null ? `${b.avg_rating}★ average` : undefined,
            }))}
          />
        </section>
      </div>
    </>
  );
}

const shortLabel = (l: string) => l.replace(/\s*\(.*\)$/, "").replace(/ reviews$/i, "");

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "crit" }) {
  return (
    <div className={s.kpi}>
      <span className={s.kpiL}>{label}</span>
      <span className={`${s.kpiV}${tone === "crit" ? ` ${s.t_crit}` : ""}`}>{value}</span>
      <span className={s.kpiD}>{sub}</span>
    </div>
  );
}

function Trend({ trend }: { trend: OrmSummary["trend"] }) {
  const max = Math.max(1, ...trend.map((d) => d.neg + d.neu + d.pos));
  const label = (day: string) =>
    new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <>
      <div className={s.trend} role="img" aria-label="Mentions per day by feeling">
        {trend.map((d) => {
          const total = d.neg + d.neu + d.pos;
          return (
            <div key={d.day} className={s.trendCol} title={`${label(d.day)}: ${d.neg} negative, ${d.neu} neutral, ${d.pos} positive`}>
              <div className={s.trendBar} style={{ height: `${(total / max) * 100}%` }}>
                {d.pos > 0 && <span className={s.segPos} style={{ flex: d.pos }} />}
                {d.neu > 0 && <span className={s.segNeu} style={{ flex: d.neu }} />}
                {d.neg > 0 && <span className={s.segNeg} style={{ flex: d.neg }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className={s.trendAxis}>
        <span>{trend[0] ? label(trend[0].day) : ""}</span>
        <span>{trend.length ? label(trend[trend.length - 1].day) : ""}</span>
      </div>
      <div className={s.legend}>
        <span className={`${s.mark} ${s.t_good}`}>Positive</span>
        <span className={`${s.mark} ${s.t_neu}`}>Neutral</span>
        <span className={`${s.mark} ${s.t_crit}`}>Negative</span>
      </div>
    </>
  );
}

function Bars({ items }: { items: { label: string; value: number; extra?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className={s.bars}>
      {items.map((i) => (
        <li key={i.label}>
          <div className={s.barTop}>
            <span className={s.barL}>{i.label}</span>
            <span className={s.barV}>
              {i.value}
              {i.extra && <span className={s.hint}> · {i.extra}</span>}
            </span>
          </div>
          <div className={s.barTrack}>
            <span style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
