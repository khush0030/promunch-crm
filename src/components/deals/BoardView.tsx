"use client";

import { BOARD_STAGES, PRIORITY_KIND, STAGE_LABEL } from "./constants";
import { DealCard } from "./DealCard";
import type { Deal } from "./types";

// HoReCa first, then flagged follow-ups, then freshest activity.
function rank(a: Deal, b: Deal): number {
  const pa = a.kind === PRIORITY_KIND ? 0 : 1;
  const pb = b.kind === PRIORITY_KIND ? 0 : 1;
  if (pa !== pb) return pa - pb;
  if (a.follow_up_needed !== b.follow_up_needed) return a.follow_up_needed ? -1 : 1;
  return (b.last_email_at ?? "").localeCompare(a.last_email_at ?? "");
}

// Stage kanban. Lost/dormant deals live in the table view only.
export function BoardView({ deals, onOpen }: { deals: Deal[]; onOpen: (id: string) => void }) {
  return (
    <div
      style={{
        display: "grid",
        gridAutoFlow: "column",
        gridAutoColumns: "minmax(230px, 1fr)",
        gap: 12,
        overflowX: "auto",
        paddingBottom: 14,
      }}
    >
      {BOARD_STAGES.map((stage) => {
        const col = deals.filter((d) => d.stage === stage).sort(rank);
        return (
          <div
            key={stage}
            style={{
              background: "var(--pm-card2)",
              border: "1px solid var(--pm-border)",
              borderRadius: "var(--pm-r2)",
              padding: 10,
              minHeight: 120,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                margin: "2px 4px 10px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--pm-hint)",
              }}
            >
              <span>{STAGE_LABEL[stage]}</span>
              <span style={{ color: "var(--pm-muted)" }}>{col.length}</span>
            </div>
            {col.map((d) => (
              <DealCard key={d.id} deal={d} onOpen={onOpen} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
