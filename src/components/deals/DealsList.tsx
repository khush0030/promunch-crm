"use client";

// List view: same stage names as the board. A row of stage chips filters it
// (counts and ₹ totals per stage), each row carries the same Tags and the
// same touch-friendly stage controls as a board card. Default on phones.

import { Tag } from "@/components/pm";
import { PIPELINE_STAGES, STAGE_LABEL, STAGE_TONE, type DealStage } from "@/lib/deals/stages";
import { formatRupees, type Deal, type TeamPerson } from "@/lib/deals/model";
import { AgeLine, DealTags, NextStepLine } from "./DealBits";
import { NextStageButton, StageSelect } from "./StageControls";
import css from "./deals.module.css";

export type ListStage = "open" | DealStage | "closed";

export function listStageMatch(d: Deal, f: ListStage): boolean {
  if (f === "open") return d.stage !== "lost" && d.stage !== "on_hold" && d.stage !== "won";
  if (f === "closed") return d.stage === "lost" || d.stage === "on_hold";
  return d.stage === f;
}

export default function DealsList({
  deals,
  stage,
  onStage,
  people,
  today,
  onOpen,
  onMove,
}: {
  deals: Deal[];
  stage: ListStage;
  onStage: (s: ListStage) => void;
  people: TeamPerson[];
  today: string;
  onOpen: (id: string) => void;
  onMove: (deal: Deal, stage: DealStage) => void;
}) {
  const chips: { key: ListStage; label: string }[] = [
    { key: "open", label: "All open" },
    ...PIPELINE_STAGES.map((s) => ({ key: s as ListStage, label: STAGE_LABEL[s] })),
    { key: "closed", label: "Closed" },
  ];
  const rows = deals.filter((d) => listStageMatch(d, stage));

  return (
    <div className={css.listWrap}>
      <div className={css.stageChips} role="tablist" aria-label="Stage">
        {chips.map((c) => {
          const n = deals.filter((d) => listStageMatch(d, c.key)).length;
          return (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={stage === c.key}
              className={css.stageChip}
              data-on={stage === c.key}
              data-tone={c.key}
              onClick={() => onStage(c.key)}
            >
              {c.label}
              <span className={css.chipN}>{n}</span>
            </button>
          );
        })}
      </div>

      <div className={css.rows}>
        {rows.length === 0 && <p className={css.muted}>No deals here with these filters.</p>}
        {rows.map((d) => (
          <div
            key={d.id}
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
              <div className={css.rowTitle}>
                <b className={css.rowName}>{d.company_name}</b>
                <Tag tone={STAGE_TONE[d.stage]} dot size="sm">
                  {STAGE_LABEL[d.stage]}
                </Tag>
                {d.value_inr != null && d.value_inr > 0 && <span className={css.rowValue}>{formatRupees(d.value_inr)}</span>}
              </div>
              {d.contact_name && d.contact_name !== d.company_name && <span className={css.rowSub}>{d.contact_name}</span>}
              <NextStepLine deal={d} />
              <DealTags deal={d} people={people} today={today} />
            </div>
            <div className={css.rowEnd}>
              <AgeLine deal={d} />
              <span className={css.cardActions}>
                <NextStageButton deal={d} onPick={(s) => onMove(d, s)} />
                <StageSelect compact deal={d} onPick={(s) => onMove(d, s)} />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
