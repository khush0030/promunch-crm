"use client";

// Results tab: WhatsApp numbers written for a marketing teammate, not an
// engineer. It leads with plain sentences, explains every word on hover, never
// grades a campaign that is too small (or an internal test) to judge, and
// calls Meta's #131049 hold-backs what they are: normal, not our fault.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Clock, CornerUpLeft, Megaphone, Radio, RefreshCw, ShoppingBag, TrendingUp, Users,
} from "lucide-react";
import { Card, DataTable, Kpi, KpiStrip } from "@/components/pm";
import type { Column } from "@/components/pm";
import { GlossaryTerm, HelpTip, PlainSummary } from "@/components/guide";
import { apiFetch } from "@/lib/api-fetch";
import { canGrade, inHundred, isTestCampaign, lastCampaignSentence, MIN_SENDS_TO_GRADE, periodSentences } from "./results/logic";
import s from "./results/results.module.css";

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
type CampCard = {
  id: string; name: string; status: string; sent: number; deliveredPct: number; readPct: number;
  failed: number; orders: number; revenue: number; cost: number; roi: number | null; grade: string; verdict: string;
};
type Hints = {
  bestTime: { hour: number; label: string; note: string } | null;
  topSegment: { name: string; note: string } | null;
};
type CampData = { campaigns: CampCard[]; hints: Hints };
type ActItem = { at: string; type: "reply" | "campaign" | "order"; tone: "b" | "g" | "o"; title: string; sub?: string };
type ConvRow = { campaign: string; medium: string; orders: number; revenue: number };
type ConvData = { totals: { orders: number; revenue: number }; rows: ConvRow[] };

const WINDOWS = [7, 30, 90];
const ACTIVITY_STEP = 10;

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const num = (n: number) => n.toLocaleString("en-IN");

// "deliverability" mixes Meta's per-person marketing hold-back (#131049) with
// numbers that aren't on WhatsApp; both are normal and not retried.
const FAIL_TEXT: Record<string, { title: string; action: string; heldBack?: boolean }> = {
  deliverability: {
    title: "Held back by Meta, or no WhatsApp on that number",
    action: "Meta limits how many marketing messages each person gets, and some numbers aren't on WhatsApp. This is normal and not a fault on our side.",
    heldBack: true,
  },
  rate: { title: "Sent too fast", action: "Meta asked us to slow down. These try again on their own. Nothing to do." },
  system: { title: "A hiccup at Meta", action: "A temporary problem on Meta's side. These try again on their own." },
};

export default function AnalyticsView() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Data | null>(null);
  const [c, setC] = useState<CampData | null>(null);
  const [conv, setConv] = useState<ConvData | null>(null);
  const [act, setAct] = useState<ActItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [d1, c1, v1] = await Promise.all([
        apiFetch<Data>(`/api/whatsapp/analytics?days=${days}`),
        apiFetch<CampData>(`/api/whatsapp/analytics/campaigns?days=${days}`).catch(() => null),
        apiFetch<ConvData>(`/api/whatsapp/analytics/conversion?days=${days}`).catch(() => null),
      ]);
      // Shape gates: never let an unexpected payload reach render.
      if (!d1?.headline || !d1.today || !Array.isArray(d1.funnel) || !d1.failures || !d1.health) {
        throw new Error("Unexpected analytics response");
      }
      setD(d1);
      setC(c1 && Array.isArray(c1.campaigns) ? c1 : null);
      setConv(v1 && Array.isArray(v1.rows) && v1.totals ? v1 : null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load results");
    }
    setLoading(false);
  }, [days]);
  useEffect(() => { load(); }, [load]);

  // Live feed: independent of the window, polled every 30s.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const j = await apiFetch<{ items?: ActItem[] }>("/api/whatsapp/analytics/activity");
        if (alive) setAct(Array.isArray(j.items) ? j.items : []);
      } catch { /* keep last good */ }
    };
    pull();
    const t = setInterval(pull, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className={s.wrap}>
      <div className={s.toolbar}>
        <div className="pm2-chips" role="group" aria-label="Period">
          {WINDOWS.map((w) => (
            <button key={w} type="button" className={`pm2-chip${days === w ? " on" : ""}`} aria-pressed={days === w} onClick={() => setDays(w)}>
              Last {w} days
            </button>
          ))}
        </div>
        <button type="button" className="pm2-btn sm" onClick={load} disabled={loading}>
          <RefreshCw aria-hidden="true" /> {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading && !d ? (
        <div className={s.center}>Loading results…</div>
      ) : loadError && !d ? (
        <div className={s.center}>
          <span>Couldn&apos;t load results: {loadError}</span>
          <button type="button" className="pm2-btn sm" onClick={load}><RefreshCw aria-hidden="true" /> Try again</button>
        </div>
      ) : !d ? (
        <div className={s.center}>No data yet.</div>
      ) : (
        <Body d={d} c={c} conv={conv} act={act} days={days} stale={!!loadError} />
      )}
    </div>
  );
}

