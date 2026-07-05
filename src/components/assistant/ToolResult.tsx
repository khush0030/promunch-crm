"use client";

// Renders Maya's tool activity inside the conversation. While a tool runs it
// shows a pulsing chip; when it returns, the numeric tools materialise as
// compact data cards (KPIs, channel bars, sparkline, status rows) built from
// the tool's JSON output. Chart palette is the project-validated categorical
// set: #31875A, #B87A10, #3576B5, #C2492E.

import { useState } from "react";
import { Activity, CircleAlert, MessageCircle, Sparkles, Store } from "lucide-react";
import styles from "./ToolResult.module.css";

export type ToolPartLike = {
  type: string;
  state?: string;
  output?: unknown;
};

const PENDING_LABELS: Record<string, string> = {
  query_orders: "Reading Shopify orders",
  get_whatsapp_stats: "Reading WhatsApp stats",
  get_system_health: "Running health checks",
  get_leads_pipeline: "Reading the B2B pipeline",
  get_email_stats: "Reading email stats",
  get_amazon_stats: "Reading Amazon data",
  search_customer: "Looking up the customer",
  search_kb: "Reading the knowledge base",
  get_audit_log: "Reading the audit log",
};

const DONE_LABELS: Record<string, string> = {
  search_customer: "Customer records pulled",
  search_kb: "Knowledge base read",
  get_audit_log: "Audit log read",
};

const CHANNEL_COLORS: Record<string, string> = {
  "PROMUNCH D2C Website": "#31875A",
  "HYPD Marketplace": "#B87A10",
  "Other Marketplace": "#3576B5",
  "HYPD Creator": "#C2492E",
};
const NEUTRAL_BAR = "#B9AE99";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const num = (n: number) => Math.round(n).toLocaleString("en-IN");

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// --- Orders card -----------------------------------------------------------

function OrdersCard({ out }: { out: Rec }) {
  const totals = rec(out.totals);
  const revenue = asNum(totals.revenue) ?? 0;
  const orders = asNum(totals.orders) ?? 0;
  const aov = asNum(totals.aov) ?? 0;
  const windowDays = asNum(out.window_days);

  const byChannel = Object.entries(rec(out.by_channel))
    .map(([label, v]) => ({ label, revenue: asNum(rec(v).revenue) ?? 0, orders: asNum(rec(v).orders) ?? 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
  const maxRev = Math.max(1, ...byChannel.map((c) => c.revenue));

  const byDay = Object.entries(rec(out.by_day))
    .map(([d, v]) => ({ d, revenue: asNum(rec(v).revenue) ?? 0 }))
    .sort((a, b) => (a.d < b.d ? -1 : 1));

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <Store size={13} /> Shopify orders{windowDays ? ` · last ${windowDays}d` : ""}
      </div>
      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Revenue</div>
          <div className={styles.kpiValue}>{inr(revenue)}</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Orders</div>
          <div className={styles.kpiValue}>{num(orders)}</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Avg order</div>
          <div className={styles.kpiValue}>{inr(aov)}</div>
        </div>
      </div>

      {byChannel.length > 0 && (
        <>
          <hr className={styles.divider} />
          {byChannel.map((c) => (
            <div key={c.label} className={styles.barRow}>
              <span className={styles.barLabel}>{c.label}</span>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{ width: `${(c.revenue / maxRev) * 100}%`, background: CHANNEL_COLORS[c.label] ?? NEUTRAL_BAR }}
                />
              </div>
              <span className={styles.barValue}>{inr(c.revenue)}</span>
            </div>
          ))}
        </>
      )}

      {byDay.length > 2 && <Sparkline points={byDay} />}

      <div className={styles.footnote}>
        shopify_orders · creator seed orders {out.creator_seed_orders_excluded ? `excluded (${num(asNum(out.creator_seed_orders_excluded) ?? 0)})` : "included"}
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: { d: string; revenue: number }[] }) {
  const W = 520;
  const H = 52;
  const PAD = 4;
  const max = Math.max(1, ...points.map((p) => p.revenue));
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.revenue).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
  return (
    <>
      <hr className={styles.divider} />
      <svg className={styles.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Daily revenue trend">
        <path d={area} fill="#31875A" opacity={0.09} />
        <path d={line} fill="none" stroke="#31875A" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={p.d} className={styles.sparkPoint} cx={x(i)} cy={y(p.revenue)} r={5}>
            <title>{`${p.d}: ${inr(p.revenue)}`}</title>
          </circle>
        ))}
      </svg>
      <div className={styles.sparkMeta}>
        <span>{points[0].d}</span>
        <span>daily revenue · peak {inr(max)}</span>
        <span>{points[points.length - 1].d}</span>
      </div>
    </>
  );
}

