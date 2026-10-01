"use client";

// "Journey" on the campaign page: the first message and every follow-up as a
// vertical timeline (follow-ups of follow-ups indented), each with its rule
// in plain words, status, numbers, who is still waiting for their time, and
// its own Pause / Resume / Cancel. "Add a follow-up" opens the drawer.

import Link from "next/link";
import { BellRing, Clock, HeartHandshake, Pencil, Plus } from "lucide-react";
import { Callout, Card } from "@/components/pm";
import { HelpTip } from "@/components/guide";
import { friendlyTemplateName } from "@/lib/whatsapp/templateKind";
import type { Campaign, FollowupStage } from "../../types";
import { errorMessage, useJourney, type JourneyStep } from "../api";
import { StatusPill } from "../bits";
import { MAX_JOURNEY_DEPTH, MAX_JOURNEY_FOLLOWUPS, buildTree, flattenTree, followupRuleSentence } from "../journey";
import { allowedActions, fmtInt, fmtIst, type CampaignAction } from "../logic";
import { ActionButtons, campaignHref } from "../useCampaignActions";
import type { DrawerTarget } from "../followups/FollowupDrawer";
import s from "../campaigns.module.css";

const TERMINAL = new Set(["completed", "cancelled", "failed"]);
const EDITABLE = new Set(["draft", "scheduled", "paused"]);

export function journeyLimits(steps: Pick<JourneyStep, "id" | "depth">[], current: Pick<Campaign, "id" | "status">): string | null {
  if (current.status === "cancelled" || current.status === "failed") return "This campaign was stopped, so it can't get follow-ups.";
  if (steps.length - 1 >= MAX_JOURNEY_FOLLOWUPS) return `A journey can have up to ${MAX_JOURNEY_FOLLOWUPS} follow-ups.`;
  const depth = steps.find((x) => x.id === current.id)?.depth ?? 0;
  if (depth >= MAX_JOURNEY_DEPTH) return `Follow-ups can only go ${MAX_JOURNEY_DEPTH} steps deep.`;
  return null;
}

