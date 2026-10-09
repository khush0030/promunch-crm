"use client";

import type { ReactNode } from "react";
import { PageHeader, Avatar, Tag } from "@/components/pm";
import type { Channel, PillTone, TagTone } from "@/components/pm";
import t from "./ticket.module.css";
import { CHANNEL_NAME } from "./ChannelTag";
import h from "./header.module.css";

// Header for a conversation view in its two shapes:
//   compact  -> the header of the Live chats middle pane: avatar, name, colour
//               tags (channel, status, topic), the customer facts line
//               (city, orders, COD, profile link) and the actions row
//   full     -> the page-level PageHeader (crumb, display title, actions)
//               followed by the same facts line and ticket note
// Both shapes render `facts` and `note`, so nothing passed in is dropped.

const PILL_TAG: Record<PillTone, TagTone> = {
  crit: "red",
  warn: "amber",
  good: "green",
  info: "grey",
  neu: "grey",
  brand: "brand",
};

const CHANNEL_KIND: Record<Channel, string> = { wa: "whatsapp", em: "email", ig: "instagram" };

export function ConversationHeader({
  compact,
  channel,
  name,
  crumb,
  faint,
  pill,
  tags,
  actions,
  facts,
  note,
  back,
}: {
  compact: boolean;
  channel: Channel;
  name: string;
  crumb: string;
  /** a plain line under the name when there are no facts (e.g. email subject) */
  faint?: string;
  /** legacy status pill; rendered as a colour tag. Ignored when `tags` is given. */
  pill?: { tone: PillTone; text: string };
  /** status/topic tags after the channel tag */
  tags?: ReactNode;
  actions: ReactNode;
  /** customer facts: city, orders, COD, profile link */
  facts?: ReactNode;
  /** a line under the facts (open ticket, Instagram reply note) */
  note?: ReactNode;
  /** full page only: a back link above the title */
  back?: ReactNode;
}) {
  const channelName = CHANNEL_NAME[channel];
  const tagRow = (
    <>
      <Tag kind={CHANNEL_KIND[channel]} size="sm">
        {channelName}
      </Tag>
      {tags ?? (pill ? <Tag tone={PILL_TAG[pill.tone]} size="sm">{pill.text}</Tag> : null)}
    </>
  );
  const faintText = faint && faint.startsWith(`${channelName} · `) ? faint.slice(channelName.length + 3) : faint;

  if (compact) {
    return (
      <div className={`pm2-thread-h ${h.head}`}>
        <div className={h.top}>
          <Avatar name={name} channel={channel} size={40} />
          <div className={h.who}>
            <b className={h.name} title={name}>
              {name}
            </b>
            <div className={h.tags}>{tagRow}</div>
          </div>
        </div>
        {facts ? <div className={h.facts}>{facts}</div> : faintText ? <div className={h.facts}>{faintText}</div> : null}
        {note ? <div className={h.note}>{note}</div> : null}
        <div className={h.acts}>{actions}</div>
      </div>
    );
  }
  return (
    <>
      {back ? <div className={h.back}>{back}</div> : null}
      <PageHeader
        crumb={crumb}
        title={name}
        actions={<span className={t.acts}>{actions}</span>}
      />
      <div className={h.fullFacts}>
        <div className={h.tags}>{tagRow}</div>
        {facts ? <div className={h.facts}>{facts}</div> : null}
        {note ? <div className={h.note}>{note}</div> : null}
      </div>
    </>
  );
}

export default ConversationHeader;
