"use client";

// One campaign's page: status + controls, progress and next wave, funnel to
// orders, who is held back and why, failures in plain English, recipients,
// one-click follow-ups, and the message as sent. Polls every 10s while sending.

import Link from "next/link";
import { ArrowLeft, Clock, Repeat } from "lucide-react";
import { Callout, Card, Funnel, Kpi, KpiStrip, PageHeader } from "@/components/pm";
import type { Campaign } from "../../types";
import { classifyWaError, explainWaError } from "../../waErrors";
import { errorMessage, useApprovedTemplates, useCampaign, useCampaignAnalytics, useFailures } from "../api";
import { CampaignPreview, StatusPill, TechDetails } from "../bits";
import { breakdownRows, fmtInr, fmtInt, fmtIst, fmtPct, inQuietHours, pct, progressOf, statusMeta } from "../logic";
import { describeAudience } from "../wizard/StepReview";
import { audienceFromFilter } from "../logic";
import { ActionButtons, useCampaignActions } from "../useCampaignActions";
import { RecipientsCard } from "./RecipientsCard";
import s from "../campaigns.module.css";
import { useNow } from "../useNow";

const LIST_HREF = "/dashboard/whatsapp?tab=campaigns";

export default function CampaignDetail({ id }: { id: string }) {
  const q = useCampaign(id);
  const { run, dialog, busy } = useCampaignActions({ afterDelete: () => window.location.assign(LIST_HREF) });
  const back = (
    <Link className="pm2-btn sm" href={LIST_HREF}>
      <ArrowLeft size={14} aria-hidden /> All campaigns
    </Link>
  );

  if (q.isLoading || q.isError || !q.data) {
    return (
      <>
        <PageHeader crumb={<>Marketing · <Link href={LIST_HREF}>WhatsApp campaigns</Link></>} title="Campaign" actions={back} />
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
        crumb={<>Marketing · <Link href={LIST_HREF}>WhatsApp campaigns</Link></>}
        title={c.name}
        actions={
          <div className="pm2-actions" style={{ flexWrap: "wrap" }}>
            <StatusPill status={c.status} />
            <ActionButtons campaign={c} run={run} busy={busy} hide={["open"]} />
            {back}
          </div>
        }
      />
      <div className="pm2-body">
        <Detail c={c} />
      </div>
      {dialog}
    </>
  );
}

function Detail({ c }: { c: Campaign }) {
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
  const held = breakdownRows(c.held_breakdown, "held");
  const skipped = breakdownRows(c.skipped_breakdown, "skipped");
  const resumeFuture = c.resume_at && Date.parse(c.resume_at) > now;
  const lastErr = c.last_error ? classifyWaError(c.last_error) : null;
  const audience = audienceFromFilter(c.audience_filter);

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
      {c.status === "paused" && <Callout tone="sun" title="Paused" body={`Paused ${fmtIst(c.paused_at)}. Nobody new gets it until you press Resume.`} />}
      {c.status === "cancelled" && <Callout tone="plain" title="Cancelled" body={`Cancelled ${fmtIst(c.cancelled_at)}. Nobody else will get it.`} />}
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

      <KpiStrip>
        <Kpi label="Reached" value={fmtInt(sent)} sub={prog.total != null ? `of ${fmtInt(prog.total)} in the audience` : "people"} />
        <Kpi label="Delivered" value={fmtPct(pct(c.delivered_count, sent))} sub={`${fmtInt(c.delivered_count)} people`} />
        <Kpi label="Read" value={fmtPct(pct(c.read_count, sent))} sub={`${fmtInt(c.read_count)} people`} />
        <Kpi label="Replies" value={fmtInt(c.replied_count ?? 0)} sub={`${fmtInt(c.clicked_count ?? 0)} link clicks`} />
      </KpiStrip>

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
        <Card title="Funnel" basis="people, orders within 7 days of their own message">
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

        <Card title="What didn't arrive" basis="grouped by reason">
          {(c.failed_count ?? 0) === 0 ? (
            <div className="pm2-empty">Nothing so far.</div>
          ) : failures.isLoading ? (
            <div className="pm2-empty">Loading…</div>
          ) : (
            <div className={s.stack}>
              {heldByMeta != null && heldByMeta > 0 && (
                <div>
                  <div className={s.bdRow}><span><b style={{ color: "var(--pm-ink)" }}>Held back by Meta</b></span><b>{fmtInt(heldByMeta)}</b></div>
                  <div className={s.help}>
                    Meta limits how many marketing messages each person gets from all businesses. Not a fault and not charged. We try them again after a day, up to 3 times.
                  </div>
                </div>
              )}
              {otherFailures.map((g) => (
                <div key={g.key}>
                  <div className={s.bdRow}><span><b style={{ color: "var(--pm-ink)" }}>{g.title}</b>{g.willRetry ? " (tried again automatically)" : ""}</span><b>{fmtInt(g.count)}</b></div>
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
        <Card title="Follow up" basis="opens a new campaign with this audience">
          <div className={s.inline}>
            <Link className="pm2-btn sm pri" href={`/dashboard/whatsapp/campaigns/new?retarget=${c.id}&stage=not_read`}>Retarget people who didn&apos;t read</Link>
            <Link className="pm2-btn sm" href={`/dashboard/whatsapp/campaigns/new?retarget=${c.id}&stage=read_no_reply`}>Read but didn&apos;t reply</Link>
            {(heldByMeta ?? 0) > 0 && (
              <Link className="pm2-btn sm" href={`/dashboard/whatsapp/campaigns/new?retarget=${c.id}&stage=failed_cap`}>Held back by Meta</Link>
            )}
          </div>
        </Card>
      )}

      <RecipientsCard id={c.id} name={c.name} live={live} />

      <Card title="Details">
        <dl className={s.summary}>
          <dt>Template</dt><dd>{c.template?.name ?? "–"}</dd>
          <dt>Audience</dt><dd>{describeAudience(audience)}</dd>
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
