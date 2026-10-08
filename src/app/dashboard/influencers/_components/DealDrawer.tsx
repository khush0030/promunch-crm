"use client";

// One collab, top to bottom: who and where (header + stepper), quick actions,
// then the four working panels (brief, shipping, drafts, post), reminders and
// the timeline. Deep-linkable via ?deal=<id>.

import { useState } from "react";
import { creatorPortalUrl } from "@/lib/influencers/portal-url";
import { useQuery } from "@tanstack/react-query";
import { Bell, Check, Clock, Copy, Link2 } from "lucide-react";
import { ConfirmDialog, Pill, type PillTone } from "@/components/pm";
import type { DealDetail, DealListItem, DealStage, Reminder } from "@/lib/influencers/types";
import { api, errText, QK } from "./api";
import { BriefPanel, DraftsPanel, PostPanel, ShippingPanel } from "./DealPanels";
import {
  CloseBtn,
  Drawer,
  HealthChip,
  Initial,
  STAGE_LABEL,
  Section,
  TierTag,
  USAGE_LABEL,
  at,
  compact,
  dateTime,
  relDay,
  useDealAction,
} from "./ui";
import s from "../influencers.module.css";

type MoveKey = "brief" | "shipping" | "drafts" | "post";

const MAIN_STAGES: { stage: DealStage; label: string }[] = [
  { stage: "agreed", label: "Agreed" },
  { stage: "brief_sent", label: "Brief sent" },
  { stage: "brief_acknowledged", label: "Brief OK" },
  { stage: "dispatched", label: "Shipped" },
  { stage: "delivered", label: "Arrived" },
  { stage: "draft_submitted", label: "Draft in" },
  { stage: "draft_approved", label: "Approved" },
  { stage: "posted", label: "Posted" },
  { stage: "completed", label: "Done" },
];

const STEP_INDEX: Partial<Record<DealStage, number>> = {
  brief_draft: 0,
  changes_requested: 5,
};

function stepIndex(stage: DealStage): number {
  if (stage in STEP_INDEX) return STEP_INDEX[stage]!;
  return MAIN_STAGES.findIndex((m) => m.stage === stage);
}

export function DealDrawer({ dealId, onClose }: { dealId: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: QK.deal(dealId),
    queryFn: () => api<DealDetail>(`/api/influencers/deals/${dealId}`),
  });

  return (
    <Drawer onClose={onClose} label="Collab details" width={1060}>
      {isLoading && <p className={s.hint}>Loading…</p>}
      {error && (
        <>
          <div className={s.drawerHead}>
            <span />
            <CloseBtn onClose={onClose} />
          </div>
          <p className={s.err}>{errText(error)}</p>
        </>
      )}
      {data?.deal && <DealBody detail={data} onClose={onClose} />}
    </Drawer>
  );
}

