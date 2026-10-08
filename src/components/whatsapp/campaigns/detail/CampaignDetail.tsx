"use client";

// One campaign's page: status + controls, progress and next wave, funnel to
// orders, who is held back and why, failures in plain English, recipients,
// one-click follow-ups, and the message as sent. Polls every 10s while sending.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, Repeat } from "lucide-react";
import { Callout, Card, Funnel, Kpi, KpiStrip, PageHeader } from "@/components/pm";
import { GlossaryTerm, HelpTip, NextStepCallout, PlainSummary } from "@/components/guide";
import { friendlyTemplateName } from "@/lib/whatsapp/templateKind";
import { campaignNextStep, campaignSentence } from "../../home/summary";
import type { Campaign } from "../../types";
import { classifyWaError, explainWaError } from "../../waErrors";
import { errorMessage, useApprovedTemplates, useCampaign, useCampaignAnalytics, useFailures, useJourney, useRecipients } from "../api";
import { FollowupDrawer, type DrawerTarget } from "../followups/FollowupDrawer";
import { descendantCount, followupShortLabel } from "../journey";
import type { CampaignAction } from "../logic";
import { JourneyCard } from "./JourneyCard";
import { CampaignPreview, StatusPill, TechDetails } from "../bits";
import { breakdownRows, fmtInr, fmtInt, fmtIst, fmtPct, inQuietHours, pct, progressOf, statusMeta } from "../logic";
import { describeAudience } from "../wizard/StepReview";
import { audienceFromFilter } from "../logic";
import { ActionButtons, campaignHref, useCampaignActions } from "../useCampaignActions";
import { RecipientsCard } from "./RecipientsCard";
import { whenSentence } from "./statusSentence";
import s from "../campaigns.module.css";
import { useNow } from "../useNow";

const LIST_HREF = "/dashboard/whatsapp?tab=campaigns";
const crumb = <>Marketing · <Link href={LIST_HREF}>WhatsApp</Link></>;

export default function CampaignDetail({ id }: { id: string }) {
  const q = useCampaign(id);
  const journey = useJourney(id);
  const steps = (journey.data?.steps ?? []).map((st) => ({ ...st, followup_of: st.parent_id ?? st.followup_of ?? null }));
  const { run, dialog, busy } = useCampaignActions({
    afterDelete: () => window.location.assign(LIST_HREF),
    followupCount: (c) => descendantCount(steps, c.id),
  });
  const back = (
    <Link className="pm2-btn sm" href={LIST_HREF}>
      <ArrowLeft size={14} aria-hidden /> All campaigns
    </Link>
  );

  if (q.isLoading || q.isError || !q.data) {
    return (
      <>
        <PageHeader crumb={crumb} title="Campaign" actions={back} />
        <div className="pm2-body">
          {q.isError ? (
            <Callout tone="crit" title="Couldn't load this campaign" body={errorMessage(q.error)} action={<button type="button" className="pm2-btn sm pri" onClick={() => q.refetch()}>Try again</button>} />
          ) : (
            <div className="pm2-skel" />
          )}
        </div>
      </>
    );
  }

  const c = q.data;
  return (
    <>
      <PageHeader
        crumb={crumb}
        title={c.name}
        actions={
          <div className="pm2-actions" style={{ flexWrap: "wrap" }}>
            <StatusPill status={c.status} followup={!!c.followup_of} />
            <ActionButtons campaign={c} run={run} busy={busy} hide={["open"]} />
            {back}
          </div>
        }
      />
      <div className={`pm2-body ${s.detailBody}`}>
        {c.followup_of && (
          <div className={s.help} style={{ marginBottom: 12 }}>
            {followupShortLabel(c.followup_after_hours, c.followup_stage)} ·{" "}
            <Link href={campaignHref(c.followup_of)}>Open the first message</Link>
          </div>
        )}
        <Detail c={c} run={run} busy={busy} />
      </div>
      {dialog}
    </>
  );
}

