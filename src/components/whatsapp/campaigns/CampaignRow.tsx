"use client";

import Link from "next/link";
import { Clock, Repeat } from "lucide-react";
import type { Campaign } from "../types";
import { friendlyTemplateName } from "@/lib/whatsapp/templateKind";
import { useFailures } from "./api";
import { StatusPill, TemplateThumb } from "./bits";
import { followupShortLabel } from "./journey";
import { fmtInt, fmtIst, fmtPct, pct, progressOf, type CampaignAction } from "./logic";
import { ActionButtons, campaignHref } from "./useCampaignActions";
import s from "./campaigns.module.css";
import { useNow } from "./useNow";

// Meta #131049 holds, counted from the failure breakdown (loaded only for
// campaigns that have failures at all).
export function useHeldByMeta(c: Pick<Campaign, "id" | "failed_count" | "status">) {
  const q = useFailures(c.id, (c.failed_count ?? 0) > 0, c.status === "sending");
  if ((c.failed_count ?? 0) === 0) return 0;
  return q.data ? q.data.groups.filter((g) => g.key === "cap").reduce((a, g) => a + g.count, 0) : null;
}

export function CampaignRow({
  c,
  run,
  busy,
}: {
  c: Campaign;
  run: (a: CampaignAction, c: Campaign) => void;
  busy: string | null;
}) {
  const held = useHeldByMeta(c);
  const now = useNow();
  const prog = progressOf(c);
  const sent = c.sent_count ?? 0;
  const future = c.resume_at && Date.parse(c.resume_at) > now;

  return (
    <article className={s.row} aria-label={c.name}>
      <div className={s.rowMain}>
        <TemplateThumb tpl={c.template} mediaUrl={c.header_media_url} />
        <div style={{ minWidth: 0 }}>
          <Link href={campaignHref(c.id)} className={s.rowTitle}>
            {c.name}
          </Link>
          {c.followup_of && <div className={s.fuTag}>{followupShortLabel(c.followup_after_hours, c.followup_stage)}</div>}
          <div className={s.rowSub}>
            <StatusPill status={c.status} followup={!!c.followup_of} />
            <span>{c.template?.name ? friendlyTemplateName(c.template.name) : "No message picked yet"}</span>
          </div>
          {c.followup_of && c.status === "draft" && <div className={s.rowSub}>Turns on when the first message is launched</div>}
          {c.status === "scheduled" && c.scheduled_at && (
            <div className={s.rowSub}>
              <Clock size={12} aria-hidden /> Starts {fmtIst(c.scheduled_at)}
              {c.repeat_rule && (
                <>
                  <Repeat size={12} aria-hidden /> repeats {c.repeat_rule}
                </>
              )}
            </div>
          )}
          {c.status === "sending" && future && (
            <div className={s.rowSub}>
              <Clock size={12} aria-hidden /> Next wave {fmtIst(c.resume_at)}
            </div>
          )}
        </div>
      </div>

      <div className={s.rowStats}>
      <div className={s.progress}>
        <div className={s.track} aria-hidden>
          <div className={s.fill} style={{ width: `${prog.percent ?? 0}%` }} />
        </div>
        <div className={s.progressText}>
          {prog.total != null
            ? `${fmtInt(prog.reached)} of ${fmtInt(prog.total)} reached`
            : sent
              ? `${fmtInt(sent)} reached`
              : c.followup_of && c.status === "scheduled"
                ? "Waiting for people to reach their time"
                : "Not started"}
        </div>
      </div>

      <div className={s.metrics}>
        <div className={s.metric}>
          <b>{fmtPct(pct(c.delivered_count, sent))}</b>
          <span>Delivered</span>
        </div>
        <div className={s.metric}>
          <b>{fmtPct(pct(c.read_count, sent))}</b>
          <span>Read</span>
        </div>
        <div className={s.metric}>
          <b>{fmtInt(c.replied_count ?? 0)}</b>
          <span>Replies</span>
        </div>
        <div className={s.metric}>
          <b>{fmtInt(c.clicked_count ?? 0)}</b>
          <span>Clicks</span>
        </div>
        <div className={s.metric} title="Meta's limit on marketing messages per person. Not a fault; retried later.">
          <b>{held == null ? "…" : fmtInt(held)}</b>
          <span>Held back by Meta</span>
        </div>
      </div>
      </div>

      <div className={s.rowActions}>
        <ActionButtons campaign={c} run={run} busy={busy} compact />
      </div>
    </article>
  );
}
