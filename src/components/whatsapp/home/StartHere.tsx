"use client";

// WhatsApp overview ("Start here", ?tab=home). Leads with money: what
// WhatsApp made, a campaign return block (revenue, link taps, orders, Meta
// cost, return multiple, colour-coded funnel) for any campaign you pick, and
// every recent campaign with its return. Only figures the data really has.
// The beginner checklist, the five words and the explainer sit underneath.
// Read-only: every request here is a GET.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, CalendarClock, ChevronRight, PencilLine, Plus } from "lucide-react";
import { Kpi, KpiStrip } from "@/components/pm";
import { GLOSSARY, GlossaryTerm, GuideChecklist, type GlossaryKey, type GuideChecklistItem } from "@/components/guide";
import { request, useApprovedTemplates, useCampaignAnalytics, useCampaigns, useQuota, type AnalyticsCard } from "../campaigns/api";
import { campaignTemplates } from "../campaigns/logic";
import { campaignHref } from "../campaigns/useCampaignActions";
import { useNow } from "../campaigns/useNow";
import { NEW_TEMPLATE_HREF } from "../campaigns/wizard/StepTemplate";
import { isTestCampaign } from "../results/logic";
import type { Campaign } from "../types";
import { avgOrder, campaignFunnel, returnMultiple, returnTone } from "./summary";
import { useWaHealth } from "./useHealth";
import { FLOWS_VISITED_KEY, GLOSSARY_SEEN_KEY, useLocalFlag } from "./useLocalFlag";
import { WaHeader } from "../WaHeader";
import h from "./home.module.css";

export const NEW_CAMPAIGN_HREF = "/dashboard/whatsapp/campaigns/new";
export const FLOWS_HREF = "/dashboard/whatsapp?tab=flows";
const RESULTS_HREF = "/dashboard/whatsapp?tab=analytics";
const CAMPAIGNS_HREF = "/dashboard/whatsapp?tab=campaigns";

// Orders count for a campaign when the same phone buys within 7 days.
const ATTRIBUTION_DAYS = 7;

const FIRST_WORDS: GlossaryKey[] = ["template", "marketing", "opted_in", "held_back", "warm_audience"];
const ALL_WORDS = Object.keys(GLOSSARY) as GlossaryKey[];

const inr = (v: number) => "₹" + Math.round(v).toLocaleString("en-IN");
const int = (v: number | null | undefined) => Math.round(Number(v ?? 0)).toLocaleString("en-IN");
const when = (c: Pick<Campaign, "started_at" | "created_at">) => c.started_at ?? c.created_at;
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

type Headline = { headline?: { revenue: number; orders: number; readPct: number; sent: number } };

// Same read-only endpoint the Results tab uses, for the 30-day headline.
function useHeadline30() {
  return useQuery({
    queryKey: ["wa-analytics-headline", 30],
    queryFn: () => request<Headline>("/api/whatsapp/analytics?days=30"),
    staleTime: 5 * 60_000,
  });
}

