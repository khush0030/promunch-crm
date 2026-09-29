"use client";

// "Start here": the landing tab of WhatsApp marketing, written for someone who
// has never sent a WhatsApp campaign. A setup checklist computed from real
// data, three big "what do you want to do" cards, a plain recap of the last
// campaign, and a short explainer of how WhatsApp marketing works here.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, FileText, Megaphone, Workflow } from "lucide-react";
import { GLOSSARY, GlossaryTerm, GuideChecklist, PlainSummary, type GlossaryKey, type GuideChecklistItem } from "@/components/guide";
import { useApprovedTemplates, useCampaignAnalytics, useCampaigns } from "../campaigns/api";
import { campaignTemplates } from "../campaigns/logic";
import { campaignHref } from "../campaigns/useCampaignActions";
import { useNow } from "../campaigns/useNow";
import { NEW_TEMPLATE_HREF } from "../campaigns/wizard/StepTemplate";
import { campaignSentence, latestCampaign } from "./summary";
import { useWaHealth } from "./useHealth";
import { FLOWS_VISITED_KEY, GLOSSARY_SEEN_KEY, useLocalFlag } from "./useLocalFlag";
import h from "./home.module.css";

export const NEW_CAMPAIGN_HREF = "/dashboard/whatsapp/campaigns/new";
export const FLOWS_HREF = "/dashboard/whatsapp?tab=flows";

// The five words a marketer meets first; the panel can show every term.
const FIRST_WORDS: GlossaryKey[] = ["template", "marketing", "opted_in", "held_back", "warm_audience"];
const ALL_WORDS = Object.keys(GLOSSARY) as GlossaryKey[];

export default function StartHere() {
  const health = useWaHealth();
  const templates = useApprovedTemplates();
  const campaigns = useCampaigns();
  const [flowsSeen, markFlows] = useLocalFlag(FLOWS_VISITED_KEY);
  const [wordsSeen, markWords] = useLocalFlag(GLOSSARY_SEEN_KEY);
  const [wordsOpen, setWordsOpen] = useState(false);

  const marketingTemplates = useMemo(() => campaignTemplates(templates.data ?? []), [templates.data]);
  const list = useMemo(() => campaigns.data ?? [], [campaigns.data]);
  const sentOne = list.some((c) => (c.sent_count ?? 0) > 0 || c.status === "sending" || c.status === "completed");

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
    <div className={h.page}>
      <section className={h.welcome}>
        <h2 className={h.welcomeTitle}>Welcome to WhatsApp marketing</h2>
        <p className={h.welcomeText}>
          Send offers and news to PROMUNCH customers on WhatsApp, one simple step at a time. Every screen explains itself: look for the{" "}
          <b>?</b> buttons and the dotted words.
        </p>
      </section>

      <GuideChecklist id="wa-getting-started" title="Getting started" subtitle="Tick these off once and you're set." items={items} dismissible />

      {wordsOpen && <WordsPanel onClose={() => setWordsOpen(false)} />}

      <section aria-labelledby="wa-home-do" className={h.section}>
        <h3 id="wa-home-do" className={h.sectionTitle}>What do you want to do?</h3>
        <div className={h.actions}>
          <ActionCard
            href={NEW_CAMPAIGN_HREF}
            icon={<Megaphone aria-hidden />}
            title="Send a campaign"
            text="Send one approved message to a group of customers, now or at a time you pick."
            cta="Start a campaign"
            primary
          />
          <ActionCard
            href={NEW_TEMPLATE_HREF}
            icon={<FileText aria-hidden />}
            title="Create a message template"
            text="Write a new message and send it to Meta for approval. You need one before a campaign."
            cta="Write a template"
          />
          <ActionCard
            href={FLOWS_HREF}
            onClick={markFlows}
            icon={<Workflow aria-hidden />}
            title="Set up an automation"
            text="Messages that send by themselves, like a cart reminder or a thank you after an order."
            cta="See automations"
          />
        </div>
      </section>

      <LastCampaign />

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
    </div>
  );
}

function ActionCard({
  href,
  icon,
  title,
  text,
  cta,
  primary,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  text: string;
  cta: string;
  primary?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link href={href} className={`${h.action} ${primary ? h.actionPrimary : ""}`} onClick={onClick}>
      <span className={h.actionIcon}>{icon}</span>
      <span className={h.actionTitle}>{title}</span>
      <span className={h.actionText}>{text}</span>
      <span className={`pm2-btn sm ${primary ? "pri" : ""} ${h.actionCta}`}>
        {cta} <ArrowRight size={14} aria-hidden />
      </span>
    </Link>
  );
}

function LastCampaign() {
  const campaigns = useCampaigns();
  const now = useNow(60_000);
  const last = latestCampaign(campaigns.data ?? []);
  const sent = (last?.sent_count ?? 0) > 0;
  // Same window the campaign page uses, so orders match what the report shows.
  const ageDays = last ? Math.min(365, Math.max(1, Math.ceil((now - Date.parse(last.created_at)) / 86_400_000) + 1)) : 30;
  const analytics = useCampaignAnalytics(ageDays, sent);
  const orders = last ? (analytics.data?.campaigns.find((x) => x.id === last.id)?.orders ?? null) : null;
  if (!last) return null;
  return (
    <section className={h.section} aria-label="Your last campaign">
      <PlainSummary title="Your last campaign" sentences={[campaignSentence(last, orders)]} />
      <div>
        <Link href={campaignHref(last.id)} className="pm2-btn sm">
          Open the full report <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </section>
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
