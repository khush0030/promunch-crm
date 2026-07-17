"use client";

import { BOARD_STAGES, STAGE_LABEL } from "./constants";
import { DealCard } from "./DealCard";
import type { Deal } from "./types";

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
        const col = deals.filter((d) => d.stage === stage);
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