export function JourneyCard({
  c,
  run,
  busy,
  onOpenDrawer,
}: {
  c: Campaign;
  run: (a: CampaignAction, c: Campaign) => void;
  busy: string | null;
  onOpenDrawer: (t: DrawerTarget) => void;
}) {
  const q = useJourney(c.id);
  const steps = q.data?.steps ?? [];
  const rows = flattenTree(buildTree(steps.map((st) => ({ ...st, followup_of: st.parent_id ?? st.followup_of ?? null }))));
  const byId = new Map(steps.map((st) => [st.id, st]));
  const limit = q.data ? journeyLimits(steps, c) : null;
  const directKids = steps.filter((st) => (st.parent_id ?? st.followup_of) === c.id).length;
  const isRoot = !c.followup_of;

  const add = (stage?: FollowupStage) =>
    onOpenDrawer({ mode: "add", parent: { id: c.id, name: c.name, status: c.status, sent_count: c.sent_count, template: c.template }, siblings: directKids, stage });

  return (
    <div id="journey">
      <Card
        title="Journey"
        basis="the first message and its follow-ups"
        right={<HelpTip term="journey" />}
        foot={
          <div className={s.inline}>
            <button type="button" className="pm2-btn sm pri" onClick={() => add()} disabled={!!limit || !q.data} aria-describedby={limit ? "journey-limit" : undefined}>
              <Plus size={14} aria-hidden /> Add a follow-up{c.followup_of ? " to this step" : ""}
            </button>
            {limit && <span id="journey-limit" className={s.help}>{limit}</span>}
          </div>
        }
      >
        {q.isLoading && <div className="pm2-skel" aria-label="Loading the journey" />}
        {q.isError && (
          <Callout
            tone="plain"
            title="Couldn't load the journey"
            body={errorMessage(q.error)}
            action={<button type="button" className="pm2-btn sm" onClick={() => q.refetch()}>Try again</button>}
          />
        )}
        {q.data && (
          <div className={s.stack}>
            <ol className={s.jList}>
              {rows.map(({ item: st, depth }) => {
                const parent = st.followup_of ? byId.get(st.followup_of) : null;
                return (
                  <li key={st.id} style={{ marginLeft: Math.min(depth, 3) * 18 }} className={depth > 0 ? s.jIndent : undefined}>
                    <StepCard
                      st={byId.get(st.id) ?? st}
                      current={st.id === c.id}
                      parent={parent ?? null}
                      run={run}
                      busy={busy}
                      onEdit={() =>
                        onOpenDrawer({
                          mode: "edit",
                          step: byId.get(st.id) ?? st,
                          parentTpl: parent?.template ?? null,
                          parentSent: parent?.sent_count ?? 0,
                        })
                      }
                    />
                  </li>
                );
              })}
            </ol>
            {rows.length <= 1 && isRoot && !limit && (
              <div className={s.stack} style={{ gap: 8 }}>
                <p className={s.help} style={{ margin: 0 }}>
                  No follow-ups yet. A follow-up goes out by itself some time after each person gets this message, only to the people it fits.
                </p>
                <div className={s.inline}>
                  <button type="button" className="pm2-btn sm" onClick={() => add("not_read")}>
                    <BellRing size={14} aria-hidden /> Remind people who didn&apos;t read it
                  </button>
                  <button type="button" className="pm2-btn sm" onClick={() => add("ordered")}>
                    <HeartHandshake size={14} aria-hidden /> Thank people who ordered
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function StepCard({
  st,
  current,
  parent,
  run,
  busy,
  onEdit,
}: {
  st: JourneyStep;
  current: boolean;
  parent: JourneyStep | null;
  run: (a: CampaignAction, c: Campaign) => void;
  busy: string | null;
  onEdit: () => void;
}) {
  const isFollowup = !!(st.followup_of ?? st.parent_id);
  const tplName = st.template?.name ? friendlyTemplateName(st.template.name) : null;
  const title = isFollowup
    ? followupRuleSentence({ hours: st.followup_after_hours, stage: st.followup_stage, templateName: tplName })
    : `First message${tplName ? `: "${tplName}"` : ""}`;
  const untouched = (st.sent_count ?? 0) === 0 && (st.failed_count ?? 0) === 0;
  const canEdit = isFollowup && untouched && EDITABLE.has(st.status);
  const controls: CampaignAction[] = allowedActions(st).filter((a) => a === "pause" || a === "resume" || a === "cancel");
  const waiting = st.waiting_for_time ?? 0;
  const ready = st.eligible_now ?? 0;
  const counts: [string, number | null | undefined][] = [
    ["Sent", st.sent_count],
    ["Delivered", st.delivered_count],
    ["Read", st.read_count],
    ["Replied", st.replied_count],
    ["Ordered", st.ordered_count],
  ];

  return (
    <article className={`${s.jStep} ${current ? s.jStepCurrent : ""}`} aria-current={current ? "page" : undefined}>
      <div className={s.jHead}>
        <div style={{ minWidth: 0 }}>
          <div className={s.jTitle}>{title}</div>
          <div className={s.help}>
            {st.name}
            {isFollowup && parent ? ` · after "${parent.name}"` : ""}
            {current ? " · you are here" : ""}
          </div>
        </div>
        <StatusPill status={st.status} followup={isFollowup} />
      </div>

      <div className={s.jCounts}>
        {counts.map(([label, v]) => (
          <div key={label} className={s.metric}>
            <b>{v == null ? "–" : fmtInt(v)}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {isFollowup && !TERMINAL.has(st.status) && (waiting > 0 || ready > 0 || st.next_eligible_at) && (
        <div className={s.help}>
          <Clock size={13} aria-hidden style={{ verticalAlign: -2 }} />{" "}
          {ready > 0 && <>{fmtInt(ready)} ready now (they go out in the next wave). </>}
          {waiting > 0 && <>{fmtInt(waiting)} waiting for their time. </>}
          {st.next_eligible_at && <>Next one {fmtIst(st.next_eligible_at)}.</>}
        </div>
      )}
      {isFollowup && st.status === "draft" && (
        <div className={s.help}>Turns on by itself when the first message is launched.</div>
      )}

      <div className={s.jActions}>
        {!current && (
          <Link className="pm2-btn sm" href={campaignHref(st.id)}>
            Open
          </Link>
        )}
        {canEdit && (
          <button type="button" className="pm2-btn sm" onClick={onEdit}>
            <Pencil size={14} aria-hidden /> Change
          </button>
        )}
        {controls.length > 0 && (
          <ActionButtons campaign={st} run={run} busy={busy} hide={allowedActions(st).filter((a) => !controls.includes(a))} />
        )}
      </div>
    </article>
  );
}
