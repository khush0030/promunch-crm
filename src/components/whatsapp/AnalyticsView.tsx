"use client";

// Results tab: WhatsApp numbers written for a marketing teammate, not an
// engineer. It leads with plain sentences, explains every word on hover, never
// grades a campaign that is too small (or an internal test) to judge, and
// calls Meta's #131049 hold-backs what they are: normal, not our fault.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clock, CornerUpLeft, Megaphone, RefreshCw, ShoppingBag, Users } from "lucide-react";
import { Kpi, KpiStrip } from "@/components/pm";
import { GlossaryTerm, HelpTip } from "@/components/guide";
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
        <p className={s.intro}>Every rupee WhatsApp brought in, from campaigns and automations.</p>
        <div className={s.toolbarActs}>
          <div className="pm2-seg" role="group" aria-label="Period">
            {WINDOWS.map((w) => (
              <button key={w} type="button" className={days === w ? "on" : ""} aria-pressed={days === w} onClick={() => setDays(w)}>
                {w} days
              </button>
            ))}
          </div>
          <button type="button" className={s.iconBtn} onClick={load} disabled={loading} aria-label={loading ? "Refreshing" : "Refresh"} title="Refresh">
            <RefreshCw aria-hidden="true" className={loading ? s.spin : undefined} />
          </button>
        </div>
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

      <p className={s.headline}>
        {h.orders > 0 ? (
          <>WhatsApp brought in <b>{inr(h.revenue)}</b> from {num(h.orders)} order{h.orders === 1 ? "" : "s"} in the last {days} days.</>
        ) : (
          <>No orders came from people we messaged in the last {days} days yet.</>
        )}{" "}
        <span className={s.healthLine}>
          <span className={`pm2-pill ${d.health.tone === "g" ? "good" : d.health.tone === "a" ? "warn" : "crit"}`}>{d.health.label}</span>
          <span>{healthNote}</span>
        </span>
      </p>

      <KpiStrip>
        <Kpi label="Revenue" value={<span className={s.red}>{inr(h.revenue)}</span>} sub={`${num(h.orders)} orders after a message`} />
        <Kpi label="Messages sent" value={num(h.sent)} sub={`${h.deliveredPct}% delivered · ${num(d.today.sent)} today`} />
        <Kpi label={<span className={s.kpiLabel}><GlossaryTerm k="read">Read rate</GlossaryTerm></span>} value={`${h.readPct}%`} sub={readVerdict(h.readPct)} />
        <Kpi
          label={
            <span className={s.kpiLabel}>
              Cost to Meta
              <HelpTip term="attributed_order" text="Estimated Meta charges. The return counts orders placed in this period by people who got a WhatsApp message from us before ordering, divided by this cost. A strong signal, not proof." />
            </span>
          }
          value={inr(h.spend)}
          sub={h.roi != null ? `₹${h.roi >= 10 ? Math.round(h.roi) : h.roi.toFixed(1)} back for every ₹1` : roiVerdict(h.roi)}
        />
      </KpiStrip>

      <details className={s.words}>
        <summary>Last {days} days in plain words</summary>
        <ul>{sentences.map((t, i) => <li key={i}>{t}</li>)}</ul>
        {conv && (
          <p className={s.note}>
            &ldquo;Orders after a message&rdquo; is a broad measure. &ldquo;Orders from WhatsApp links&rdquo; below is the strict one: only
            orders where the customer tapped a WhatsApp link and then bought.
          </p>
        )}
      </details>

      <div className={s.g2}>
        <FunnelPanel d={d} />
        <FailurePanel d={d} attempted={attempted} />
      </div>

      {c?.hints && (c.hints.bestTime || c.hints.topSegment) && <HintsRow hints={c.hints} />}

      {c && c.campaigns.length > 0 && <CampaignCards cards={c.campaigns} />}
      {conv && <ConversionPanel conv={conv} />}
      {act.length > 0 && <ActivityFeed items={act} />}
    </>
  );
}

/* ---- a calm panel: title, one-line takeaway, then the detail ---- */

