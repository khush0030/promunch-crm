"use client";

import { StatusBadge } from "@/components/pm";
import { KIND_LABEL, KIND_TONE } from "./constants";
import { timeAgo } from "./format";
import type { Deal } from "./types";

// One kanban card. Red flag = the ball is in our court.
export function DealCard({ deal, onOpen }: { deal: Deal; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(deal.id)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "var(--pm-card)",
        border: "1px solid var(--pm-border)",
        borderRadius: "var(--pm-r3)",
        padding: "10px 12px",
        marginBottom: 8,
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{deal.company_name}</span>
        {deal.follow_up_needed && (
          <span style={{ color: "var(--pm-terra)", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
            ● follow up
          </span>
        )}
      </div>
      {deal.next_step && (
        <div style={{ color: "var(--pm-muted)", fontSize: 12, marginTop: 4 }}>
          {deal.next_step.length > 90 ? `${deal.next_step.slice(0, 90)}…` : deal.next_step}
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
          fontSize: 11,
          color: "var(--pm-hint)",
          gap: 6,
        }}
      >
        <StatusBadge tone={KIND_TONE[deal.kind]}>{KIND_LABEL[deal.kind]}</StatusBadge>
        <span style={{ whiteSpace: "nowrap" }}>
          {deal.last_email_direction === "inbound" ? "← " : deal.last_email_direction === "outbound" ? "→ " : ""}
          {timeAgo(deal.last_email_at)}
        </span>
      </div>
    </button>
  );
}
