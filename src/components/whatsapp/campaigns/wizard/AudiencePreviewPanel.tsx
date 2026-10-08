"use client";

// Live "who will get this" breakdown + expected outcome, from the SAME SQL the
// engine sends with (wa_campaign_audience_counts), so preview == send.

import type { UseQueryResult } from "@tanstack/react-query";
import { Callout } from "@/components/pm";
import { GlossaryTerm } from "@/components/guide";
import { errorMessage, type AudiencePreview } from "../api";
import { estimateOutcome, fmtInr, fmtInt, fmtIstDate, pacing, type AudienceMode } from "../logic";
import s from "../campaigns.module.css";

export function AudiencePreviewPanel({
  q,
  mode,
  coldShare,
  verified,
  startMs,
  blocked,
}: {
  q: UseQueryResult<AudiencePreview>;
  mode: AudienceMode;
  coldShare: number | null;
  verified: boolean;
  startMs: number;
  blocked?: string | null;
}) {
  if (blocked) return <div className="pm2-empty">{blocked}</div>;
  if (q.isLoading || (q.isFetching && !q.data)) return <div className="pm2-empty">Counting who will get it…</div>;
  if (q.isError) return <Callout tone="crit" title="Couldn't count this audience" body={errorMessage(q.error)} />;
  if (!q.data) return null;
  if (!verified) {
    return (
      <Callout
        tone="crit"
        title="This audience needs a quick server update"
        body="The server doesn't understand this audience yet, so it would fall back to a different group. Pick another audience for now and tell the owner."
      />
    );
  }
  const c = q.data.counts;
  const people = c.eligible_total;
  const est = estimateOutcome(people, mode, coldShare);
  const pace = pacing(people, q.data.budget, q.data.eta_days, startMs);
  const heldLater = c.excluded_ticket + c.excluded_cart + c.excluded_governor + c.excluded_daily_claim;

  return (
    <div className={s.preview}>
      <div>
        <div className={s.previewBig}>{fmtInt(people)}</div>
        <div className={s.help}>people will get this campaign{q.isFetching ? " (updating…)" : ""}</div>
      </div>
      <div>
        <div className={s.bdRow}><span>Match this audience</span><b>{fmtInt(c.total_matched)}</b></div>
        {c.excluded_suppressed > 0 && <div className={s.bdRow}><span>Left out: unsubscribed or blocked by Meta before</span><b>−{fmtInt(c.excluded_suppressed)}</b></div>}
        {c.already_reached > 0 && <div className={s.bdRow}><span>Already got this campaign</span><b>−{fmtInt(c.already_reached)}</b></div>}
        {heldLater > 0 && (
          <div className={s.bdRow}>
            <span>
              Waiting their turn because of <GlossaryTerm k="fair_use">fair use</GlossaryTerm> (sent later, not dropped): open support chat {fmtInt(c.excluded_ticket)}, cart reminder {fmtInt(c.excluded_cart)},
              recent promo {fmtInt(c.excluded_governor)}, already messaged today {fmtInt(c.excluded_daily_claim)}
            </span>
            <b>{fmtInt(heldLater)}</b>
          </div>
        )}
        <div className={s.bdRow}><span>Can go out right now</span><b>{fmtInt(c.eligible)}</b></div>
      </div>
      {people > 0 && (
        <div>
          <div className={s.bdRow}><span>Expected to <GlossaryTerm k="delivered">arrive</GlossaryTerm></span><b>about {fmtInt(est.delivered)}</b></div>
          <div className={s.bdRow}>
            <span>Expected to be <GlossaryTerm k="held_back">held back by Meta</GlossaryTerm> (its per-person marketing limit, not a fault)</span>
            <b>about {fmtInt(est.heldBack)}</b>
          </div>
          <div className={s.bdRow}><span>Estimated cost, delivered only, incl. GST</span><b>about {fmtInr(est.costInr)}</b></div>
          <div className={s.bdRow}>
            <span>Pace</span>
            <b>
              {pace.perDay != null ? `~${fmtInt(pace.perDay)} a day` : "depends on today's budget"}
              {pace.finishMs ? `, done about ${fmtIstDate(pace.finishMs)}` : ""}
            </b>
          </div>
        </div>
      )}
      {people === 0 && c.total_matched > 0 && (
        <Callout tone="sun" title="Nobody here can get it" body="Everyone in this audience already got it or has unsubscribed. Pick a different audience." />
      )}
    </div>
  );
}