// --- Health card -----------------------------------------------------------

type Tone = "good" | "warn" | "bad" | "unknown";
const DOT: Record<Tone, string> = {
  good: styles.dotGood,
  warn: styles.dotWarn,
  bad: styles.dotBad,
  unknown: styles.dotUnknown,
};

function StatusRow({ tone, label, pill }: { tone: Tone; label: string; pill: string }) {
  return (
    <div className={styles.statusRow}>
      <span className={`${styles.statusDot} ${DOT[tone]}`} aria-hidden />
      <span className={styles.statusLabel}>{label}</span>
      <span className={styles.statusPill}>{pill}</span>
    </div>
  );
}

function HealthCard({ out }: { out: Rec }) {
  // Captured once so render stays pure; freshness math only needs day precision.
  const [now] = useState(() => Date.now());
  const rows: { tone: Tone; label: string; pill: string }[] = [];

  const wa = rec(out.whatsapp);
  if (Object.keys(wa).length) {
    const status = String(wa.status ?? "unknown");
    const uptime = asNum(wa.uptime_24h_pct);
    const failed = asNum(wa.failed_outbound_24h) ?? 0;
    rows.push({
      tone: status === "up" ? (failed > 0 ? "warn" : "good") : status === "down" ? "bad" : "unknown",
      label: "WhatsApp Cloud API",
      pill: status === "up" ? `up · ${uptime ?? "?"}% 24h${failed ? ` · ${failed} failed sends` : ""}` : status,
    });
  }

  const errs = rec(out.connector_errors_24h);
  const errCount = asNum(errs.count);
  if (errCount !== null) {
    const names = Object.keys(rec(errs.by_connector)).slice(0, 3).join(", ");
    rows.push({
      tone: errCount === 0 ? "good" : errCount < 5 ? "warn" : "bad",
      label: "Connector errors · 24h",
      pill: errCount === 0 ? "none" : `${errCount}${names ? ` (${names})` : ""}`,
    });
  }

  if (Array.isArray(out.cron_jobs)) {
    const jobs = out.cron_jobs as Rec[];
    const failing = jobs.filter((j) => j.last_status && j.last_status !== "succeeded");
    const inactive = jobs.filter((j) => j.active === false);
    const bad = failing.length + inactive.length;
    rows.push({
      tone: bad === 0 ? "good" : "warn",
      label: `Cron jobs (${jobs.length})`,
      pill: bad === 0 ? "all recent runs ok" : `${failing.length} failing · ${inactive.length} inactive`,
    });
  } else if (rec(out.cron_jobs).error) {
    rows.push({ tone: "unknown", label: "Cron jobs", pill: "unavailable" });
  }

  const waJobs = rec(out.wa_jobs_by_status);
  const failedJobs = asNum(waJobs.failed) ?? 0;
  if (Object.keys(waJobs).length && !waJobs.error) {
    rows.push({
      tone: failedJobs === 0 ? "good" : "warn",
      label: "Background job queue",
      pill: failedJobs === 0 ? "no failures · 7d" : `${failedJobs} failed · 7d`,
    });
  }

  if (typeof out.shopify_last_order_at === "string") {
    const days = Math.floor((now - new Date(out.shopify_last_order_at).getTime()) / 86_400_000);
    rows.push({
      tone: days <= 3 ? "good" : "warn",
      label: "Shopify order feed",
      pill: days === 0 ? "synced today" : `last order ${days}d ago`,
    });
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <Activity size={13} /> System health
      </div>
      {rows.map((r) => (
        <StatusRow key={r.label} {...r} />
      ))}
      <div className={styles.footnote}>connector_events · cron.job · wa_jobs · shopify_orders</div>
    </div>
  );
}

// --- WhatsApp card ---------------------------------------------------------

const WA_SEGMENTS = [
  { key: "read", label: "Read", color: "#31875A" },
  { key: "delivered", label: "Delivered", color: "#7FB598" },
  { key: "sent", label: "Sent", color: "#B87A10" },
  { key: "queued", label: "Queued", color: "#B9AE99" },
  { key: "failed", label: "Failed", color: "#C2492E" },
] as const;

