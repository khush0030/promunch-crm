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
  KIND_TONE,
  STAGE_LABEL,
  STAGE_TONE,
  TEMP_LABEL,
} from "./constants";
import { timeAgo } from "./format";
import type { Deal, DealStage } from "./types";

const TEMP_DOT: Record<string, string> = {
  hot: "var(--pm-terra)",
  warm: "var(--pm-gold)",
  cool: "var(--pm-blue)",
};

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
    <div
      style={{
        display: "flex",
        gap: 12,
        overflowX: "auto",
        alignItems: "flex-start",
        paddingBottom: 10,
        marginTop: 14,
      }}
    >
      {COLUMNS.map((col) => {
        const cards = deals.filter((d) => columnOf(d) === col.key);
        const isOver = overCol === col.key;
        return (
          <div
            key={col.key}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
            onDragLeave={() => setOverCol((prev) => (prev === col.key ? null : prev))}
            onDrop={(e) => { e.preventDefault(); handleDrop(col.key); }}
            style={{
              flex: "0 0 262px",
              width: 262,
              background: isOver ? "var(--pm-green-soft, rgba(47,125,91,0.08))" : "var(--pm-card2)",
              border: `1px ${isOver ? "dashed var(--pm-green)" : "solid var(--pm-border)"}`,
              borderRadius: "var(--pm-r2)",
              padding: 10,
              minHeight: 120,
              transition: "background 120ms",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 4px 8px" }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: COLUMN_DOT[col.key] }} />
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{col.label}</span>
              <span style={{ fontSize: 11.5, color: "var(--pm-hint)", fontWeight: 600 }}>{cards.length}</span>
              {col.hint && <span style={{ fontSize: 10.5, color: "var(--pm-hint)", marginLeft: "auto" }}>{col.hint}</span>}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cards.length === 0 && (
                <div
                  style={{
                    border: "1px dashed var(--pm-border)",
                    borderRadius: "var(--pm-r3)",
                    padding: "14px 10px",
                    fontSize: 11.5,
                    color: "var(--pm-hint)",
                    textAlign: "center",
                  }}
                >
                  {isOver ? "Drop here" : "No deals"}
                </div>
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
                  style={{
                    background: "var(--pm-card)",
                    border: "1px solid var(--pm-border)",
                    borderRadius: "var(--pm-r3)",
                    padding: "10px 11px",
                    cursor: "grab",
                    opacity: draggingId === d.id ? 0.45 : 1,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                    <span
                      title={d.interest_temp ? `${TEMP_LABEL[d.interest_temp]} lead` : "Not analysed yet"}
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 999,
                        flexShrink: 0,
                        background: d.interest_temp ? TEMP_DOT[d.interest_temp] : "var(--pm-line)",
                      }}
                    />
                    <span
                      style={{
                        fontWeight: 650,
                        fontSize: 12.5,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {d.company_name}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 5 }}>
                    <StatusBadge tone={KIND_TONE[d.kind]}>{KIND_LABEL[d.kind]}</StatusBadge>
                    {col.key === "closed" && (
                      <StatusBadge tone={STAGE_TONE[d.stage]}>{STAGE_LABEL[d.stage]}</StatusBadge>
                    )}
                  </div>
                  {(d.next_step || d.summary) && (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--pm-muted)",
                        lineHeight: 1.45,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        marginBottom: 5,
                      }}
                    >
                      {d.next_step || d.summary}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {d.follow_up_needed && (
                      <span style={{ color: "var(--pm-terra)", fontSize: 10.5, fontWeight: 700 }}>● follow up</span>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--pm-hint)" }}>
                      {timeAgo(d.last_email_at)}
                    </span>
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
