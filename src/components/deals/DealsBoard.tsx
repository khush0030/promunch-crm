"use client";

// Notion-style kanban for the deal pipeline: one column per live stage plus
// Closed, drag a card to move it (PATCH sets the stage and flips
// manual_stage_override so the scanner never fights the human). Cards open
// the same DealDrawer as the list view.

import { useState } from "react";
import { StatusBadge } from "@/components/pm";
import {
  BOARD_STAGES,
  KIND_LABEL,
  STAGE_LABEL,
  STAGE_TONE,
  TEMP_LABEL,
} from "./constants";
import { timeAgo } from "./format";
import type { Deal, DealStage } from "./types";
import css from "./deals.module.css";

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

const COLUMN_DOT: Record<string, string> = {
  new_inquiry: "var(--pm-blue)",
  in_discussion: "var(--pm-gold)",
  samples_requested: "var(--pm-gold)",
  samples_sent: "var(--pm-blue)",
  negotiation: "var(--pm-gold)",
  won: "var(--pm-green)",
  closed: "var(--pm-hint)",
};

type ColumnKey = DealStage | "closed";

const COLUMNS: { key: ColumnKey; label: string; hint: string }[] = [
  ...BOARD_STAGES.map((s) => ({
    key: s as ColumnKey,
    label: STAGE_LABEL[s],
    hint: "",
  })),
  { key: "closed", label: "Closed", hint: "lost + dormant" },
];

function columnOf(d: Deal): ColumnKey {
  return d.stage === "lost" || d.stage === "dormant" ? "closed" : d.stage;
}

export default function DealsBoard({
  deals, onOpen, onMove,
}: {
  deals: Deal[];
  onOpen: (id: string) => void;
  /** Move a deal to a stage (drag-and-drop). Dropping on Closed marks it lost. */
  onMove: (id: string, stage: DealStage) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<ColumnKey | null>(null);

  function dropStage(col: ColumnKey): DealStage {
    return col === "closed" ? "lost" : col;
  }

  function handleDrop(col: ColumnKey) {
    if (draggingId) {
      const deal = deals.find((d) => d.id === draggingId);
      if (deal && columnOf(deal) !== col) onMove(draggingId, dropStage(col));
    }
    setDraggingId(null);
    setOverCol(null);
  }

  return (
    <div className={css.board}>
      {COLUMNS.map((col) => {
        const cards = deals.filter((d) => columnOf(d) === col.key);
        const isOver = overCol === col.key;
        return (
          <div
            key={col.key}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
            onDragLeave={() => setOverCol((prev) => (prev === col.key ? null : prev))}
            onDrop={(e) => { e.preventDefault(); handleDrop(col.key); }}
            className={css.lane}
            data-over={isOver ? "true" : undefined}
          >
            <div className={css.laneHead}>
              <span className={css.laneDot} style={{ background: COLUMN_DOT[col.key] }} />
              <span className={css.laneName}>{col.label}</span>
              <span className={css.laneN}>{cards.length}</span>
              {col.hint && <span className={css.laneHint}>{col.hint}</span>}
            </div>

            <div className={css.laneCards}>
              {cards.length === 0 && (
                <div className={css.laneEmpty}>{isOver ? "Drop here" : "No deals"}</div>
              )}
              {cards.map((d) => (
                <div
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", d.id);
                    setDraggingId(d.id);
                  }}
                  onDragEnd={() => { setDraggingId(null); setOverCol(null); }}
                  onClick={() => onOpen(d.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(d.id); } }}
                  className={css.card}
                  data-dragging={draggingId === d.id ? "true" : undefined}
                >
                  <div className={css.cardTop}>
                    <span
                      className={css.av}
                      data-temp={d.interest_temp ?? undefined}
                      title={d.interest_temp ? `${TEMP_LABEL[d.interest_temp]} lead` : "Not analysed yet"}
                    >
                      {initials(d.company_name)}
                    </span>
                    <div className={css.cardWho}>
                      <b className={css.cardName}>{d.company_name}</b>
                      <span>
                        {KIND_LABEL[d.kind]}
                        {d.contact_name ? ` · ${d.contact_name}` : ""}
                      </span>
                    </div>
                  </div>
                  {col.key === "closed" && (
                    <div className={css.cardTags}>
                      <StatusBadge tone={STAGE_TONE[d.stage]}>{STAGE_LABEL[d.stage]}</StatusBadge>
                    </div>
                  )}
                  {(d.next_step || d.summary) && (
                    <div className={css.cardNext}>{d.next_step || d.summary}</div>
                  )}
                  <div className={css.cardFoot}>
                    {d.follow_up_needed && <span className={css.followUp}>Follow up</span>}
                    <span className={css.cardAge}>{timeAgo(d.last_email_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