export default function StartHere() {
  const campaigns = useCampaigns();
  const list = useMemo(() => campaigns.data ?? [], [campaigns.data]);
  const sent = useMemo(
    () => list.filter((c) => (c.sent_count ?? 0) > 0).sort((a, b) => Date.parse(when(b)) - Date.parse(when(a))),
    [list],
  );
  const analytics = useCampaignAnalytics(365, sent.length > 0);
  const cardById = useMemo(() => new Map((analytics.data?.campaigns ?? []).map((a) => [a.id, a] as const)), [analytics.data]);
  const headline = useHeadline30();
  const quota = useQuota();

  const h30 = headline.data?.headline;
  const remaining = quota.data?.remaining;
  const real = sent.filter((c) => !isTestCampaign({ name: c.name, sent: c.sent_count ?? 0 }));

  return (
    <div className={h.page}>
      <WaHeader
        title="WhatsApp"
        summary={
          <>
            {h30 && h30.orders > 0 ? (
              <>WhatsApp made <b>{inr(h30.revenue)}</b> in the last 30 days.</>
            ) : h30 ? (
              <>No orders from WhatsApp messages in the last 30 days yet.</>
            ) : (
              <>Send offers and news to PROMUNCH customers on WhatsApp.</>
            )}
            {remaining != null && (
              <> You can send <b>{int(remaining)} marketing {remaining === 1 ? "message" : "messages"}</b> today.</>
            )}
          </>
        }
        actions={
          <>
            <Link href={NEW_TEMPLATE_HREF} className={`pm2-btn ${h.hideM}`}>New template</Link>
            <Link href={NEW_CAMPAIGN_HREF} className="pm2-btn pri">
              <Plus aria-hidden /> New campaign
            </Link>
          </>
        }
      />
      <KpiStrip cols={3}>
        <Kpi
          label="Revenue · 30 days"
          value={h30 ? inr(h30.revenue) : "…"}
          sub={h30 ? `${int(h30.orders)} ${h30.orders === 1 ? "order" : "orders"} after a message` : "Loading"}
        />
        <Kpi label="Read rate" value={h30 ? `${h30.readPct}%` : "…"} sub={h30 ? `of ${int(h30.sent)} messages sent` : "Loading"} />
        {remaining != null || !quota.data ? (
          <Kpi
            label="Can send today"
            value={remaining != null ? int(remaining) : "…"}
            sub={quota.data?.limit != null ? `of ${int(quota.data.limit)} a day, Meta's marketing limit` : "Meta's daily marketing limit"}
          />
        ) : (
          <Kpi
            label="People messaged · last 24 hours"
            value={int(quota.data.used24h)}
            sub={quota.data.standing_error ? "Couldn't read the daily limit. Meta still holds back extras." : "No daily limit set. Meta still holds back extras."}
          />
        )}
      </KpiStrip>

      {sent.length > 0 && (
        <CampaignReturn
          campaigns={real.length ? real : sent}
          cardById={cardById}
          loading={analytics.isLoading}
        />
      )}

      {sent.length > 0 && <CampaignList campaigns={(real.length ? real : sent).slice(0, 6)} cardById={cardById} />}

      <ComingUp campaigns={list} />

      <GettingStarted />

      <details className={h.explainer}>
        <summary>
          <BookOpen size={16} aria-hidden /> How WhatsApp marketing works here
        </summary>
        <ol className={h.explainList}>
          <li>
            <b>Templates need Meta&apos;s approval.</b> You write a message once as a <GlossaryTerm k="template">template</GlossaryTerm>.
            Meta checks it, usually within minutes to a few hours. Only approved templates can start a chat.
          </li>
          <li>
            <b>A campaign sends a template to an audience.</b> You choose who gets it, fill in the blanks (like the offer or the picture) and
            pick when it goes out.
          </li>
          <li>
            <b>Follow-ups go out later, by themselves.</b> Add a <GlossaryTerm k="followup">follow-up</GlossaryTerm> to any campaign, for
            example 2 days after each person gets it, only to the people who read it. A campaign with its follow-ups is a{" "}
            <GlossaryTerm k="journey">journey</GlossaryTerm>.
          </li>
          <li>
            <b>At most 1 marketing message per person per day, never at night.</b> This is our <GlossaryTerm k="fair_use">fair use</GlossaryTerm>{" "}
            rule. <GlossaryTerm k="quiet_hours">Quiet hours</GlossaryTerm> are 9 PM to 9 AM India time; anything due then waits for the
            morning. Big lists go out over a few days by themselves.
          </li>
          <li>
            <b>Meta holds back messages to people who don&apos;t engage.</b> Every WhatsApp user only gets a few marketing messages a day from
            all businesses, and Meta gives them to businesses people talk to. Those that don&apos;t make it are{" "}
            <GlossaryTerm k="held_back">held back</GlossaryTerm> (free, not a fault). That is why a{" "}
            <GlossaryTerm k="warm_audience">Warm</GlossaryTerm> audience works best.
          </li>
        </ol>
      </details>

      <p className={h.foot}>
        An order counts for a campaign when the same phone buys within {ATTRIBUTION_DAYS} days of getting it. Link taps come from the tagged
        link in the message.
      </p>
    </div>
  );
}