function WhatsappCard({ out }: { out: Rec }) {
  const ob = rec(out.outbound);
  const counts = WA_SEGMENTS.map((s) => ({ ...s, value: asNum(ob[s.key]) ?? 0 }));
  const total = counts.reduce((s, c) => s + c.value, 0);
  const okPct = total ? Math.round(((counts[0].value + counts[1].value) / total) * 100) : null;
  const windowDays = asNum(out.window_days);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <MessageCircle size={13} /> WhatsApp{windowDays ? ` · last ${windowDays}d` : ""}
      </div>
      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Outbound</div>
          <div className={styles.kpiValue}>{num(total)}</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Delivered or read</div>
          <div className={styles.kpiValue}>{okPct !== null ? `${okPct}%` : "–"}</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Inbound</div>
          <div className={styles.kpiValue}>{num(asNum(out.inbound_messages) ?? 0)}</div>
        </div>
      </div>
      {total > 0 && (
        <>
          <div className={styles.split}>
            {counts
              .filter((c) => c.value > 0)
              .map((c) => (
                <div key={c.key} className={styles.splitSeg} style={{ flexGrow: c.value, background: c.color }} title={`${c.label}: ${num(c.value)}`} />
              ))}
          </div>
          <div className={styles.legend}>
            {counts
              .filter((c) => c.value > 0)
              .map((c) => (
                <span key={c.key} className={styles.legendItem}>
                  <span className={styles.legendDot} style={{ background: c.color }} /> {c.label} {num(c.value)}
                </span>
              ))}
          </div>
        </>
      )}
      <div className={styles.footnote}>wa_messages · sent means accepted, awaiting delivery receipt</div>
    </div>
  );
}

// --- Generic fact card -----------------------------------------------------

function collectFacts(out: Rec, prefix = "", depth = 0): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries(out)) {
    if (k === "window_days" || k === "note" || k === "error") continue;
    const label = prefix ? `${prefix} ${k.replaceAll("_", " ")}` : k.replaceAll("_", " ");
    if (typeof v === "number") facts.push({ label, value: num(v) });
    else if (depth < 1 && v && typeof v === "object" && !Array.isArray(v)) facts.push(...collectFacts(v as Rec, label, depth + 1));
    else if (Array.isArray(v) && v.length) facts.push({ label, value: `${v.length} rows` });
  }
  return facts;
}

function FactsCard({ name, out }: { name: string; out: Rec }) {
  const facts = collectFacts(out).slice(0, 8);
  if (!facts.length) return <DoneChip name={name} />;
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <Sparkles size={13} /> {name.replaceAll("_", " ").replace(/^get /, "")}
      </div>
      <div className={styles.facts}>
        {facts.map((f) => (
          <div key={f.label} className={styles.fact}>
            <div className={styles.factLabel}>{f.label}</div>
            <div className={styles.factValue}>{f.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Chips + dispatcher ----------------------------------------------------

function DoneChip({ name }: { name: string }) {
  return (
    <span className={styles.chip}>
      <Sparkles size={12} /> {DONE_LABELS[name] ?? `${name.replaceAll("_", " ")} done`}
    </span>
  );
}

export function ToolResult({ part }: { part: ToolPartLike }) {
  const name = part.type.replace(/^tool-/, "");

  if (part.state === "output-error") {
    return (
      <span className={`${styles.chip} ${styles.chipError}`}>
        <CircleAlert size={12} /> {PENDING_LABELS[name] ?? name} failed
      </span>
    );
  }
  if (part.state !== "output-available") {
    return (
      <span className={`${styles.chip} ${styles.chipPending}`}>
        <Sparkles size={12} /> {PENDING_LABELS[name] ?? `Running ${name.replaceAll("_", " ")}`}…
      </span>
    );
  }

  const out = rec(part.output);
  if (out.error) {
    return (
      <span className={`${styles.chip} ${styles.chipError}`}>
        <CircleAlert size={12} /> {name.replaceAll("_", " ")}: {String(out.error).slice(0, 80)}
      </span>
    );
  }

  switch (name) {
    case "query_orders":
      return <OrdersCard out={out} />;
    case "get_system_health":
      return <HealthCard out={out} />;
    case "get_whatsapp_stats":
      return <WhatsappCard out={out} />;
    case "search_kb":
    case "search_customer":
    case "get_audit_log":
      return <DoneChip name={name} />;
    default:
      return <FactsCard name={name} out={out} />;
  }
}