function Body({ d, c, conv, act, days, stale }: {
  d: Data; c: CampData | null; conv: ConvData | null; act: ActItem[]; days: number; stale: boolean;
}) {
  const h = d.headline;
  const notArrived = d.failures.total;
  const heldBack = d.failures.groups.filter((g) => FAIL_TEXT[g.category]?.heldBack).reduce((a, g) => a + g.count, 0);
  const sentences = periodSentences(days, h, notArrived, heldBack);
  const last = c ? lastCampaignSentence(c.campaigns) : null;
  if (last) sentences.push(last);

  const attempted = h.sent + notArrived;
  const healthNote =
    d.health.tone === "r"
      ? "Some sends are blocked. See \"Messages that did not arrive\" below."
      : notArrived > 0
      ? `${num(notArrived)} of ${num(attempted)} messages did not arrive (${inHundred(notArrived, attempted) ?? 0} in 100).`
      : "Delivery is running normally.";

  return (
    <>
      {stale && <p className={s.note}>Couldn&apos;t refresh. Showing the last numbers we loaded.</p>}

      <div className={s.health}>
        <span className={`pm2-pill ${d.health.tone === "g" ? "good" : d.health.tone === "a" ? "warn" : "crit"}`}>{d.health.label}</span>
        <span>{healthNote}</span>
      </div>

      <PlainSummary title={`Last ${days} days in plain words`} sentences={sentences} />

      <KpiStrip>
        <Kpi label="Messages sent" value={num(h.sent)} sub={`${num(d.today.sent)} today`} />
        <Kpi label={<span className={s.kpiLabel}><GlossaryTerm k="delivered" /></span>} value={`${h.deliveredPct}%`} sub={deliveredVerdict(h.deliveredPct)} />
        <Kpi label={<span className={s.kpiLabel}><GlossaryTerm k="read" /></span>} value={`${h.readPct}%`} sub={readVerdict(h.readPct)} />
        <Kpi label={<span className={s.kpiLabel}><GlossaryTerm k="reply">Replies</GlossaryTerm></span>} value={num(h.replies)} sub={`${num(d.today.replies)} today`} />
      </KpiStrip>
      <KpiStrip>
        <Kpi label="Orders after a message" value={num(h.orders)} sub="from people we messaged first" />
        <Kpi label="Revenue from those orders" value={inr(h.revenue)} sub="in this period" />
        <Kpi label="Message cost" value={inr(h.spend)} sub="estimated Meta charges" />
        <Kpi
          label={
            <span className={s.kpiLabel}>
              Estimated return
              <HelpTip term="attributed_order" text="Here it counts orders placed in this period by people who got a WhatsApp message from us before ordering, divided by the estimated Meta cost. A strong signal, not proof." />
            </span>
          }
          value={h.roi != null ? `${h.roi.toFixed(1)}x` : "Not yet"}
          sub={roiVerdict(h.roi)}
        />
      </KpiStrip>
      {conv && (
        <p className={s.note}>
          &ldquo;Orders after a message&rdquo; is a broad measure. The &ldquo;Orders from WhatsApp links&rdquo; panel below is the
          strict one: only orders where the customer tapped a WhatsApp link and then bought.
        </p>
      )}

      {c?.hints && (c.hints.bestTime || c.hints.topSegment) && <HintsRow hints={c.hints} />}

      <div className={s.g2}>
        <FunnelPanel d={d} />
        <FailurePanel d={d} attempted={attempted} />
      </div>

      {c && c.campaigns.length > 0 && <CampaignCards cards={c.campaigns} />}
      {conv && <ConversionPanel conv={conv} />}
      {act.length > 0 && <ActivityFeed items={act} />}
    </>
  );
}

/* ---- orders from tagged links ---- */

function ConversionPanel({ conv }: { conv: ConvData }) {
  const t = conv.totals;
  const cols: Column<ConvRow>[] = [
    { header: "Campaign", cell: (r) => <span style={{ fontWeight: 600, wordBreak: "break-word" }}>{r.campaign}</span> },
    { header: "Via", cell: (r) => <span className="pm-dim">{r.medium}</span> },
    { header: "Orders", align: "right", cell: (r) => num(r.orders) },
    { header: "Revenue", align: "right", cell: (r) => <span style={{ fontWeight: 700 }}>{inr(r.revenue)}</span> },
  ];
  return (
    <Card
      title={<><TrendingUp size={16} aria-hidden="true" /> Orders from WhatsApp links</>}
      basis={`${num(t.orders)} orders, ${inr(t.revenue)}`}
    >
      <p className={s.note}>Orders Shopify matched to a WhatsApp link the customer tapped, grouped by campaign.</p>
      {conv.rows.length === 0 ? (
        <div className={s.empty}>No orders from WhatsApp links yet. They show up here once customers tap a link and buy.</div>
      ) : (
        <DataTable columns={cols} rows={conv.rows} rowKey={(r) => r.campaign} />
      )}
    </Card>
  );
}