/* ---------------- campaign return block ---------------- */

function CampaignReturn({
  campaigns,
  cardById,
  loading,
}: {
  campaigns: Campaign[];
  cardById: Map<string, AnalyticsCard>;
  loading: boolean;
}) {
  const now = useNow(60_000);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const c = campaigns.find((x) => x.id === pickedId) ?? campaigns[0];
  const card = cardById.get(c.id) ?? null;
  const orders = card?.orders ?? null;
  const ageDays = Math.max(1, Math.ceil((now - Date.parse(when(c))) / 86_400_000));
  const counting = c.status === "sending" || ageDays <= ATTRIBUTION_DAYS;
  const multiple = returnMultiple(card?.roi);
  const tone = returnTone(card?.roi);
  const avg = card ? avgOrder(card) : null;
  const funnel = campaignFunnel(c, orders);
  const roi = card?.roi;
  // "…" only while the numbers load; a campaign with no numbers shows a dash.
  const wait = loading && !card ? "…" : "–";

  return (
    <section className={h.card} aria-labelledby="wa-roi-title">
      <div className={h.crHead}>
        <div className={h.crTitle}>
          <span className={h.eyebrow} id="wa-roi-title">Campaign results</span>
          <label className={h.pick}>
            <span className="pm2-sr">Pick a campaign</span>
            <select value={c.id} onChange={(e) => setPickedId(e.target.value)}>
              {campaigns.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {shortDate(when(x))}
                </option>
              ))}
            </select>
          </label>
          <p className={h.crMeta}>
            <span className={`pm2-pill ${counting ? "good" : "neu"}`}>
              {c.status === "sending"
                ? "Still sending"
                : counting
                ? `Counting orders · day ${Math.min(ageDays, ATTRIBUTION_DAYS)} of ${ATTRIBUTION_DAYS}`
                : "Final numbers"}
            </span>
            <span>
              Sent {shortDate(when(c))} to {int(c.sent_count)} {c.sent_count === 1 ? "person" : "people"}
            </span>
          </p>
        </div>
        <Link href={campaignHref(c.id)} className={h.txtLink}>
          Full report <ArrowRight aria-hidden />
        </Link>
      </div>

      <div className={h.crHero}>
        <div className={h.crMain}>
          <span className={h.crL}>Revenue</span>
          <b className={h.crBig}>{card ? inr(card.revenue) : wait}</b>
          <span className={h.crS}>
            {!card
              ? loading ? "Counting orders" : "No order numbers for this one"
              : card.orders > 0
              ? `from ${int(card.orders)} ${card.orders === 1 ? "order" : "orders"}${avg != null ? ` · avg ${inr(avg)}` : ""}`
              : "No orders yet"}
          </span>
        </div>
        <div className={`${h.crRoi} ${h[`tone_${tone}`]}`}>
          <b className={multiple ? undefined : h.crRoiNone}>{multiple ?? (loading && !card ? "…" : "Not yet")}</b>
          <span>
            {loading && !card
              ? "return · counting"
              : roi === 0
              ? "return · no orders from it yet"
              : roi != null && multiple
              ? `return · ₹${roi >= 10 ? Math.round(roi) : roi.toFixed(1)} for every ₹1 spent`
              : "return · no Meta cost recorded yet"}
          </span>
        </div>
      </div>

      <dl className={h.statline}>
        {c.clicked_count != null && (
          <div>
            <dt>link taps</dt>
            <dd>{int(c.clicked_count)}</dd>
          </div>
        )}
        <div>
          <dt>orders</dt>
          <dd>{card ? int(card.orders) : wait}</dd>
        </div>
        <div>
          <dt>Meta cost</dt>
          <dd>{card ? inr(card.cost) : wait}</dd>
        </div>
        <div>
          <dt>read</dt>
          <dd>{int(c.read_count)}</dd>
        </div>
      </dl>

      <div className={h.funnelWrap}>
        <h3 className={h.h3}>From message to purchase</h3>
        <p className={h.take}>
          {funnel[0].count > 0
            ? `Out of ${int(funnel[0].count)} people who got it, ${funnel[1].pct}% read it${orders != null ? ` and ${int(orders)} bought` : ""}.`
            : "Nobody has got it yet."}
        </p>
        <ol className={h.fun}>
          {funnel.map((f, i) => {
            const prev = funnel[i - 1];
            const step = prev && prev.count > 0 ? Math.round((f.count / prev.count) * 100) : null;
            return (
              <li key={f.key} className={h[`f_${f.key}`]}>
                {step != null && <span className={h.fDrop}>{step}% of the step before</span>}
                <div className={h.fTop}>
                  <span className={h.fL}>{f.label}</span>
                  <b>{int(f.count)}</b>
                  <em>{f.pct}%</em>
                </div>
                <div className={h.fBar}>
                  <i style={{ width: `${Math.max(f.count > 0 ? 1.5 : 0, Math.min(100, f.pct))}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* ---------------- recent campaigns ---------------- */

function CampaignList({ campaigns, cardById }: { campaigns: Campaign[]; cardById: Map<string, AnalyticsCard> }) {
  return (
    <section className={h.card} aria-labelledby="wa-list-title">
      <div className={h.secT}>
        <h3 className={h.h3} id="wa-list-title">Recent campaigns</h3>
        <Link href={RESULTS_HREF} className={h.txtLink}>
          All results <ArrowRight aria-hidden />
        </Link>
      </div>
      <div className={h.campList}>
        {campaigns.map((c) => {
          const card = cardById.get(c.id);
          const multiple = returnMultiple(card?.roi);
          const parts = [
            c.clicked_count != null ? `${int(c.clicked_count)} link taps` : null,
            card ? `${int(card.orders)} ${card.orders === 1 ? "order" : "orders"}` : null,
          ].filter(Boolean);
          return (
            <Link key={c.id} href={campaignHref(c.id)} className={h.cl}>
              <span className={h.clM}>
                <b>{c.name}</b>
                <span>
                  {shortDate(when(c))} · {int(c.sent_count)} {c.sent_count === 1 ? "person" : "people"}
                </span>
                <span className={h.clF}>
                  {parts.join(" · ")}
                  {card && (
                    <>
                      {parts.length ? " · " : ""}
                      <strong>{inr(card.revenue)}</strong>
                    </>
                  )}
                </span>
              </span>
              <span className={`${h.clRoi} ${h[`tone_${returnTone(card?.roi)}`]}`}>
                <b>{multiple ?? "–"}</b>
                <span>return</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- scheduled + drafts ---------------- */

function ComingUp({ campaigns }: { campaigns: Campaign[] }) {
  const items = campaigns
    .filter((c) => c.status === "scheduled" || c.status === "draft")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "scheduled" ? -1 : 1;
      return Date.parse(a.scheduled_at ?? a.created_at) - Date.parse(b.scheduled_at ?? b.created_at);
    })
    .slice(0, 4);
  if (!items.length) return null;
  return (
    <section className={h.card} aria-labelledby="wa-up-title">
      <div className={h.secT}>
        <h3 className={h.h3} id="wa-up-title">Coming up</h3>
        <Link href={CAMPAIGNS_HREF} className={h.txtLink}>
          All campaigns <ArrowRight aria-hidden />
        </Link>
      </div>
      <div className={h.campList}>
        {items.map((c) => {
          const at = c.scheduled_at ? new Date(c.scheduled_at) : null;
          return (
            <Link key={c.id} href={campaignHref(c.id)} className={h.cl}>
              <span className={h.upD} aria-hidden>
                {at && c.status === "scheduled" ? (
                  <>
                    <span>{at.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short" })}</span>
                    <b>{at.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric" })}</b>
                  </>
                ) : c.status === "scheduled" ? (
                  <CalendarClock />
                ) : (
                  <PencilLine />
                )}
              </span>
              <span className={h.clM}>
                <b>{c.name}</b>
                {c.status === "scheduled" ? (
                  <span className="pm2-pill info">
                    Scheduled
                    {at
                      ? ` · ${at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`
                      : ""}
                  </span>
                ) : (
                  <span className="pm2-pill neu">Draft · no send time yet</span>
                )}
              </span>
              <ChevronRight aria-hidden className={h.chev} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- beginner checklist + words ---------------- */

function GettingStarted() {
  const health = useWaHealth();
  const templates = useApprovedTemplates();
  const campaigns = useCampaigns();
  const [flowsSeen, markFlows] = useLocalFlag(FLOWS_VISITED_KEY);
  const [wordsSeen, markWords] = useLocalFlag(GLOSSARY_SEEN_KEY);
  const [wordsOpen, setWordsOpen] = useState(false);

  const marketingTemplates = useMemo(() => campaignTemplates(templates.data ?? []), [templates.data]);
  const sentOne = (campaigns.data ?? []).some((c) => (c.sent_count ?? 0) > 0 || c.status === "sending" || c.status === "completed");

  function openWords() {
    setWordsOpen(true);
    markWords();
  }

  const items: GuideChecklistItem[] = [
    {
      key: "connected",
      label: "WhatsApp is connected",
      done: health.data?.status === "up",
      help: health.isLoading
        ? "Checking the connection…"
        : "We couldn't confirm the WhatsApp connection just now. It usually fixes itself within minutes. If this stays unticked for more than an hour, tell the owner.",
    },
    {
      key: "template",
      label: "You have an approved marketing template",
      done: marketingTemplates.length > 0,
      help: (
        <>
          A <GlossaryTerm k="template">template</GlossaryTerm> is your message, written once and checked by Meta. You need one approved{" "}
          <GlossaryTerm k="marketing">marketing</GlossaryTerm> template before you can send a campaign. Approval usually takes minutes to a few
          hours.
        </>
      ),
      cta: { label: "Create a template", href: NEW_TEMPLATE_HREF },
    },
    {
      key: "campaign",
      label: "Send your first campaign",
      done: sentOne,
      help: "Pick your approved message, choose who gets it (Warm is the safe choice), send yourself a test, then launch. The steps explain everything as you go.",
      cta: { label: "Start a campaign", href: NEW_CAMPAIGN_HREF },
    },
    {
      key: "flows",
      label: "Review your automations",
      done: flowsSeen,
      help: (
        <>
          <GlossaryTerm k="automation">Automations</GlossaryTerm>{" "}send by themselves when something happens, like a cart reminder after
          someone leaves the shop. Have a look at what is already running so your campaigns don&apos;t clash with them.
        </>
      ),
      cta: { label: "Open Automations", href: FLOWS_HREF, onClick: markFlows },
    },
    {
      key: "words",
      label: "Learn the 5 words you'll see",
      done: wordsSeen,
      help: "Template, marketing message, opted in, held back and Warm. Two minutes, and every screen here will make sense.",
      cta: { label: "Show me the words", onClick: openWords },
    },
  ];

  return (
    <>
      <div className={h.checklist}>
        <GuideChecklist id="wa-getting-started" title="Getting started" subtitle="Tick these off once and you're set." items={items} dismissible />
      </div>
      {wordsOpen && <WordsPanel onClose={() => setWordsOpen(false)} />}
    </>
  );
}

function WordsPanel({ onClose }: { onClose: () => void }) {
  const [all, setAll] = useState(false);
  const keys = all ? ALL_WORDS : FIRST_WORDS;
  return (
    <section className={h.words} aria-labelledby="wa-words-title">
      <div className={h.wordsHead}>
        <h3 id="wa-words-title" className={h.sectionTitle}>{all ? "Every word, in plain English" : "The 5 words you'll see most"}</h3>
        <button type="button" className="pm2-btn sm" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className={h.wordsList}>
        {keys.map((k) => {
          const g = GLOSSARY[k];
          return (
            <div key={k} className={h.word}>
              <dt>{g.term}</dt>
              <dd>
                {g.plain}
                {g.customerEffect && (
                  <span className={h.wordCustomer}>
                    <b>For the customer:</b> {g.customerEffect}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <button type="button" className="pm2-btn sm ghost" onClick={() => setAll((a) => !a)}>
        {all ? "Show just the 5" : `Show all ${ALL_WORDS.length} words`}
      </button>
    </section>
  );
}
