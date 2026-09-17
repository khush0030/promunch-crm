"use client";

import type { ReactNode } from "react";
import { PageHeader, Pill, Avatar } from "@/components/pm";
import type { Channel, PillTone } from "@/components/pm";

// Header for a conversation view in its two shapes:
//   compact  -> the `.pm2-thread-h` row used inside the Conversations list
//               pane (avatar, name, one faint facts line, pill, actions)
//   full     -> the page-level PageHeader (crumb, display title, actions)
//               followed by an optional facts strip and ticket line
export function ConversationHeader({
  compact,
  channel,
  name,
  crumb,
  faint,
  pill,
  actions,
  facts,
  note,
}: {
  compact: boolean;
  channel: Channel;
  name: string;
  crumb: string;
  /** one line under the name in compact mode, e.g. "WhatsApp · Indore · 4 orders · ₹4,790" */
  faint: string;
  pill: { tone: PillTone; text: string };
  actions: ReactNode;
  /** facts strip cells, full mode only */
  facts?: ReactNode;
  /** a line under the facts (open ticket, Instagram reply note) */
  note?: ReactNode;
}) {
  if (compact) {
    return (
      <>
        <div className="pm2-thread-h">
          <Avatar name={name} channel={channel} size={34} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</b>
            <div style={{ fontSize: 12.5, color: "var(--pm-hint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {faint}
            </div>
          </div>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Pill tone={pill.tone}>{pill.text}</Pill>
            {actions}
          </span>
        </div>
        {note ? <div style={{ padding: "8px 16px 0", fontSize: 13, color: "var(--pm-muted)" }}>{note}</div> : null}
      </>
    );
  }
  return (
    <>
      <PageHeader
        crumb={crumb}
        title={name}
        actions={
          <>
            <Pill tone={pill.tone}>{pill.text}</Pill>
            {actions}
          </>
        }
      />
      {facts || note ? (
        <div style={{ padding: "12px 28px 0", display: "flex", flexDirection: "column", gap: 6 }} className="pm2-facts">
          {facts ? (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13.5, alignItems: "center" }}>{facts}</div>
          ) : null}
          {note ? <div style={{ fontSize: 13, color: "var(--pm-muted)" }}>{note}</div> : null}
        </div>
      ) : null}
    </>
  );
}

export default ConversationHeader;
