"use client";

// B2B · Replies (prototype b2b-track): what happened after sending. Replied /
// Sent / Bounced views over GET /api/leads?status=…, the reply quote, and a
// link to the matching deal when the mailbox scanner already made one.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import s from "./b2b.module.css";
import type { Lead } from "./types";
import { initials, nf, shortDate } from "./stages";
import { STAGE_LABEL } from "@/components/deals/constants";
import type { Deal } from "@/components/deals/types";

type View = "replied" | "contacted" | "bounced";

const VIEWS: { key: View; label: string }[] = [
  { key: "replied", label: "Replied" },
  { key: "contacted", label: "Sent, no reply" },
  { key: "bounced", label: "Bounced" },
];

export default function RepliesView({
  counts, following, deals, onOpenLead, reloadKey,
}: {
  counts: Record<string, number>;
  following: number;
  deals: Deal[];
  onOpenLead: (lead: Lead) => void;
  reloadKey: number;
}) {
  const [view, setView] = useState<View>("replied");
  const q = useQuery({
    queryKey: ["b2b-leads", view, reloadKey],
    queryFn: async (): Promise<Lead[]> => {
      const r = await fetch(`/api/leads?status=${view}&limit=100`, { cache: "no-store" });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || "load failed");
      return json.leads ?? [];
    },
  });
  const rows = q.data ?? [];
  const loading = q.isLoading;

  // Match a lead to a deal by website domain or by any of its contact emails.
  const dealFor = useMemo(() => {
    const byDomain = new Map<string, Deal>();
    const byEmail = new Map<string, Deal>();
    for (const d of deals) {
      if (d.company_domain) byDomain.set(d.company_domain.toLowerCase(), d);
      if (d.contact_email) byEmail.set(d.contact_email.toLowerCase(), d);
    }
    return (l: Lead): Deal | null =>
      (l.domain && byDomain.get(l.domain.toLowerCase())) ||
      (l.lead_contacts ?? []).map((c) => byEmail.get(c.email.toLowerCase())).find(Boolean) ||
      null;
  }, [deals]);

  const sent = (counts.contacted ?? 0) + (counts.replied ?? 0) + (counts.bounced ?? 0);
  const count = (v: View) => counts[v] ?? 0;

  return (
    <div className={s.body}>
      <div className={s.statline}>
        <div><b>{nf(sent)}</b><span>emailed</span></div>
        <div><b data-tone={count("replied") ? "good" : undefined}>{nf(count("replied"))}</b><span>replied</span></div>
        <div><b>{nf(following)}</b><span>in follow-ups</span></div>
        <div><b data-tone={count("bounced") ? "warn" : undefined}>{nf(count("bounced"))}</b><span>bounced</span></div>
      </div>

      <div className={s.chips} role="tablist" aria-label="Show">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={s.chip} data-on={view === v.key} onClick={() => setView(v.key)}>
            {v.label} <em>{nf(count(v.key))}</em>
          </button>
        ))}
      </div>

      <section className={`${s.card} ${s.cardFlush}`}>
        {loading ? (
          <p className={s.muted} style={{ padding: "16px 0" }}>Loading…</p>
        ) : q.error instanceof Error ? (
          <p className={s.warnNote} style={{ padding: "16px 0" }}>Could not load: {q.error.message}</p>
        ) : rows.length === 0 ? (
          <div className={s.empty}>
            <b>{view === "replied" ? "No replies yet" : view === "bounced" ? "No bounces" : "Nothing waiting on a reply"}</b>
            <p>
              {view === "replied"
                ? "When a business answers, the reply lands here and any follow-ups to them stop."
                : view === "bounced"
                  ? "Addresses that bounce are blocked automatically so they are never emailed again."
                  : "Send emails from Review and they show up here until someone answers."}
            </p>
          </div>
        ) : (
          <div className={s.bizList}>
            {rows.map((l) => {
              const reply = [...(l.outreach_replies ?? [])].sort((a, b) => +new Date(b.received_at) - +new Date(a.received_at))[0];
              const sentDraft = [...(l.outreach_drafts ?? [])].filter((d) => d.sent_at).sort((a, b) => +new Date(b.sent_at!) - +new Date(a.sent_at!))[0];
              const deal = view === "replied" ? dealFor(l) : null;
              const quote = reply?.body_text?.replace(/\s+/g, " ").trim();
              return (
                <div key={l.id} className={s.bz} data-top="true">
                  <span className={s.cj} data-tone={view === "replied" ? "good" : view === "bounced" ? "warn" : undefined}>{initials(l.name)}</span>
                  <button type="button" className={s.clM} style={{ appearance: "none", border: 0, background: "none", padding: 0, textAlign: "left", cursor: "pointer", font: "inherit" }} onClick={() => onOpenLead(l)}>
                    <b>{l.name}</b>
                    {view === "replied" && (quote || reply?.subject) ? <span className={s.q}>“{(quote || reply?.subject || "").slice(0, 180)}”</span> : null}
                    {view !== "replied" && sentDraft ? <span>{sentDraft.subject}</span> : null}
                    <span>
                      {[l.category, l.city].filter(Boolean).join(" · ")}
                      {sentDraft?.sent_at ? ` · sent ${shortDate(sentDraft.sent_at)}` : ""}
                    </span>
                  </button>
                  <span className={s.clO}>
                    {view === "replied" ? (
                      deal ? (
                        <>
                          <span className={s.tg} data-tone="good">Deal · {STAGE_LABEL[deal.stage]}</span>
                          <Link className={s.txtLink} href="/dashboard/deals">Open deal <ArrowRight /></Link>
                        </>
                      ) : (
                        <>
                          <span className={s.tg} data-tone="good">Replied</span>
                          <button type="button" className={s.txtLink} onClick={() => onOpenLead(l)}>Read reply <ArrowRight /></button>
                        </>
                      )
                    ) : view === "bounced" ? (
                      <span className={s.tg} data-tone="bad">Bounced</span>
                    ) : (
                      <span className={s.tg}>Waiting</span>
                    )}
                    {reply ? <time>{shortDate(reply.received_at)}</time> : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
