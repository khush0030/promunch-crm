"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Send, CheckCheck, Eye, CornerUpLeft, ShoppingBag, IndianRupee,
  TrendingUp, Activity, AlertTriangle, RefreshCw, Info, Clock, Users, Megaphone, Radio,
} from "lucide-react";
import { KpiCard, Panel, AttentionItem, StatusBadge, DataTable } from "@/components/pm";
import type { KpiTone, Column } from "@/components/pm";

// WhatsApp analytics, written for an employee, not an engineer. Every tile and
// bar carries a plain-English meaning + a verdict, so nobody has to know what
// "delivery rate" means to act on it.

type Funnel = { key: string; label: string; count: number | null; pct: number; unit: string; soon?: boolean };
type FailGroup = { category: string; title: string; cause: string; count: number; willRetry: boolean; action: string; tone: "r" | "a" | "b" };
type Data = {
  window: { days: number };
  headline: {
    sent: number; delivered: number; deliveredPct: number; read: number; readPct: number;
    replies: number; orders: number; revenue: number; spend: number; roi: number | null;
  };
  today: { sent: number; replies: number };
  funnel: Funnel[];
  failures: { total: number; groups: FailGroup[] };
  health: { tone: "g" | "a" | "r"; label: string; note: string };
};

type Card = {
  id: string; name: string; status: string; sent: number; deliveredPct: number; readPct: number;
  failed: number; clicks: number; orders: number; revenue: number; cost: number; roi: number | null; grade: string; verdict: string;
};
type Hints = {
  bestTime: { hour: number; label: string; note: string } | null;
  topSegment: { name: string; note: string } | null;
};
type CampData = { campaigns: Card[]; hints: Hints };
type ActItem = { at: string; type: "reply" | "campaign" | "order"; tone: "b" | "g" | "o"; title: string; sub?: string };
type ConvRow = { dest: string; sent: number; clicks: number; clickers: number; orders: number; revenue: number; convPct: number };
type ConvData = { totals: { links: number; clicks: number; clickers: number; orders: number; revenue: number; convPct: number }; rows: ConvRow[] };

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

const GRADE_TONE: Record<string, "green" | "gold" | "terra" | "gray"> = {
  A: "green", B: "green", C: "gold", D: "gold", F: "terra",
};

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const num = (n: number) => n.toLocaleString("en-IN");