function DealBody({ detail, onClose }: { detail: DealDetail; onClose: () => void }) {
  const { deal } = detail;
  const act = useDealAction(deal.id);
  const [confirm, setConfirm] = useState<null | "ghosted" | "cancelled">(null);
  const [copied, setCopied] = useState(false);
  const closed = deal.stage === "completed" || deal.stage === "cancelled" || deal.stage === "ghosted";

  const portal = creatorPortalUrl(deal.code);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(portal);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link", portal);
    }
  };

  // The step waiting on the team goes to the top as "Your move".
  const move: MoveKey | null =
    deal.stage === "draft_submitted"
      ? "drafts"
      : deal.stage === "agreed" || deal.stage === "brief_draft"
        ? "brief"
        : deal.stage === "brief_acknowledged" && !deal.shopify_order_id
          ? "shipping"
          : null;
  const panel = (k: MoveKey) =>
    k === "brief" ? (
      <BriefPanel key="brief" detail={detail} />
    ) : k === "shipping" ? (
      <ShippingPanel key="shipping" detail={detail} />
    ) : k === "drafts" ? (
      <DraftsPanel key="drafts" detail={detail} />
    ) : (
      <PostPanel key="post" detail={detail} />
    );
  const rest = (["brief", "shipping", "drafts", "post"] as MoveKey[]).filter((k) => k !== move);

  const who = [
    deal.influencer.full_name,
    deal.influencer.niche?.length ? deal.influencer.niche.join(", ") : null,
    deal.influencer.followers != null ? `${compact(deal.influencer.followers)} followers` : null,
    deal.influencer.phone,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className={s.drawerHead}>
        <div className={s.dealHead}>
          <Initial handle={deal.influencer.handle} large />
          <div style={{ minWidth: 0 }}>
            <h2 className={s.drawerTitle}>
              <a
                href={`https://instagram.com/${deal.influencer.handle.replace(/^@/, "")}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "inherit", textDecoration: "none" }}
              >
                {at(deal.influencer.handle)}
              </a>
            </h2>
            {who && <p className={s.dealSub}>{who}</p>}
            <div className={s.row} style={{ marginTop: 8 }}>
              <HealthChip health={deal.health} reason={deal.health_reason} />
              {deal.health_reason && <span className={s.muted}>{deal.health_reason}</span>}
              <TierTag tier={deal.influencer.tier} />
            </div>
          </div>
        </div>
        <CloseBtn onClose={onClose} />
      </div>

      <div className={s.dealActs}>
        <button type="button" className="pm-btn sm" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy creator link"}
        </button>
        <a className="pm-btn ghost sm" href={portal} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
          <Link2 size={14} /> Open creator page
        </a>
        <span className={s.spacer} />
        {!closed && (
          <>
            <button type="button" className="pm-btn ghost sm" onClick={() => setConfirm("ghosted")}>
              Mark ghosted
            </button>
            <button type="button" className="pm-btn ghost sm" onClick={() => setConfirm("cancelled")}>
              Cancel collab
            </button>
          </>
        )}
      </div>
      {act.error && <p className={s.err}>{errText(act.error)}</p>}

      <Stepper deal={deal} />

      <p className={s.facts}>
        <b>
          {deal.deliverables.reels} reel{deal.deliverables.reels === 1 ? "" : "s"}, {deal.deliverables.stories} stor
          {deal.deliverables.stories === 1 ? "y" : "ies"}, {deal.deliverables.posts} post{deal.deliverables.posts === 1 ? "" : "s"}
        </b>
        {" · "}Draft due {deal.draft_due_days} days after the box arrives
        {" · "}Usage rights: {USAGE_LABEL[deal.usage_rights]}
        {deal.usage_rights !== "none" && deal.usage_rights_days ? ` for ${deal.usage_rights_days} days` : ""}
      </p>
      {deal.notes && (
        <p className={s.muted} style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
          {deal.notes}
        </p>
      )}

      <div className={s.dealGrid}>
        <div className={s.dealMain}>
          {move && (
            <div className={s.move}>
              <span className={s.moveEyebrow}>Your move</span>
              {panel(move)}
            </div>
          )}
          {rest.map(panel)}
        </div>
        <div className={s.dealSide}>
          <RemindersPanel reminders={detail.reminders} />
          <TimelinePanel detail={detail} />
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm === "ghosted" ? "Mark this creator as ghosted?" : "Cancel this collab?"}
          body={
            confirm === "ghosted"
              ? "Use this when the creator has stopped replying. All reminders for this collab stop and it moves to Done. It counts against their reliability."
              : "All reminders for this collab stop and it moves to Done. If a box was already shipped, it is not recalled."
          }
          confirmLabel={confirm === "ghosted" ? "Mark ghosted" : "Cancel collab"}
          keepLabel="Keep collab"
          danger
          busy={act.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            act.mutate(
              { url: `/api/influencers/deals/${deal.id}`, method: "PATCH", body: { stage: confirm } },
              { onSettled: () => setConfirm(null) },
            )
          }
        />
      )}
    </>
  );
}

function Stepper({ deal }: { deal: DealListItem }) {
  const exited = deal.stage === "cancelled" || deal.stage === "ghosted";
  if (exited) {
    return (
      <div className={s.closedLine}>
        <Pill tone={deal.stage === "cancelled" ? "neu" : "crit"}>{STAGE_LABEL[deal.stage]}</Pill>
        <span className={s.muted}>This collab is closed. Nothing more is sent to the creator.</span>
      </div>
    );
  }
  const cur = stepIndex(deal.stage);
  return (
    <div>
      <div className={s.stage} role="list" aria-label="Collab progress">
        {MAIN_STAGES.map((m, i) => {
          const done = i < cur || deal.stage === "completed";
          const current = i === cur && deal.stage !== "completed";
          return (
            <span
              key={m.stage}
              role="listitem"
              aria-current={current ? "step" : undefined}
              className={current ? s.stOn : done ? s.stDone : undefined}
            >
              {current && (deal.stage === "brief_draft" || deal.stage === "changes_requested")
                ? STAGE_LABEL[deal.stage]
                : m.label}
            </span>
          );
        })}
      </div>
      {deal.next_date && (
        <p className={s.stageNext}>
          Next: {deal.next_date.label} {relDay(deal.next_date.at)}
        </p>
      )}
    </div>
  );
}

const REMINDER_PILL: Record<Reminder["status"], { tone: PillTone; label: string }> = {
  scheduled: { tone: "info", label: "Planned" },
  sending: { tone: "warn", label: "Sending" },
  sent: { tone: "good", label: "Sent" },
  done: { tone: "good", label: "Done" },
  cancelled: { tone: "neu", label: "Stopped" },
  failed: { tone: "crit", label: "Failed" },
};

function humanKind(kind: string): string {
  const t = kind.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function RemindersPanel({ reminders }: { reminders: Reminder[] }) {
  const sorted = [...reminders].sort((a, b) => a.due_at.localeCompare(b.due_at));
  return (
    <Section title="Automatic reminders" icon={<Bell size={16} />}>
      {sorted.length === 0 ? (
        <p className={s.hint} style={{ margin: 0 }}>
          No reminders yet. They are planned automatically as the collab moves forward.
        </p>
      ) : (
        <ul className={s.rems}>
          {sorted.map((r) => (
            <li key={r.id}>
              <Pill tone={REMINDER_PILL[r.status].tone}>{REMINDER_PILL[r.status].label}</Pill>
              <span className={s.remWhat}>
                {humanKind(r.kind)}
                {r.step > 1 ? ` (#${r.step})` : ""}
                <span className={s.hint}>
                  {" · "}
                  {r.audience === "creator" ? "to creator" : r.audience === "owner" ? "to owner" : "team task"}
                  {r.channel === "whatsapp" ? " on WhatsApp" : ""}
                </span>
                {r.last_error && <span className={s.err} style={{ display: "block" }}>{r.last_error}</span>}
              </span>
              <span className={s.remWhen}>{dateTime(r.sent_at ?? r.due_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TimelinePanel({ detail }: { detail: DealDetail }) {
  const events = [...detail.events].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <Section title="Timeline" icon={<Clock size={16} />}>
      {events.length === 0 ? (
        <p className={s.hint} style={{ margin: 0 }}>
          Nothing has happened yet.
        </p>
      ) : (
        <ul className={s.tl}>
          {events.map((e) => (
            <li key={e.id} className={s.tlDone}>
              {e.summary}
              <span className={s.tlWhen}>
                {dateTime(e.created_at)}
                {(e.actor || e.channel) && ` · ${[e.actor, e.channel].filter(Boolean).join(", ")}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
