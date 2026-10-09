"use client";

// Kanban for the deal pipeline: five live columns (New, Talking, Samples,
// Negotiating, Won), each with a count and a ₹ total, plus a collapsible
// Closed section (Lost, On hold) underneath. Cards move three ways:
//   - drag and drop (mouse)
//   - "Move to <next>" button (one tap, phones)
//   - the stage menu on each card (any stage; Lost / On hold ask why)

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Tag } from "@/components/pm";
import { PIPELINE_STAGES, STAGE_HINT, STAGE_LABEL, STAGE_TONE, type DealStage } from "@/lib/deals/stages";
import { formatRupees, type Deal, type TeamPerson } from "@/lib/deals/model";
import { DealTags, NextStepLine, AgeLine } from "./DealBits";
import { NextStageButton, StageSelect } from "./StageControls";
import css from "./deals.module.css";

export default function DealsBoard({
  deals,
  closed,
  people,
  today,
  onOpen,
  onMove,
}: {
  deals: Deal[];
  closed: Deal[];
  people: TeamPerson[];
  today: string;
  onOpen: (id: string) => void;
  onMove: (deal: Deal, stage: DealStage) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<DealStage | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  function handleDrop(col: DealStage) {
    const deal = draggingId ? deals.find((d) => d.id === draggingId) : null;
    if (deal && deal.stage !== col) onMove(deal, col);
    setDraggingId(null);
    setOverCol(null);
  }

  return (
    <>
      <div className={css.board}>
        {PIPELINE_STAGES.map((stage) => {
          const cards = deals.filter((d) => d.stage === stage);
          const total = cards.reduce((s, d) => s + (d.value_inr ?? 0), 0);
          return (
            <section
              key={stage}
              aria-label={STAGE_LABEL[stage]}
              className={css.lane}
              data-stage={stage}
              data-over={overCol === stage ? "true" : undefined}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(stage);
              }}
              onDragLeave={() => setOverCol((p) => (p === stage ? null : p))}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(stage);
              }}
            >
              <header className={css.laneHead}>
                <Tag tone={STAGE_TONE[stage]} dot>
                  {STAGE_LABEL[stage]}
                </Tag>
                <span className={css.laneN}>{cards.length}</span>
                {total > 0 && <span className={css.laneTotal}>{formatRupees(total)}</span>}
              </header>
              <p className={css.laneHint}>{STAGE_HINT[stage]}</p>

              <div className={css.laneCards}>
                {cards.length === 0 && <div className={css.laneEmpty}>{overCol === stage ? "Drop here" : "Nothing here yet"}</div>}
                {cards.map((d) => (
                  <article
                    key={d.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    aria-label={`${d.company_name}, ${STAGE_LABEL[d.stage]}`}
                    className={css.card}
                    data-dragging={draggingId === d.id ? "true" : undefined}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", d.id);
                      setDraggingId(d.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setOverCol(null);
                    }}
                    onClick={() => onOpen(d.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpen(d.id);
                      }
                    }}
                  >
                    <div className={css.cardTop}>
                      <b className={css.cardName}>{d.company_name}</b>
                      {d.value_inr != null && d.value_inr > 0 && <span className={css.cardValue}>{formatRupees(d.value_inr)}</span>}
                    </div>
                    {d.contact_name && d.contact_name !== d.company_name && <div className={css.cardContact}>{d.contact_name}</div>}
                    <NextStepLine deal={d} />
                    <DealTags deal={d} people={people} today={today} />
                    <div className={css.cardFoot}>
                      <AgeLine deal={d} />
                      <span className={css.cardActions}>
                        <NextStageButton deal={d} onPick={(s) => onMove(d, s)} />
                        <StageSelect compact deal={d} onPick={(s) => onMove(d, s)} />
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <section className={css.closed}>
        <button type="button" className={css.closedToggle} aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>
          {showClosed ? <ChevronDown size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
          Closed
          <span className={css.laneN}>{closed.length}</span>
          <span className={css.closedSub}>Lost and On hold</span>
        </button>
        {showClosed && (
          <div className={css.rows}>
            {closed.length === 0 && <p className={css.muted}>No closed deals match these filters.</p>}
            {closed.map((d) => (
              <ClosedRow key={d.id} deal={d} onOpen={onOpen} onMove={onMove} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ClosedRow({ deal: d, onOpen, onMove }: { deal: Deal; onOpen: (id: string) => void; onMove: (deal: Deal, stage: DealStage) => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={css.row}
      onClick={() => onOpen(d.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(d.id);
        }
      }}
    >
      <div className={css.rowMain}>
        <b className={css.rowName}>{d.company_name}</b>
        <span className={css.rowSub}>{d.closed_reason || (d.stage === "lost" ? "No reason given" : "Paused")}</span>
      </div>
      <Tag tone={STAGE_TONE[d.stage]} dot size="sm">
        {STAGE_LABEL[d.stage]}
      </Tag>
      <span className={css.rowEnd}>
        <button
          type="button"
          className={css.nextBtn}
          onClick={(e) => {
            e.stopPropagation();
            onMove(d, "talking");
          }}
        >
          Reopen
        </button>
      </span>
    </div>
  );
}