export default function AnalyticsView() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Data | null>(null);
  const [c, setC] = useState<CampData | null>(null);
  const [conv, setConv] = useState<ConvData | null>(null);
  const [act, setAct] = useState<ActItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2, r3] = await Promise.all([
        fetch(`/api/whatsapp/analytics?days=${days}`),
        fetch(`/api/whatsapp/analytics/campaigns?days=${days}`),
        fetch(`/api/whatsapp/analytics/conversion?days=${days}`),
      ]);
      setD(await r1.json());
      setC(await r2.json());
      setConv(await r3.json());
    } catch { /* keep last good */ }
    setLoading(false);
  }, [days]);
  useEffect(() => { load(); }, [load]);

  // Live feed: independent of the window, polled every 30s.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/api/whatsapp/analytics/activity");
        const j = await r.json();
        if (alive) setAct(j.items ?? []);
      } catch { /* keep last good */ }
    };
    pull();
    const t = setInterval(pull, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div>
      {/* window picker */}
      <div className="pm-toolbar" style={{ justifyContent: "space-between" }}>
        <div className="pm-chips">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              className={`pm-chip${days === w.days ? " on" : ""}`}
              onClick={() => setDays(w.days)}
            >
              Last {w.label}
            </button>
          ))}
        </div>
        <button type="button" className="pm-chip" onClick={load} title="Refresh">
          <RefreshCw size={13} style={{ verticalAlign: "-2px" }} /> Refresh
        </button>
      </div>

      {loading && !d ? (
        <div className="pm-csub" style={{ padding: "40px 0", textAlign: "center" }}>Loading analytics…</div>
      ) : !d ? (
        <div className="pm-csub" style={{ padding: "40px 0", textAlign: "center" }}>No data yet.</div>
      ) : (
        <>
          <Headline d={d} />
          {c?.hints && (c.hints.bestTime || c.hints.topSegment) && (
            <>
              <div style={{ height: 18 }} />
              <HintsRow hints={c.hints} />
            </>
          )}
          <div style={{ height: 18 }} />
          <div className="pm-grid g-2">
            <FunnelPanel d={d} />
            <FailurePanel d={d} />
          </div>
          {c?.campaigns && c.campaigns.length > 0 && (
            <>
              <div style={{ height: 18 }} />
              <CampaignCards cards={c.campaigns} />
            </>
          )}
          {conv && (conv.rows.length > 0 || conv.totals.clicks > 0) && (
            <>
              <div style={{ height: 18 }} />
              <ConversionPanel conv={conv} />
            </>
          )}
          {act.length > 0 && (
            <>
              <div style={{ height: 18 }} />
              <ActivityFeed items={act} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---- Conversion: which links drove orders -----------------------------------

function ConversionPanel({ conv }: { conv: ConvData }) {
  const t = conv.totals;
  const cols: Column<ConvRow>[] = [
    { header: "Link", cell: (r) => <span style={{ fontWeight: 600, wordBreak: "break-all" }}>{r.dest}</span> },
    { header: "Sent", align: "right", cell: (r) => num(r.sent) },
    { header: "Clicks", align: "right", cell: (r) => num(r.clicks) },
    { header: "Buyers", align: "right", cell: (r) => num(r.orders) },
    { header: "Revenue", align: "right", cell: (r) => <span style={{ fontWeight: 700 }}>{inr(r.revenue)}</span> },
    {
      header: "Conv.", align: "right",
      cell: (r) => <StatusBadge tone={r.convPct >= 20 ? "green" : r.convPct > 0 ? "gold" : "gray"}>{r.convPct}%</StatusBadge>,
    },
  ];
  return (
    <Panel title="What links drove orders" icon={<TrendingUp className="tic" size={18} />} caption={`Tracked links a customer clicked, then bought within 7 days (last-click). ${num(t.clicks)} clicks from ${num(t.clickers)} people → ${num(t.orders)} orders (${inr(t.revenue)}).`}>
      {conv.rows.length === 0 ? (
        <div className="pm-csub" style={{ padding: "18px 0", marginBottom: 0 }}>
          Links are being clicked but no orders yet in this window.
        </div>
      ) : (
        <DataTable columns={cols} rows={conv.rows} rowKey={(r) => r.dest} />
      )}
    </Panel>
  );
}

// ---- Live activity feed: watch the channel work ------------------------------

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ActivityFeed({ items }: { items: ActItem[] }) {
  const dot = (t: ActItem["tone"]) => (t === "g" ? "var(--pm-green)" : t === "b" ? "var(--pm-blue)" : "var(--pm-gold)");
  const ico = (t: ActItem["type"]) =>
    t === "order" ? <ShoppingBag size={14} /> : t === "reply" ? <CornerUpLeft size={14} /> : <Megaphone size={14} />;
  return (
    <Panel title="Live activity" icon={<Radio className="tic" size={18} />} caption="The latest replies, campaigns and orders — refreshes on its own.">
      <div>
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderTop: i === 0 ? "0" : "1px solid var(--pm-line)" }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: dot(it.tone), background: "var(--pm-card2)" }}>
              {ico(it.type)}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--pm-ink)" }}>{it.title}</span>
              {it.sub && <span style={{ display: "block", fontSize: 11.5, color: "var(--pm-hint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.sub}</span>}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--pm-hint)", flexShrink: 0 }}>{timeAgo(it.at)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---- Smart hints: data-driven nudges, not charts -----------------------------

function HintsRow({ hints }: { hints: Hints }) {
  return (
    <div className="pm-grid g-11">
      {hints.bestTime && (
        <Panel title="Best time to send" icon={<Clock className="tic" size={18} />}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.6px", color: "var(--pm-green)" }}>
              {hints.bestTime.label}
            </div>
            <span className="pm-csub" style={{ margin: 0 }}>{hints.bestTime.note}</span>
          </div>
        </Panel>
      )}
      {hints.topSegment && (
        <Panel title="Best-responding customers" icon={<Users className="tic" size={18} />}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.6px", color: "var(--pm-blue)" }}>
              {hints.topSegment.name}
            </div>
            <span className="pm-csub" style={{ margin: 0 }}>{hints.topSegment.note}</span>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ---- Campaign report cards: a grade + verdict per campaign -------------------

function CampaignCards({ cards }: { cards: Card[] }) {
  return (
    <Panel title="Campaign report cards" icon={<Megaphone className="tic" size={18} />} caption="Each campaign graded A–F with a one-line verdict, so you can see what worked at a glance.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginTop: 4 }}>
        {cards.map((c) => (
          <div key={c.id} style={{ border: "1px solid var(--pm-border)", borderRadius: "var(--pm-r2)", padding: "14px 15px", background: "var(--pm-card)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3, minWidth: 0 }}>{c.name}</div>
              <span style={{
                flexShrink: 0, width: 30, height: 30, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: 15, color: "#fff",
                background: c.grade === "A" || c.grade === "B" ? "var(--pm-green)" : c.grade === "C" || c.grade === "D" ? "var(--pm-gold)" : "var(--pm-terra)",
              }}>{c.grade}</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--pm-muted)", margin: "7px 0 11px", lineHeight: 1.4 }}>{c.verdict}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
              <Mini label="Sent" value={num(c.sent)} />
              <Mini label="Read" value={`${c.readPct}%`} />
              {c.clicks > 0 ? <Mini label="Clicks" value={num(c.clicks)} /> : <Mini label="Orders" value={num(c.orders)} />}
              {c.clicks > 0 && <Mini label="Orders" value={num(c.orders)} />}
              <Mini label="Revenue" value={inr(c.revenue)} />
              <Mini label="Cost" value={inr(c.cost)} />
              <Mini label="Return" value={c.roi != null ? `${c.roi.toFixed(1)}x` : "—"} tone={c.roi != null && c.roi < 1 ? "var(--pm-terra)" : undefined} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={{ color: "var(--pm-hint)", fontSize: 10.5, marginBottom: 1 }}>{label}</div>
      <div style={{ fontWeight: 700, color: tone ?? "var(--pm-ink)" }}>{value}</div>
    </div>
  );
}

// ---- Headline strip: the 3-second view --------------------------------------

function Headline({ d }: { d: Data }) {
  const h = d.headline;
  const tone: Record<string, KpiTone> = { g: "g", a: "o", r: "t" } as const as Record<string, KpiTone>;

  const cards: Array<{
    label: string; value: string; icon: React.ReactNode; tone: KpiTone; sub: string;
  }> = [
    {
      label: "Messages sent", value: num(h.sent), icon: <Send size={17} />, tone: "g",
      sub: `${num(d.today.sent)} sent today`,
    },
    {
      label: "Delivered", value: `${h.deliveredPct}%`, icon: <CheckCheck size={17} />,
      tone: h.deliveredPct >= 85 ? "g" : h.deliveredPct >= 60 ? "o" : "t",
      sub: deliveredVerdict(h.deliveredPct),
    },
    {
      label: "Read", value: `${h.readPct}%`, icon: <Eye size={17} />,
      tone: h.readPct >= 50 ? "g" : h.readPct >= 25 ? "o" : "t",
      sub: readVerdict(h.readPct),
    },
    {
      label: "Replies", value: num(h.replies), icon: <CornerUpLeft size={17} />, tone: "b",
      sub: `${num(d.today.replies)} replies today`,
    },
    {
      label: "Orders from WhatsApp", value: num(h.orders), icon: <ShoppingBag size={17} />, tone: "g",
      sub: "from customers we messaged",
    },
    {
      label: "Revenue", value: inr(h.revenue), icon: <IndianRupee size={17} />, tone: "g",
      sub: "in this period",
    },
    {
      label: "Message cost", value: inr(h.spend), icon: <Activity size={17} />, tone: "o",
      sub: "estimated Meta charges",
    },
    {
      label: "Return", value: h.roi != null ? `${h.roi.toFixed(1)}x` : "—",
      icon: <TrendingUp size={17} />,
      tone: h.roi == null ? "b" : h.roi >= 3 ? "g" : h.roi >= 1 ? "o" : "t",
      sub: roiVerdict(h.roi),
    },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <StatusBadge tone={d.health.tone === "g" ? "green" : d.health.tone === "a" ? "gold" : "terra"}>
          {d.health.label}
        </StatusBadge>
        <span className="pm-csub" style={{ margin: 0 }}>{d.health.note}</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(178px, 1fr))",
          gap: 14,
        }}
      >
        {cards.map((c) => (
          <KpiCard key={c.label} label={c.label} value={c.value} icon={c.icon} tone={c.tone} sub={c.sub} />
        ))}
      </div>
      <p className="pm-csub" style={{ marginTop: 10 }}>
        <Info size={12} style={{ verticalAlign: "-2px" }} /> &ldquo;Orders from WhatsApp&rdquo; counts customers we
        messaged in this period who then placed an order. Exact click-to-order tracking is coming soon.
      </p>
    </>
  );
}

function deliveredVerdict(pct: number) {
  if (pct >= 85) return "Most messages arrive. Good.";
  if (pct >= 60) return "Some not arriving — check numbers.";
  return "Many failing to deliver — look below.";
}
function readVerdict(pct: number) {
  if (pct >= 50) return "Strong open rate.";
  if (pct >= 25) return "Average — try a better first line.";
  return "Low — copy or timing needs work.";
}
function roiVerdict(roi: number | null) {
  if (roi == null) return "No cost recorded yet.";
  if (roi >= 3) return "Every ₹1 spent earns well.";
  if (roi >= 1) return "Breaking even and up.";
  return "Spending more than it earns.";
}

// ---- Funnel: where customers drop off ---------------------------------------

function FunnelPanel({ d }: { d: Data }) {
  const sent = d.headline.sent || 1;
  return (
    <Panel title="Customer journey" icon={<Activity className="tic" size={18} />} caption="How many people move from a sent message all the way to an order.">
      {d.funnel.map((f, i) => {
        const width = f.count == null ? 0 : Math.max(2, Math.round((f.count / sent) * 100));
        const color =
          f.key === "bought" ? "var(--pm-green)" :
          f.key === "replied" ? "var(--pm-blue)" :
          f.key === "clicked" ? "var(--pm-hint)" : "var(--pm-green)";
        const prev = i > 0 ? d.funnel[i - 1] : null;
        const drop = prev && prev.count && f.count != null ? Math.round((1 - f.count / prev.count) * 100) : null;
        return (
          <div key={f.key} style={{ margin: "13px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 5 }}>
              <span style={{ color: "var(--pm-muted)" }}>
                {f.label}{f.soon && <em style={{ color: "var(--pm-hint)", fontStyle: "normal" }}> · coming soon</em>}
              </span>
              <span style={{ color: "var(--pm-ink)", fontWeight: 600 }}>
                {f.count == null ? "—" : `${num(f.count)} ${f.unit}`}
                {drop != null && drop > 0 && (
                  <span style={{ color: "var(--pm-hint)", fontWeight: 400 }}> · {drop}% drop</span>
                )}
              </span>
            </div>
            <div style={{ height: 9, borderRadius: 6, background: "var(--pm-line)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", borderRadius: 6, width: `${width}%`, background: color, opacity: f.soon ? 0.4 : 1 }} />
            </div>
          </div>
        );
      })}
    </Panel>
  );
}

// ---- Failure translator: red turned into plain words ------------------------

function FailurePanel({ d }: { d: Data }) {
  const f = d.failures;
  return (
    <Panel title="Delivery problems" icon={<AlertTriangle className="tic" size={18} />} caption={f.total ? `${num(f.total)} message(s) didn't go through. Here's why, in plain words.` : "Nothing went wrong in this period."}>
      {f.total === 0 ? (
        <div className="pm-csub" style={{ padding: "18px 0", marginBottom: 0 }}>
          ✅ All messages went through. Nothing to fix.
        </div>
      ) : (
        f.groups.map((g) => (
          <AttentionItem
            key={g.category}
            tone={g.tone === "r" ? "r" : "a"}
            icon={<AlertTriangle />}
            text={
              <>
                {g.title} <span style={{ color: "var(--pm-hint)", fontWeight: 400 }}>· {num(g.count)} message(s)</span>
              </>
            }
            sub={g.action}
            action={
              <StatusBadge tone={g.willRetry ? "blue" : g.tone === "r" ? "terra" : "gray"}>
                {g.willRetry ? "Retries automatically" : "No retry"}
              </StatusBadge>
            }
          />
        ))
      )}
    </Panel>
  );
}
