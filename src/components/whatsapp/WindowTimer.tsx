"use client";

// Meta's 24-hour customer-service window, made visible to staff.
//
// The rule (Meta WhatsApp Business Platform): every inbound customer message
// opens/extends a 24h window measured from the LAST inbound message. Inside it
// the business may send free-form messages; once it closes, only Meta-approved
// templates are deliverable (free text fails with error #131047).
//
// Mirrors the backend's sessionOpen()/SESSION_WINDOW_MS in
// promunch-email-agent/supabase/functions/_shared/window-asks.ts — keep the
// two in sync if the window semantics ever change.

import { useEffect, useState } from "react";
import { Clock, Lock } from "lucide-react";

export const WINDOW_MS = 24 * 60 * 60 * 1000;

/** ms remaining in the window; 0 = closed; null = no inbound ever (closed). */
export function windowLeftMs(
  lastInboundAt: string | null | undefined,
  now: number,
): number | null {
  if (!lastInboundAt) return null;
  const t = Date.parse(lastInboundAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, t + WINDOW_MS - now);
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function fmtLeft(ms: number): string {
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  if (h > 0) return `${h}h ${min % 60}m`;
  if (min >= 1) return `${min}m`;
  return "under a minute";
}

/** Short form for list rows: "13h" / "42m". */
function fmtShort(ms: number): string {
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h` : `${Math.max(1, min)}m`;
}

function stateColor(left: number | null): string {
  if (left === null || left <= 0) return "var(--pm-hint)";
  if (left < 60 * 60 * 1000) return "var(--pm-terra)"; // < 1h — about to close
  if (left < 4 * 60 * 60 * 1000) return "#92400e"; // < 4h — plan the reply
  return "var(--pm-green)";
}

/** Full timer line for the conversation header, under the customer's number. */
export function WindowTimer({ lastInboundAt }: { lastInboundAt: string | null | undefined }) {
  const now = useNow(30_000);
  const left = windowLeftMs(lastInboundAt, now);
  const open = left !== null && left > 0;
  const text = open
    ? `${fmtLeft(left)} left in the customer window`
    : "Customer window closed — only approved templates can be sent";
  const title = open
    ? "Meta's 24-hour customer-service window. It restarts every time the customer messages you. While it's open you can reply with anything; after it closes, only Meta-approved templates are delivered."
    : "The customer last messaged more than 24 hours ago (or never). Meta blocks free-text replies now (#131047) — use a template to reach them, and the window reopens when they reply.";
  return (
    <div role="status" title={title} style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 12, fontWeight: 600, color: stateColor(left), marginTop: 4,
    }}>
      {open ? <Clock size={12} /> : <Lock size={12} />}
      <span>{text}</span>
    </div>
  );
}

/** Compact pill for inbox list rows. No timer of its own — rows re-render on the 15s thread poll. */
export function WindowChip({ lastInboundAt }: { lastInboundAt: string | null | undefined }) {
  const left = windowLeftMs(lastInboundAt, Date.now());
  const open = left !== null && left > 0;
  const color = stateColor(left);
  return (
    <span title={open ? `${fmtLeft(left)} left in the 24h customer window` : "24h customer window closed — template required"}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        fontSize: 10.5, fontWeight: 700, color,
        background: open ? "rgba(37,211,102,0.10)" : "var(--pm-app)",
        padding: "1px 7px", borderRadius: 999,
      }}>
      {open ? <Clock size={10} /> : <Lock size={10} />}
      {open ? `${fmtShort(left)} left` : "window closed"}
    </span>
  );
}
