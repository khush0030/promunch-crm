"use client";

// Ticket detail side panel (Oct 2026 redesign, tickets.html#tk-ticket):
// colour-coded property tiles (status, priority, assignee, topic), the
// customer facts, and the 24h WhatsApp window strip. Display only, except
// the assignee tile, which renders the SAME AssignSelect + onChange the
// header used to carry, so no write path changes. Nothing here messages a
// customer.

import type { ReactNode } from "react";
import { Clock, Lock } from "lucide-react";
import { categoryWord, ticketStatusWord } from "./labels";
import { windowLeftMs } from "@/components/whatsapp/WindowTimer";
import t from "./ticket.module.css";

type TicketStatus = "none" | "open" | "pending" | "resolved" | "closed" | null | undefined;
type Priority = "low" | "normal" | "high" | "urgent" | null | undefined;

const PRIORITY: Record<"low" | "normal" | "high" | "urgent", { word: string; cls: string }> = {
  urgent: { word: "Urgent", cls: t.pUrgent },
  high: { word: "High", cls: t.pHigh },
  normal: { word: "Normal", cls: t.pNormal },
  low: { word: "Low", cls: t.pLow },
};

function statusClass(s: TicketStatus, assignee: string | null): string {
  if (s === "open" || s === "pending") {
    if (assignee) return t.sOpen;
    return s === "open" ? t.sNew : t.sWaiting;
  }
  if (s === "resolved" || s === "closed") return t.sSolved;
  return t.sNone;
}

export function TicketProperties({
  ticketStatus,
  ticketNumber,
  ticketAssignee,
  priority,
  category,
  teamName,
  assign,
}: {
  ticketStatus: TicketStatus;
  ticketNumber: number | null | undefined;
  ticketAssignee: string | null;
  priority: Priority;
  category: string | null;
  teamName: (email: string) => string;
  /** the existing assign control, rendered unchanged inside its tile */
  assign: ReactNode;
}) {
  const hasTicket = !!ticketStatus && ticketStatus !== "none";
  const statusWord = hasTicket ? ticketStatusWord(ticketStatus ?? null, ticketAssignee, teamName) || "Open" : "No ticket";
  const prio = priority ? PRIORITY[priority] : null;
  return (
    <div className={t.props}>
      <div className={t.tiles}>
        <div className={t.tile}>
          <span className={t.tl}>Status{hasTicket && ticketNumber ? <span className={t.tlN}> · #{ticketNumber}</span> : null}</span>
          <b className={`${t.tv} ${t.dot} ${statusClass(ticketStatus, ticketAssignee)}`}>{statusWord}</b>
        </div>
        <div className={t.tile}>
          <span className={t.tl}>Priority</span>
          <b className={`${t.tv} ${prio ? `${t.dot} ${prio.cls}` : t.unset}`}>{prio ? prio.word : "Not set"}</b>
        </div>
        <div className={t.tile}>
          <span className={t.tl}>Assigned to</span>
          <div className={t.assign}>{assign}</div>
        </div>
        <div className={t.tile}>
          <span className={t.tl}>Topic</span>
          <b className={`${t.tv} ${category ? t.topic : t.unset}`}>{category ? categoryWord(category) : "Not set"}</b>
        </div>
      </div>
    </div>
  );
}

function fmtLeft(ms: number): string {
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  if (h > 0) return `${h}h ${min % 60}m`;
  if (min >= 1) return `${min}m`;
  return "under a minute";
}

/** Hairline strip above the composer: Meta's 24h customer-service window. */
export function WindowStrip({ lastInboundAt, now }: { lastInboundAt: string | null | undefined; now: number }) {
  const left = windowLeftMs(lastInboundAt, now);
  const open = left !== null && left > 0;
  const tone = !open ? t.wClosed : left < 60 * 60 * 1000 ? t.wUrgent : left < 4 * 60 * 60 * 1000 ? t.wSoon : t.wOpen;
  return (
    <div
      className={`${t.window} ${tone}`}
      role="status"
      title="Meta's 24-hour customer-service window restarts every time the customer messages. While it's open you can reply with anything; after it closes only approved templates are delivered."
    >
      {open ? <Clock aria-hidden /> : <Lock aria-hidden />}
      <span>
        {open ? (
          <>
            WhatsApp window open · <b>{fmtLeft(left)} left</b>
          </>
        ) : (
          <>WhatsApp window closed. Only approved templates can be sent.</>
        )}
      </span>
    </div>
  );
}
