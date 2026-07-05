"use client";

// Analytics tab: headline rates with deltas, weekly sends/opens line chart,
// funnel, sequence report card, reply rate by template. All data from
// /api/leads/analytics (outreach_drafts + outreach_events aggregates).
// Chart palette validated for CVD + contrast: green #31875A, gold #B87A10,
// blue #3576B5, terra #C2492E.

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { AnalyticsData } from "./types";

const GREEN = "#31875A";
const BLUE = "#3576B5";
const GRADE_CLS: Record<string, string> = { A: "bg-green", B: "bg-blue", C: "bg-gold", D: "bg-terra", F: "bg-terra" };

export default function AnalyticsView() {
  const toast = useToast();
  const [range, setRange] = useState<"30" | "90" | "all">("30");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/analytics?range=${range}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "load failed");
      setData(json);
    } catch (e) {
      toast.push({ kind: "error", text: `Analytics: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setLoading(false);
    }
  }, [range, toast]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="pm-empty">Loading…</div>;
  if (!data) return <div className="pm-empty">No analytics yet.</div>;

  const h = data.headline;
  if (h.sent === 0) {
    return (
      <div className="pm-empty">
        No emails sent in this period yet. Once sequences start sending, open, click and reply
        rates show up here.
      </div>
    );
  }

  const delta = (cur: number, prev: number | undefined, unit: "pts" | "%") => {
    if (prev == null) return null;
    const d = Math.round((cur - prev) * 10) / 10;
    if (Math.abs(d) < 0.05) return <span className={styles.deltaFlat}>— steady</span>;
    const up = d > 0;
    return (
      <span className={up ? styles.deltaUp : styles.deltaDown}>
        {up ? "▲" : "▼"} {Math.abs(d)} {unit}
      </span>
    );
  };

  return (
    <div style={{ opacity: loading ? 0.7 : 1, transition: "opacity 0.2s" }}>
      <div className={styles.anHead}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Outreach analytics</h2>
        <div className="pm-tabs" style={{ marginBottom: 0 }}>
          {(["30", "90", "all"] as const).map((r) => (
            <button key={r} type="button" className={`pm-tab${range === r ? " on" : ""}`} onClick={() => setRange(r)}>
              {r === "all" ? "All time" : `${r} days`}
            </button>
          ))}
        </div>
      </div>

      <div className="pm-kpis" style={{ marginBottom: 16 }}>
        <div className="pm-kpi">
          <div className="pm-muted" style={{ fontSize: 12 }}>Emails sent</div>
          <div className={styles.anNum}>{h.sent}</div>
          {data.prior && data.prior.sent > 0
            ? delta(Math.round(((h.sent - data.prior.sent) / data.prior.sent) * 1000) / 10, 0, "%")
            : null}
        </div>
        <div className="pm-kpi">
          <div className="pm-muted" style={{ fontSize: 12 }}>Open rate</div>
          <div className={styles.anNum}>{h.open_rate}%</div>
          {delta(h.open_rate, data.prior?.open_rate, "pts")}
        </div>
        <div className="pm-kpi">
          <div className="pm-muted" style={{ fontSize: 12 }}>Click rate</div>
          <div className={styles.anNum}>{h.click_rate}%</div>
          {delta(h.click_rate, data.prior?.click_rate, "pts")}
        </div>
        <div className="pm-kpi">
          <div className="pm-muted" style={{ fontSize: 12 }}>Reply rate</div>
          <div className={styles.anNum}>{h.reply_rate}%</div>
          {delta(h.reply_rate, data.prior?.reply_rate, "pts")}
        </div>
        <div className="pm-kpi">
          <div className="pm-muted" style={{ fontSize: 12 }}>Bounce rate</div>
          <div className={styles.anNum}>{h.bounce_rate}%</div>
          {delta(h.bounce_rate, data.prior?.bounce_rate, "pts")}
        </div>
      </div>

      <div className={styles.anGrid}>
        <div className={styles.chartCard}>
          <h3>Sends and opens per week</h3>
          <div className={styles.legend}>
            <span><i style={{ background: GREEN }} /> Sent</span>
            <span><i style={{ background: BLUE }} /> Opened</span>
          </div>
          <WeeklyChart series={data.series} />
        </div>

        <div className={styles.chartCard}>
          <h3>Funnel</h3>
          <p className={styles.chartSub}>Of every email sent, how far it gets</p>
          <div className={styles.funnel}>
            {(
              [
                ["Sent", h.sent, 100],
                ["Delivered", h.delivered, pct(h.delivered, h.sent)],
                ["Opened", h.opened, pct(h.opened, h.sent)],
                ["Clicked", h.clicked, pct(h.clicked, h.sent)],
                ["Replied", h.replied, pct(h.replied, h.sent)],
              ] as const
            ).map(([label, n, p]) => (
              <div key={label} className={styles.funnelRow}>
                <span className={styles.funnelLabel}>{label}</span>
                <span className={styles.funnelTrack}><i style={{ width: `${p}%` }} /></span>
                <span className={styles.funnelValue}>{n} <small>{p}%</small></span>
              </div>
            ))}
          </div>
          {h.bounced > 0 && (
            <p className={styles.chartSub} style={{ marginTop: 10 }}>
              {h.bounced} bounced and were auto-suppressed.
            </p>
          )}
        </div>
      </div>

      <div className={styles.anGrid}>
        <div className={styles.chartCard}>
          <h3>Sequence report card</h3>
          <p className={styles.chartSub}>Grades weigh reply rate first, then opens; bounces subtract</p>
          {data.sequences.length === 0 ? (
            <div className="pm-empty" style={{ padding: 16 }}>No sequence sends in this period.</div>
          ) : (
            <div className="pm-tablewrap">
              <table className="pm-tbl">
                <thead>
                  <tr><th /><th>Sequence</th><th>Sent</th><th>Open</th><th>Click</th><th>Reply</th><th>Bounce</th></tr>
                </thead>
                <tbody>
                  {data.sequences.map((s) => (
                    <tr key={s.id}>
                      <td><span className={`pm-badge2 ${GRADE_CLS[s.grade] ?? "bg-gray"}`} style={{ fontWeight: 800 }}>{s.grade}</span></td>
                      <td><span className="pm-b7">{s.name}</span></td>
                      <td>{s.sent}</td>
                      <td>{s.open_rate}%</td>
                      <td>{s.click_rate}%</td>
                      <td>{s.reply_rate}%</td>
                      <td>{s.bounce_rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className={styles.chartCard}>
          <h3>Reply rate by template</h3>
          <p className={styles.chartSub}>Which copy actually gets answers</p>
          {data.templates.length === 0 ? (
            <div className="pm-empty" style={{ padding: 16 }}>No template sends in this period.</div>
          ) : (
            <div style={{ marginTop: 6 }}>
              {data.templates.map((t) => {
                const max = Math.max(...data.templates.map((x) => x.reply_rate), 1);
                return (
                  <div key={t.id} className={styles.tplBarRow}>
                    <span className={styles.tplBarLabel} title={`${t.sent} sent`}>{t.name}</span>
                    <span className={styles.tplBarTrack}><i style={{ width: `${(t.reply_rate / max) * 100}%` }} /></span>
                    <span className={styles.tplBarValue}>{t.reply_rate}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function WeeklyChart({ series }: { series: { week: string; sent: number; opened: number }[] }) {
  if (series.length < 2) {
    return <div className="pm-empty" style={{ padding: 16 }}>Not enough weeks of data for a trend yet.</div>;
  }
  const W = 660;
  const H = 210;
  const PAD_L = 34;
  const PAD_R = 40;
  const PAD_T = 14;
  const PAD_B = 28;
  const max = Math.max(...series.map((s) => s.sent), 5);
  const x = (i: number) => PAD_L + (i * (W - PAD_L - PAD_R)) / (series.length - 1);
  const y = (v: number) => H - PAD_B - (v / max) * (H - PAD_T - PAD_B);
  const pts = (key: "sent" | "opened") => series.map((s, i) => `${x(i)},${y(s[key])}`).join(" ");
  const gridVals = [0, Math.round(max / 2), max];
  const label = (w: string) => new Date(w).toLocaleDateString([], { month: "short", day: "numeric" });
  const last = series[series.length - 1];

  return (
    <div className={styles.chartScroll}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line chart of emails sent and opened per week" style={{ width: "100%", height: "auto", display: "block" }}>
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)} stroke="var(--pm-line, #EFE8DB)" strokeWidth={1} />
            <text x={PAD_L - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--pm-hint, #9A9081)">{v}</text>
          </g>
        ))}
        {series.map((s, i) =>
          i % Math.ceil(series.length / 6) === 0 ? (
            <text key={s.week} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--pm-hint, #9A9081)">
              {label(s.week)}
            </text>
          ) : null,
        )}
        <polyline fill="none" stroke={GREEN} strokeWidth={2} points={pts("sent")} />
        <polyline fill="none" stroke={BLUE} strokeWidth={2} points={pts("opened")} />
        {series.map((s, i) => (
          <g key={s.week}>
            <circle cx={x(i)} cy={y(s.sent)} r={4} fill={GREEN} stroke="var(--pm-card, #fff)" strokeWidth={2}>
              <title>{`${label(s.week)} — sent ${s.sent}`}</title>
            </circle>
            <circle cx={x(i)} cy={y(s.opened)} r={4} fill={BLUE} stroke="var(--pm-card, #fff)" strokeWidth={2}>
              <title>{`${label(s.week)} — opened ${s.opened}`}</title>
            </circle>
          </g>
        ))}
        <text x={x(series.length - 1) + 8} y={y(last.sent) + 4} fontSize={11} fontWeight={600} fill="var(--pm-ink, #1A1714)">{last.sent}</text>
        <text x={x(series.length - 1) + 8} y={y(last.opened) + 4} fontSize={11} fontWeight={600} fill="var(--pm-ink, #1A1714)">{last.opened}</text>
      </svg>
    </div>
  );
}