function Detail({ c, run, busy }: { c: Campaign; run: (a: CampaignAction, c: Campaign) => void; busy: string | null }) {
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const journey = useJourney(c.id);
  const directKids = (journey.data?.steps ?? []).filter((st) => (st.parent_id ?? st.followup_of) === c.id).length;
  const live = c.status === "sending";
  const now = useNow(30_000);
  const failures = useFailures(c.id, (c.failed_count ?? 0) > 0, live);
  const ageDays = Math.min(365, Math.max(1, Math.ceil((now - Date.parse(c.created_at)) / 86_400_000) + 1));
  const analytics = useCampaignAnalytics(ageDays, (c.sent_count ?? 0) > 0);
  const card = analytics.data?.campaigns.find((x) => x.id === c.id) ?? null;
  const templates = useApprovedTemplates();
  const tpl = templates.data?.find((t) => t.id === c.template_id) ?? c.template ?? null;

  const prog = progressOf(c);
  const sent = c.sent_count ?? 0;
  const heldByMeta = failures.data ? failures.data.groups.filter((g) => g.key === "cap").reduce((a, g) => a + g.count, 0) : null;
  const otherFailures = failures.data?.groups.filter((g) => g.key !== "cap") ?? [];
  // People, not attempts: the failures endpoint counts every failed send row
  // (retries included). Count each person once by their latest result, the
  // same way the Recipients card's chips do (shared React Query cache).
  const recipients = useRecipients(c.id, live);
  const peopleByReason = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of recipients.data?.recipients ?? []) {
      if (r.status === "read" || r.status === "delivered" || r.status === "sent" || r.status === "queued") continue;
      const k = classifyWaError(r.error).key;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [recipients.data]);
  const peopleFor = (key: string) => (recipients.data ? peopleByReason.get(key) ?? 0 : null);
  const failureCount = (key: string, attempts: number) => {
    const people = peopleFor(key);
    if (people == null) return <b>{fmtInt(attempts)} {attempts === 1 ? "attempt" : "attempts"}</b>;
    return (
      <span style={{ textAlign: "right" }}>
        <b>{fmtInt(people)} {people === 1 ? "person" : "people"}</b>
        {attempts !== people && <span className={s.help} style={{ display: "block", margin: 0 }}>{fmtInt(attempts)} {attempts === 1 ? "attempt" : "attempts"}</span>}
      </span>
    );
  };
  const held = breakdownRows(c.held_breakdown, "held");
  const skipped = breakdownRows(c.skipped_breakdown, "skipped");
  const resumeFuture = c.resume_at && Date.parse(c.resume_at) > now;
  const lastErr = c.last_error ? classifyWaError(c.last_error) : null;
  const audience = audienceFromFilter(c.audience_filter);
  const next = campaignNextStep(c);
  const followHref = (stage: string) => `/dashboard/whatsapp/campaigns/new?retarget=${c.id}&stage=${stage}`;

  return (
    <>
      {c.status === "failed" && c.last_error && (
        <Callout
          tone="crit"
          title="This campaign stopped because of a problem"
          body={
            <>
              {lastErr && lastErr.key !== "unknown" ? `${lastErr.title}. ${lastErr.msg}` : explainWaError(c.last_error) ?? "The message couldn't be built or Meta refused it for everyone."}
              {lastErr?.action && <div style={{ marginTop: 4 }}>What to do: {lastErr.action}</div>}
              <TechDetails>{c.last_error}</TechDetails>
            </>
          }
        />
      )}
      {c.status === "paused" && <Callout tone="sun" title="Paused" body={`${whenSentence("Paused", c.paused_at)} Nobody new gets it until you press Resume.`} />}
      {c.status === "cancelled" && <Callout tone="plain" title="Cancelled" body={`${whenSentence("Cancelled", c.cancelled_at)} Nobody else will get it.`} />}
      {c.status === "scheduled" && c.scheduled_at && (
        <Callout
          tone="plain"
          title={`Starts ${fmtIst(c.scheduled_at)} India time`}
          body={c.repeat_rule ? `Repeats ${c.repeat_rule}${c.repeat_until ? ` until ${fmtIst(c.repeat_until)}` : ""}. Each repeat is a fresh send.` : "It starts by itself. You can still edit, pause or cancel it."}
        />
      )}
      {c.status === "draft" && (
        <Callout tone="plain" title="Not sent yet" body="This is a draft. Open it to finish the steps and launch." action={<Link className="pm2-btn sm pri" href={`/dashboard/whatsapp/campaigns/${c.id}/edit`}>Continue editing</Link>} />
      )}

      {sent > 0 && <PlainSummary sentences={[campaignSentence(c, card ? card.orders : null, { lead: `"${c.name}"` })]} />}
      {next && (
        <NextStepCallout
          tone={next.tone}
          title={next.title}
          body={next.body}
          primary={
            next.stage && c.status !== "cancelled" && c.status !== "failed"
              ? {
                  label: "Set up a follow-up",
                  onClick: () =>
                    setDrawer({
                      mode: "add",
                      parent: { id: c.id, name: c.name, status: c.status, sent_count: c.sent_count, template: c.template },
                      siblings: directKids,
                      stage: next.stage,
                    }),
                }
              : undefined
          }
          secondary={next.stage ? { label: "Send something now instead", href: followHref(next.stage) } : undefined}
        />
      )}

      <KpiStrip>
        <Kpi label={<>Delivered <HelpTip term="delivered" /></>} value={fmtInt(c.delivered_count)} sub={`${fmtPct(pct(c.delivered_count, sent))} of ${fmtInt(sent)} reached`} />
        <Kpi label={<>Read <HelpTip term="read" /></>} value={fmtInt(c.read_count)} sub={`${fmtPct(pct(c.read_count, sent))} · ${fmtInt(c.replied_count ?? 0)} replied`} />
        <Kpi label={<>Clicked <HelpTip term="click" /></>} value={fmtInt(c.clicked_count ?? 0)} sub={`${fmtPct(pct(c.clicked_count ?? 0, sent))} tapped a link`} />
        <Kpi
          label={<>Orders <HelpTip term="attributed_order" /></>}
          value={<span style={{ color: "var(--pm-brand)" }}>{card ? fmtInt(card.orders) : sent > 0 && analytics.isLoading ? "…" : "–"}</span>}
          sub={card ? (card.orders > 0 ? `${fmtInr(card.revenue)} · avg ${fmtInr(card.revenue / card.orders)}` : "none yet") : sent > 0 && analytics.isLoading ? "loading" : "within 7 days"}
        />
      </KpiStrip>

      <JourneyCard c={c} run={run} busy={busy} onOpenDrawer={setDrawer} />

      <div className="pm2-g21">
        <Card title="Progress" basis={statusMeta(c.status).hint}>
          <div className={s.stack}>
            <div>
              <div className={s.track} aria-hidden style={{ height: 10 }}>
                <div className={s.fill} style={{ width: `${prog.percent ?? 0}%` }} />
              </div>
              <div className={s.progressText}>
                {prog.total != null ? `${fmtInt(prog.reached)} of ${fmtInt(prog.total)} reached (${fmtPct(prog.percent)})` : `${fmtInt(prog.reached)} reached`}
                {live ? " · updates every 10 seconds" : ""}
              </div>
            </div>
            {live && resumeFuture && (
              <div className={s.help}>
                <Clock size={13} aria-hidden style={{ verticalAlign: -2 }} /> Next wave at <b>{fmtIst(c.resume_at)}</b>.{" "}
                {inQuietHours(now)
                  ? "It's quiet hours (9 PM to 9 AM), so it waits for the morning."
                  : "Today's budget is used up or everyone left is waiting their turn, so it continues by itself."}
              </div>
            )}
            {live && !resumeFuture && <div className={s.help}>Sending now, in small batches.</div>}
            {c.repeat_rule && (
              <div className={s.help}><Repeat size={13} aria-hidden style={{ verticalAlign: -2 }} /> Repeats {c.repeat_rule}.</div>
            )}
            {held.length > 0 && (
              <div>
                <div className={s.label}>Waiting their turn (not dropped, retried hourly)</div>
                {held.map((h) => <div key={h.key} className={s.bdRow}><span>{h.label}</span><b>{fmtInt(h.count)}</b></div>)}
              </div>
            )}
            {skipped.length > 0 && (
              <div>
                <div className={s.label}>Not sent to</div>
                {skipped.map((h) => <div key={h.key} className={s.bdRow}><span>{h.label}</span><b>{fmtInt(h.count)}</b></div>)}
              </div>
            )}
          </div>
        </Card>
        <CampaignPreview tpl={tpl} vars={c.template_vars ?? {}} mediaUrl={c.header_media_url} caption="The message as sent (sample name)" />
      </div>

      <div className="pm2-g2">
        <Card title="Funnel" basis="people, orders within 7 days of their own message" right={<HelpTip term="attributed_order" />}>
          {sent === 0 ? (
            <div className="pm2-empty">Numbers appear once the first messages go out.</div>
          ) : (
            <>
              <Funnel
                steps={[
                  ...(c.total_audience ? [{ label: "Audience", value: c.total_audience, text: fmtInt(c.total_audience) }] : []),
                  { label: "Sent", value: sent, text: fmtInt(sent) },
                  { label: "Delivered", value: c.delivered_count, text: fmtInt(c.delivered_count) },
                  { label: "Read", value: c.read_count, text: fmtInt(c.read_count) },
                  { label: "Replied", value: c.replied_count ?? 0, text: fmtInt(c.replied_count ?? 0) },
                  { label: "Clicked", value: c.clicked_count ?? 0, text: fmtInt(c.clicked_count ?? 0) },
                  ...(card ? [{ label: "Ordered", value: card.orders, text: `${fmtInt(card.orders)} · ${fmtInr(card.revenue)}` }] : []),
                ]}
              />
              {card && (
                <div className={s.help} style={{ marginTop: 10 }}>
                  Grade <b>{card.grade}</b>: {card.verdict} Cost so far about {fmtInr(card.cost)}.
                </div>
              )}
              {analytics.isLoading && <div className={s.help} style={{ marginTop: 10 }}>Loading orders…</div>}
            </>
          )}
        </Card>

        <Card title="What didn't arrive" basis="people, grouped by reason">
          {(c.failed_count ?? 0) === 0 ? (
            <div className="pm2-empty">Nothing so far.</div>
          ) : failures.isLoading ? (
            <div className="pm2-empty">Loading…</div>
          ) : (
            <div className={s.stack}>
              {heldByMeta != null && heldByMeta > 0 && (
                <div>
                  <div className={s.bdRow}><span><b style={{ color: "var(--pm-ink)" }}><GlossaryTerm k="held_back">Held back by Meta</GlossaryTerm></b></span>{failureCount("cap", heldByMeta)}</div>
                  <div className={s.help}>
                    Meta limits how many marketing messages each person gets from all businesses. Not a fault and not charged. We try them again after a day, up to 3 times.
                  </div>
                </div>
              )}
              {otherFailures.map((g) => (
                <div key={g.key}>
                  <div className={s.bdRow}><span><b style={{ color: "var(--pm-ink)" }}>{g.title}</b>{g.willRetry ? " (tried again automatically)" : ""}</span>{failureCount(g.key, g.count)}</div>
                  <div className={s.help}>{g.key === "unknown" ? "We don't recognise this error. The technical details below help the owner look into it." : g.msg}</div>
                  {g.action && <div className={s.help}>What to do: {g.action}</div>}
                  {g.sample && <TechDetails>{g.sample}</TechDetails>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {sent > 0 && (
        <Card title="Send something now to…" basis="a separate campaign that goes out right away" right={<HelpTip term="retarget" />}>
          <p className={s.help} style={{ marginTop: 0 }}>
            For a message that waits for each person&apos;s time, use <b>Add a follow-up</b> in the Journey above instead.
          </p>
          <div className={s.inline}>
            <Link className="pm2-btn sm" href={`/dashboard/whatsapp/campaigns/new?retarget=${c.id}&stage=not_read`}>People who didn&apos;t read</Link>
            <Link className="pm2-btn sm" href={`/dashboard/whatsapp/campaigns/new?retarget=${c.id}&stage=read_no_reply`}>Read but didn&apos;t reply</Link>
            {(heldByMeta ?? 0) > 0 && (
              <Link className="pm2-btn sm" href={`/dashboard/whatsapp/campaigns/new?retarget=${c.id}&stage=failed_cap`}>Held back by Meta</Link>
            )}
          </div>
        </Card>
      )}

      <RecipientsCard id={c.id} name={c.name} live={live} />
      {drawer && <FollowupDrawer target={drawer} onClose={() => setDrawer(null)} />}

      <Card title="Details">
        <dl className={s.summary}>
          <dt>Message</dt><dd>{c.template?.name ? friendlyTemplateName(c.template.name) : "–"}</dd>
          <dt>Audience</dt><dd>{c.followup_of ? followupShortLabel(c.followup_after_hours, c.followup_stage) : describeAudience(audience)}</dd>
          <dt>Picture</dt><dd>{c.header_media_url ? "A file just for this campaign" : "The template's own"}</dd>
          <dt>AI personalisation</dt><dd>{c.template_vars?._ai_brief ? "On" : "Off"}</dd>
          <dt>Created</dt><dd>{fmtIst(c.created_at)}</dd>
          <dt>Started</dt><dd>{fmtIst(c.started_at)}</dd>
          <dt>Finished</dt><dd>{fmtIst(c.completed_at)}</dd>
        </dl>
      </Card>
    </>
  );
}
