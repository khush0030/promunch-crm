"use client";

// One collab, top to bottom: who and where (header + stepper), quick actions,
// then the four working panels (brief, shipping, drafts, post), reminders and
// the timeline. Deep-linkable via ?deal=<id>.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Check, Clock, Copy, Link2 } from "lucide-react";
import { ConfirmDialog, StatusBadge, type BadgeTone } from "@/components/pm";
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

const MAIN_STAGES: { stage: DealStage; label: string }[] = [
  { stage: "agreed", label: "Agreed" },
  { stage: "brief_sent", label: "Brief sent" },
  { stage: "brief_acknowledged", label: "Brief accepted" },
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
    <Drawer onClose={onClose} label="Collab details">
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

  const portal = typeof window !== "undefined" ? `${window.location.origin}/c/${deal.code}` : `/c/${deal.code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(portal);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link", portal);
    }
  };

  return (
    <>
      <div className={s.drawerHead}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
          <Initial handle={deal.influencer.handle} />
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
            <div className={s.row} style={{ marginTop: 6 }}>
              <TierTag tier={deal.influencer.tier} />
              <HealthChip health={deal.health} reason={deal.health_reason} />
              {deal.health_reason && <span className={s.muted}>{deal.health_reason}</span>}
            </div>
            <div className={s.hint} style={{ marginTop: 5 }}>
              {[
                deal.influencer.full_name,
                deal.influencer.followers != null ? `${compact(deal.influencer.followers)} followers` : null,
                deal.influencer.phone,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>
        <CloseBtn onClose={onClose} />
      </div>

      <Stepper deal={deal} />

      <div className={s.actions} style={{ marginTop: 14 }}>
        <button type="button" className="pm-btn sm" onClick={copy}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy portal link"}
        </button>
        <a className="pm-btn ghost sm" href={portal} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
          <Link2 size={13} /> Open portal
        </a>
        <span className={s.spacer} />
        {!closed && (
          <>
            <button type="button" className="pm-btn ghost sm" onClick={() => setConfirm("ghosted")}>
              Mark ghosted
            </button>
            <button type="button" className="pm-btn ghost sm" style={{ color: "var(--pm-terra)" }} onClick={() => setConfirm("cancelled")}>
              Cancel collab
            </button>
          </>
        )}
      </div>
      {act.error && <p className={s.err}>{errText(act.error)}</p>}

      <div className={s.hint} style={{ marginTop: 10 }}>
        Deliverables: {deal.deliverables.reels} reel{deal.deliverables.reels === 1 ? "" : "s"}, {deal.deliverables.stories}{" "}
        stor{deal.deliverables.stories === 1 ? "y" : "ies"}, {deal.deliverables.posts} post{deal.deliverables.posts === 1 ? "" : "s"}
        {" · "}Draft due {deal.draft_due_days} days after the box arrives
        {" · "}Usage rights: {USAGE_LABEL[deal.usage_rights]}
        {deal.usage_rights !== "none" && deal.usage_rights_days ? ` for ${deal.usage_rights_days} days` : ""}
      </div>
      {deal.notes && (
        <p className={s.muted} style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
          {deal.notes}
        </p>
      )}

      <BriefPanel detail={detail} />
      <ShippingPanel detail={detail} />
      <DraftsPanel detail={detail} />
      <PostPanel detail={detail} />
      <RemindersPanel reminders={detail.reminders} />
      <TimelinePanel detail={detail} />

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
      <div className={s.section} style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <StatusBadge tone={deal.stage === "cancelled" ? "gray" : "terra"}>{STAGE_LABEL[deal.stage]}</StatusBadge>
        <span className={s.muted}>This collab is closed. Nothing more is sent to the creator.</span>
      </div>
    );
  }
  const cur = stepIndex(deal.stage);
  return (
    <div>
      <div className={s.stepper}>
        {MAIN_STAGES.map((m, i) => {
          const done = i < cur || deal.stage === "completed";
          const current = i === cur && deal.stage !== "completed";
          return (
            <div key={m.stage} className={s.step}>
              <div className={s.stepLine}>
                <span className={`${s.bar} ${i === 0 ? s.barNone : done || current ? s.barOn : ""}`} />
                <span className={`${s.dot} ${done ? s.dotDone : ""} ${current ? s.dotCur : ""}`}>
                  {done && <Check size={9} strokeWidth={3.5} />}
                </span>
                <span className={`${s.bar} ${i === MAIN_STAGES.length - 1 ? s.barNone : done ? s.barOn : ""}`} />
              </div>
              <div className={`${s.stepLabel} ${current ? s.stepLabelCur : done ? s.stepLabelDone : ""}`}>
                {current && (deal.stage === "brief_draft" || deal.stage === "changes_requested")
                  ? STAGE_LABEL[deal.stage]
                  : m.label}
              </div>
            </div>
          );
        })}
      </div>
      {deal.next_date && (
        <p className={s.hint} style={{ textAlign: "center", margin: "8px 0 0" }}>
          Next: {deal.next_date.label} {relDay(deal.next_date.at)}
        </p>
      )}
    </div>
  );
}

const REMINDER_TONE: Record<Reminder["status"], BadgeTone> = {
  scheduled: "blue",
  sending: "gold",
  sent: "green",
  done: "green",
  cancelled: "gray",
  failed: "terra",
};

function humanKind(kind: string): string {
  const t = kind.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function RemindersPanel({ reminders }: { reminders: Reminder[] }) {
  const sorted = [...reminders].sort((a, b) => a.due_at.localeCompare(b.due_at));
  return (
    <Section title="Reminders" icon={<Bell size={14} />}>
      {sorted.length === 0 ? (
        <p className={s.hint} style={{ margin: 0 }}>
          No reminders yet. They are planned automatically as the collab moves forward.
        </p>
      ) : (
        <ul className={s.tl}>
          {sorted.map((r) => (
            <li key={r.id}>
              <span className={s.tlWhen}>{dateTime(r.sent_at ?? r.due_at)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {humanKind(r.kind)}
                {r.step > 1 ? ` (#${r.step})` : ""}
                <span className={s.hint}>
                  {" · "}
                  {r.audience === "creator" ? "to creator" : r.audience === "owner" ? "to owner" : "team task"}
                  {r.channel === "whatsapp" ? " on WhatsApp" : ""}
                </span>
                {r.last_error && <div className={s.err}>{r.last_error}</div>}
              </span>
              <StatusBadge tone={REMINDER_TONE[r.status]}>{r.status}</StatusBadge>
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
    <Section title="Timeline" icon={<Clock size={14} />}>
      {events.length === 0 ? (
        <p className={s.hint} style={{ margin: 0 }}>
          Nothing has happened yet.
        </p>
      ) : (
        <ul className={s.tl}>
          {events.map((e) => (
            <li key={e.id}>
              <span className={s.tlWhen}>{dateTime(e.created_at)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {e.summary}
                {(e.actor || e.channel) && (
                  <span className={s.hint}>
                    {" · "}
                    {[e.actor, e.channel].filter(Boolean).join(", ")}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
