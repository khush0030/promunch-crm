"use client";

// Small shared pieces of a deal card / row: the colour Tags, the next-step
// line ("Your move" / "Waiting on them") and the age line.

import { Tag } from "@/components/pm";
import {
  KIND_LABEL,
  KIND_TONE,
  SOURCE_LABEL,
  SOURCE_TONE,
  followUpState,
  initialsOf,
  type Deal,
  type TeamPerson,
} from "@/lib/deals/model";
import { isClosedStage } from "@/lib/deals/stages";
import { shortDate, timeAgo } from "./format";
import css from "./deals.module.css";

export function personName(email: string | null, people: TeamPerson[]): string | null {
  if (!email) return null;
  return people.find((p) => p.email === email)?.name ?? email.split("@")[0];
}

/** Whose move is it, in plain words. */
export function nextStepText(d: Deal): { who: "us" | "them" | "none"; text: string } {
  if (d.next_step) {
    return d.next_step_owner === "them" ? { who: "them", text: d.next_step } : { who: "us", text: d.next_step };
  }
  if (d.last_email_direction === "inbound") return { who: "us", text: "Reply to their last email" };
  if (d.last_email_direction === "outbound") return { who: "them", text: "Waiting for their reply" };
  return { who: "none", text: "Add a next step" };
}

export function NextStepLine({ deal: d }: { deal: Deal }) {
  if (isClosedStage(d.stage)) {
    return <p className={css.cardNext}>{d.closed_reason || "Closed"}</p>;
  }
  const n = nextStepText(d);
  return (
    <p className={css.cardNext} data-who={n.who}>
      <span className={css.whoLabel}>{n.who === "them" ? "Waiting on them" : "Your move"}</span>
      {n.who === "them" && !d.next_step ? null : <> {n.text}</>}
    </p>
  );
}

export function FollowUpTag({ deal, today, size = "sm" }: { deal: Deal; today: string; size?: "sm" | "md" }) {
  const fu = followUpState({ follow_up_at: deal.follow_up_at, stage: deal.stage, follow_up_flag: deal.follow_up_needed }, today);
  if (fu.state === "none") return null;
  const tone = fu.state === "overdue" ? "red" : fu.state === "today" ? "amber" : "grey";
  return (
    <Tag tone={tone} size={size} dot={fu.state !== "later"} title={deal.follow_up_reason ?? undefined}>
      {fu.label}
    </Tag>
  );
}

export function OwnerTag({ email, people, size = "sm" }: { email: string | null; people: TeamPerson[]; size?: "sm" | "md" }) {
  const name = personName(email, people);
  if (!name) return null;
  return (
    <Tag tone="grey" size={size} title={`Owner: ${name}`}>
      {initialsOf(name)}
    </Tag>
  );
}

export function DealTags({ deal: d, people, today, showSource = true }: { deal: Deal; people: TeamPerson[]; today: string; showSource?: boolean }) {
  return (
    <div className={css.tags}>
      <FollowUpTag deal={d} today={today} />
      <Tag tone={KIND_TONE[d.kind]} size="sm">
        {KIND_LABEL[d.kind]}
      </Tag>
      {showSource && (
        <Tag tone={SOURCE_TONE[d.source]} size="sm">
          {SOURCE_LABEL[d.source]}
        </Tag>
      )}
      <OwnerTag email={d.owner_email} people={people} />
    </div>
  );
}

export function AgeLine({ deal: d }: { deal: Deal }) {
  return (
    <span className={css.age}>
      {d.last_email_at ? `Last email ${timeAgo(d.last_email_at)}` : `Added ${shortDate(d.created_at)}`}
    </span>
  );
}