function Panel({ title, takeaway, aside, children, flush }: {
  title: string; takeaway: React.ReactNode; aside?: React.ReactNode; children?: React.ReactNode; flush?: boolean;
}) {
  return (
    <section className={`${s.panel} ${flush ? s.panelFlush : ""}`}>
      <div className={s.panelHead}>
        <div className={s.panelHeadText}>
          <h3 className={s.panelTitle}>{title}</h3>
          <p className={s.take}>{takeaway}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/* ---- orders from tagged links ---- */

function ConversionPanel({ conv }: { conv: ConvData }) {
  const t = conv.totals;
  const top = [...conv.rows].sort((a, b) => b.revenue - a.revenue)[0];
  return (
    <Panel
      title="Orders from WhatsApp links"
      takeaway={
        conv.rows.length === 0
          ? "No orders from WhatsApp links yet. They show up once customers tap a link and buy."
          : <><b>{num(t.orders)} order{t.orders === 1 ? "" : "s"} ({inr(t.revenue)})</b> came straight from a tapped link{top ? `, most from "${top.campaign}".` : "."}</>
      }
      flush={conv.rows.length > 0}
    >
      {conv.rows.length > 0 && (
        <table className={s.tbl}>
          <thead>
            <tr><th scope="col">Campaign</th><th scope="col">Via</th><th scope="col" className={s.r}>Orders</th><th scope="col" className={s.r}>Revenue</th></tr>
          </thead>
          <tbody>
            {conv.rows.map((r) => (
              <tr key={r.campaign}>
                <td className={s.mainCell}><b>{r.campaign}</b></td>
                <td data-l="Via" className={s.dim}>{r.medium}</td>
                <td data-l="Orders" className={s.r}>{num(r.orders)}</td>
                <td data-l="Revenue" className={s.r}><b>{inr(r.revenue)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
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
  const replies = items.filter((x) => x.type === "reply").length;
  const orders = items.filter((x) => x.type === "order").length;
  const latest = items[0];
  return (
    <Panel
      title="Live activity"
      takeaway={
        <>
          Latest {num(items.length)}: {num(replies)} repl{replies === 1 ? "y" : "ies"}, {num(orders)} order{orders === 1 ? "" : "s"}
          {latest ? `. Newest ${timeAgo(latest.at)}.` : "."}
        </>
      }
    >
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
          Show {Math.min(ACTIVITY_STEP, items.length - shown)} more
        </button>
      )}
    </Panel>
  );
}

/* ---- hints ---- */

// API notes can carry em dashes and lower-case sentence starts.
function sentenceCase(t: string): string {
  return t.replace(/\s*\u2014\s*/g, ". ").replace(/(^|[.!?]\s+)([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

function HintsRow({ hints }: { hints: Hints }) {
  return (
    <div className={s.g2}>
      {hints.bestTime && (
        <Panel title="Best time to send" takeaway={sentenceCase(hints.bestTime.note)}>
          <div className={s.hint}>
            <Clock aria-hidden="true" />
            <span className={s.hintBig}>{hints.bestTime.label.replace(/\u2013|\u2014/g, " to ")}</span>
          </div>
        </Panel>
      )}
      {hints.topSegment && (
        <Panel title="Customers who respond best" takeaway={sentenceCase(hints.topSegment.note)}>
          <div className={s.hint}>
            <Users aria-hidden="true" />
            <span className={s.hintBig}>{hints.topSegment.name}</span>
          </div>
        </Panel>
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
  const best = [...real].sort((a, b) => b.revenue - a.revenue)[0];
  const takeaway =
    real.length === 0
      ? "No real campaigns in this period yet. Tests are listed below and never graded."
      : best && best.revenue > 0
      ? <>&ldquo;{best.name}&rdquo; earned the most: <b>{inr(best.revenue)}</b> from {num(best.orders)} order{best.orders === 1 ? "" : "s"}.</>
      : `${num(real.length)} campaign${real.length === 1 ? "" : "s"} this period, no orders from them yet.`;
  return (
    <Panel title="Campaign report cards" takeaway={takeaway} flush={real.length > 0}>
      {real.length > 0 && (
        <table className={s.tbl}>
          <thead>
            <tr>
              <th scope="col">Campaign</th>
              <th scope="col" className={s.r}><GlossaryTerm k="read">Read</GlossaryTerm></th>
              <th scope="col" className={s.r}>Orders</th>
              <th scope="col" className={s.r}>Revenue</th>
              <th scope="col" className={s.r}>
                <span className={s.kpiLabel}>Return <HelpTip term="attributed_order" text="Counts orders placed within 7 days by people who received this campaign, divided by its estimated Meta cost." /></span>
              </th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {real.map((x) => {
              const graded = canGrade(x);
              return (
                <tr key={x.id}>
                  <td className={s.mainCell}>
                    <Link href={`/dashboard/whatsapp/campaigns/${x.id}`} className={s.campName}>{x.name}</Link>
                    <span className={s.sub}>{num(x.sent)} people · {inr(x.cost)} cost</span>
                  </td>
                  <td data-l="Read" className={s.r}>{x.readPct}%</td>
                  <td data-l="Orders" className={s.r}>{num(x.orders)}</td>
                  <td data-l="Revenue" className={s.r}><b>{inr(x.revenue)}</b></td>
                  <td data-l="Return" className={`${s.r} ${x.roi != null && x.roi < 1 ? s.bad : ""}`}>
                    <b>{x.roi != null ? `${x.roi >= 10 ? Math.round(x.roi) : x.roi.toFixed(1)}×` : "Not yet"}</b>
                  </td>
                  <td data-l="Verdict" className={s.verdictCell}>
                    {graded ? (
                      <>
                        <span className={`${s.grade} ${gradeClass(x.grade)}`}>Grade {x.grade}</span>
                        <span className={s.sub}>{x.verdict.replace(/\s*\u2014\s*/g, ". ")}</span>
                      </>
                    ) : (
                      <>
                        <span className={`${s.grade} ${s.gNeu}`}>Too early</span>
                        <span className={s.sub}>Graded once {MIN_SENDS_TO_GRADE}+ people get it.</span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {tests.length > 0 && (
        <div className={s.tests}>
          <span>Tests (not graded, not counted):</span>
          {tests.map((x) => (
            <Link key={x.id} href={`/dashboard/whatsapp/campaigns/${x.id}`}>{x.name}</Link>
          ))}
        </div>
      )}
    </Panel>
  );
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

function funnelTakeaway(d: Data): string {
  const sent = d.headline.sent;
  if (!sent) return "Nothing went out in this period.";
  const read = inHundred(d.headline.read, sent) ?? 0;
  const bought = inHundred(d.headline.orders, sent);
  return bought != null && d.headline.orders > 0
    ? `Out of every 100 messages, ${read} were read and ${bought || "under 1"} led to an order.`
    : `Out of every 100 messages, ${read} were read. No orders yet.`;
}

function FunnelPanel({ d }: { d: Data }) {
  const sent = d.headline.sent || 1;
  return (
    <Panel title="From message to order" takeaway={funnelTakeaway(d)}>
      <div className={s.funnel}>
        {d.funnel.map((f, i) => {
          const width = f.count == null ? 0 : Math.max(1.5, Math.round((f.count / sent) * 100));
          const prev = i > 0 ? d.funnel[i - 1] : null;
          const rate = prev && prev.count && f.count != null ? inHundred(f.count, prev.count) : null;
          return (
            <div key={f.key} className={s.funnelRow}>
              <div className={s.funnelTop}>
                <span className={s.funnelName}>{funnelLabel(f)}{f.soon && " (coming soon)"}</span>
                <span className={s.funnelVal}>{f.count == null ? "Not yet" : num(f.count)}</span>
              </div>
              <div className={s.bar}>
                <span className={`${s.barFill} ${s[`step${Math.min(i, 4)}`]} ${f.soon ? s.barSoon : ""}`} style={{ width: `${width}%` }} />
              </div>
              {rate != null && prev && <span className={s.funnelRate}>{rate} in 100 {FUNNEL_WORD[f.key] ?? "moved on"}</span>}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ---- messages that did not arrive ---- */

function FailurePanel({ d, attempted }: { d: Data; attempted: number }) {
  const f = d.failures;
  const needFix = f.groups.filter((g) => !g.willRetry && g.tone === "r").reduce((a, g) => a + g.count, 0);
  const takeaway =
    f.total === 0
      ? "Every message went through. Nothing to fix."
      : needFix > 0
      ? `${num(f.total)} of ${num(attempted)} did not arrive. ${num(needFix)} need fixing.`
      : `${num(f.total)} of ${num(attempted)} did not arrive. All normal, nothing to fix.`;
  return (
    <Panel title="Messages that did not arrive" takeaway={takeaway}>
      {f.total > 0 && (
        <div>
          {f.groups.map((g) => {
            const txt = FAIL_TEXT[g.category];
            return (
              <div key={g.category} className={s.fail}>
                <span className={s.failTitle}>
                  {txt?.title ?? g.title}
                  {txt?.heldBack && <HelpTip term="held_back" />}
                </span>
                <span className={s.failCount}>{num(g.count)}</span>
                <span className={`pm2-pill ${g.willRetry ? "info" : g.tone === "r" ? "crit" : "neu"} ${s.failPill}`}>
                  {g.willRetry ? "Tries again by itself" : g.tone === "r" ? "Needs fixing" : "Normal, no retry"}
                </span>
                <span className={s.failSub}>{(txt?.action ?? g.action).replace(/\s*\u2014\s*/g, ". ")}</span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