/* ---- live activity ---- */

function timeAgo(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function ActivityFeed({ items }: { items: ActItem[] }) {
  const [shown, setShown] = useState(ACTIVITY_STEP);
  const tone = (t: ActItem["tone"]) => (t === "g" ? s.tG : t === "b" ? s.tB : s.tO);
  const ico = (t: ActItem["type"]) =>
    t === "order" ? <ShoppingBag /> : t === "reply" ? <CornerUpLeft /> : <Megaphone />;
  return (
    <Card title={<><Radio size={16} aria-hidden="true" /> Live activity</>} basis="latest replies, campaigns and orders">
      <div>
        {items.slice(0, shown).map((it, i) => (
          <div key={`${it.at}-${i}`} className={s.act}>
            <span className={`${s.actIc} ${tone(it.tone)}`} aria-hidden="true">{ico(it.type)}</span>
            <span className={s.actText}>
              <span className={s.actTitle}>{it.title}</span>
              {it.sub && <span className={s.actSub}>{it.sub}</span>}
            </span>
            <span className={s.actAt}>{timeAgo(it.at)}</span>
          </div>
        ))}
      </div>
      {items.length > shown && (
        <button type="button" className={`pm2-btn sm ${s.more}`} onClick={() => setShown((n) => n + ACTIVITY_STEP)}>
          Show more ({items.length - shown} more)
        </button>
      )}
    </Card>
  );
}

/* ---- hints ---- */

function HintsRow({ hints }: { hints: Hints }) {
  return (
    <div className={s.g2}>
      {hints.bestTime && (
        <Card title={<><Clock size={16} aria-hidden="true" /> Best time to send</>}>
          <div className={s.hint}>
            <span className={s.hintBig}>{hints.bestTime.label.replace(/\u2013|\u2014/g, " to ")}</span>
            <span className={s.hintText}>{hints.bestTime.note.replace(/\s*\u2014\s*/g, ". ")}</span>
          </div>
        </Card>
      )}
      {hints.topSegment && (
        <Card title={<><Users size={16} aria-hidden="true" /> Customers who respond best</>}>
          <div className={s.hint}>
            <span className={s.hintBig}>{hints.topSegment.name}</span>
            <span className={s.hintText}>{hints.topSegment.note.replace(/\s*\u2014\s*/g, ". ")}</span>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---- campaign report cards ---- */

function gradeClass(g: string) {
  return g === "A" || g === "B" ? s.gGood : g === "C" || g === "D" ? s.gMid : s.gBad;
}

function CampaignCards({ cards }: { cards: CampCard[] }) {
  const real = cards.filter((x) => !isTestCampaign(x));
  const tests = cards.filter(isTestCampaign);
  return (
    <Card title={<><Megaphone size={16} aria-hidden="true" /> Campaign report cards</>} basis={`graded A to F once ${MIN_SENDS_TO_GRADE}+ people got it`}>
      {real.length === 0 ? (
        <div className={s.empty}>No real campaigns in this period yet.</div>
      ) : (
        <div className={s.cards}>
          {real.map((x) => {
            const graded = canGrade(x);
            return (
              <div key={x.id} className={s.camp}>
                <div className={s.campHead}>
                  <Link href={`/dashboard/whatsapp/campaigns/${x.id}`} className={s.campName}>{x.name}</Link>
                  {graded ? (
                    <span className={`${s.grade} ${gradeClass(x.grade)}`} aria-label={`Grade ${x.grade}`}>{x.grade}</span>
                  ) : (
                    <span className="pm2-pill neu plain">Too early to grade</span>
                  )}
                </div>
                <p className={s.verdict}>
                  {graded ? x.verdict.replace(/\s*\u2014\s*/g, ". ") : `Only ${num(x.sent)} people so far. We grade once at least ${MIN_SENDS_TO_GRADE} have got it.`}
                </p>
                <div className={s.minis}>
                  <Mini label="Sent" value={num(x.sent)} />
                  <Mini label={<GlossaryTerm k="read" />} value={`${x.readPct}%`} />
                  <Mini label="Orders" value={num(x.orders)} />
                  <Mini label="Revenue" value={inr(x.revenue)} />
                  <Mini label="Cost" value={inr(x.cost)} />
                  <Mini
                    label={<>Est. return <HelpTip term="attributed_order" text="Counts orders placed within 7 days by people who received this campaign, divided by its estimated Meta cost." /></>}
                    value={x.roi != null ? `${x.roi.toFixed(1)}x` : "Not yet"}
                    bad={x.roi != null && x.roi < 1}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {tests.length > 0 && (
        <div className={s.tests}>
          <span>Tests (not graded, not counted):</span>
          {tests.map((x) => (
            <Link key={x.id} href={`/dashboard/whatsapp/campaigns/${x.id}`}>{x.name}</Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function Mini({ label, value, bad }: { label: React.ReactNode; value: string; bad?: boolean }) {
  return (
    <div>
      <div className={s.miniL}>{label}</div>
      <div className={`${s.miniV} ${bad ? s.miniBad : ""}`}>{value}</div>
    </div>
  );
}

function deliveredVerdict(pct: number) {
  if (pct >= 85) return "Most messages arrive. Good.";
  if (pct >= 60) return "Some not arriving. Check below.";
  return "Many not arriving. See below.";
}
function readVerdict(pct: number) {
  if (pct >= 50) return "Strong. People open them.";
  if (pct >= 25) return "Average. Try a better first line.";
  return "Low. Copy or timing needs work.";
}
function roiVerdict(roi: number | null) {
  if (roi == null) return "No cost recorded yet.";
  if (roi >= 3) return "Each ₹1 spent brings back well.";
  if (roi >= 1) return "Earning back what it costs.";
  return "Costing more than it brings in.";
}

/* ---- journey funnel ---- */

const FUNNEL_WORD: Record<string, string> = {
  delivered: "arrived", read: "were read", replied: "got a reply", bought: "ordered", clicked: "were tapped",
};

function funnelLabel(f: Funnel) {
  if (f.key === "delivered") return <GlossaryTerm k="delivered" />;
  if (f.key === "read") return <GlossaryTerm k="read" />;
  if (f.key === "replied") return <GlossaryTerm k="reply">Replies received</GlossaryTerm>;
  if (f.key === "clicked") return <GlossaryTerm k="click">Link taps</GlossaryTerm>;
  return f.label;
}

function FunnelPanel({ d }: { d: Data }) {
  const sent = d.headline.sent || 1;
  return (
    <Card title="From message to order" basis="how many people move on at each step">
      {d.funnel.map((f, i) => {
        const width = f.count == null ? 0 : Math.max(2, Math.round((f.count / sent) * 100));
        const prev = i > 0 ? d.funnel[i - 1] : null;
        const rate = prev && prev.count && f.count != null ? inHundred(f.count, prev.count) : null;
        return (
          <div key={f.key} className={s.funnelRow}>
            <div className={s.funnelTop}>
              <span className={s.funnelName}>{funnelLabel(f)}{f.soon && " (coming soon)"}</span>
              <span className={s.funnelVal}>
                {f.count == null ? "Not yet" : `${num(f.count)} ${f.unit}`}
                {rate != null && prev && (
                  <span className={s.funnelRate}> · {rate} in 100 {FUNNEL_WORD[f.key] ?? "moved on"}</span>
                )}
              </span>
            </div>
            <div className={s.bar}>
              <span className={`${s.barFill} ${f.soon ? s.barSoon : ""}`} style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </Card>
  );
}

/* ---- messages that did not arrive ---- */

function FailurePanel({ d, attempted }: { d: Data; attempted: number }) {
  const f = d.failures;
  return (
    <Card
      title={<><AlertTriangle size={16} aria-hidden="true" /> Messages that did not arrive</>}
      basis={f.total ? `${num(f.total)} of ${num(attempted)}` : "none this period"}
    >
      {f.total === 0 ? (
        <div className={s.empty}>Every message went through. Nothing to fix.</div>
      ) : (
        <div>
          {f.groups.map((g) => {
            const txt = FAIL_TEXT[g.category];
            return (
              <div key={g.category} className={s.fail}>
                <span className={s.failTitle}>
                  {txt?.title ?? g.title}
                  {txt?.heldBack && <HelpTip term="held_back" />}
                  <span className={s.failCount}>· {num(g.count)}</span>
                </span>
                <span className={`pm2-pill ${g.willRetry ? "info" : g.tone === "r" ? "crit" : "neu"}`}>
                  {g.willRetry ? "Tries again by itself" : g.tone === "r" ? "Needs fixing" : "Normal, no retry"}
                </span>
                <span className={s.failSub}>{(txt?.action ?? g.action).replace(/\s*\u2014\s*/g, ". ")}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
