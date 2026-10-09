"use client";

// Touch-friendly stage moves (drag-and-drop is desktop only):
//   - "Move to <next stage>" button on cards and in the drawer
//   - a stage menu (native select, big tap target, works on every phone)
//   - closing as Lost / On hold asks for a short reason first
// One component family used by the board, the list and the drawer.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { ALL_STAGES, STAGE_LABEL, isClosedStage, nextStage, type DealStage } from "@/lib/deals/stages";
import type { Deal } from "@/lib/deals/model";
import css from "./deals.module.css";

const REASONS: Record<"lost" | "on_hold", string[]> = {
  lost: ["Price too high", "Went with another brand", "Stopped replying", "Not a good fit"],
  on_hold: ["Check back next month", "Waiting on their budget", "Busy season for them", "Waiting on samples feedback"],
};

export function CloseReasonDialog({
  deal,
  stage,
  busy,
  onConfirm,
  onClose,
}: {
  deal: Pick<Deal, "company_name">;
  stage: "lost" | "on_hold";
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const ok = reason.trim().length >= 2;
  return (
    <div className={css.dialogScrim} onClick={onClose}>
      <form
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (ok && !busy) onConfirm(reason.trim());
        }}
      >
        <h3 id={titleId} className={css.dialogTitle}>
          {stage === "lost" ? `Mark ${deal.company_name} as lost?` : `Put ${deal.company_name} on hold?`}
        </h3>
        <p className={css.dialogText}>
          {stage === "lost" ? "Why did it not work out? One line is enough." : "Why is it paused? One line is enough."}
        </p>
        <div className={css.reasonChips}>
          {REASONS[stage].map((r) => (
            <button key={r} type="button" className={css.reasonChip} data-on={reason === r} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <input
          ref={inputRef}
          className={css.input}
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Short reason"
          aria-label="Reason"
        />
        <div className={css.dialogFoot}>
          <button type="button" className="pm2-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`pm2-btn ${stage === "lost" ? "pri" : "dark"}`} disabled={!ok || busy}>
            {stage === "lost" ? "Mark as lost" : "Put on hold"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * move(deal, stage): moves straight away, or first asks for a reason when
 * the stage is Lost / On hold. Render `dialog` somewhere in the tree.
 */
export function useStageMover(apply: (deal: Deal, stage: DealStage, reason?: string) => void, busy?: boolean) {
  const [pending, setPending] = useState<{ deal: Deal; stage: "lost" | "on_hold" } | null>(null);
  const move = (deal: Deal, stage: DealStage) => {
    if (stage === deal.stage) return;
    if (isClosedStage(stage)) setPending({ deal, stage: stage as "lost" | "on_hold" });
    else apply(deal, stage);
  };
  const dialog: ReactNode = pending ? (
    <CloseReasonDialog
      deal={pending.deal}
      stage={pending.stage}
      busy={busy}
      onClose={() => setPending(null)}
      onConfirm={(reason) => {
        apply(pending.deal, pending.stage, reason);
        setPending(null);
      }}
    />
  ) : null;
  return { move, dialog };
}

/** Native select: the one place to pick any stage (incl. Lost / On hold). */
export function StageSelect({
  deal,
  onPick,
  disabled,
  compact,
}: {
  deal: Deal;
  onPick: (stage: DealStage) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <select
      className={compact ? css.stageSelectSm : css.stageSelect}
      data-tone={deal.stage}
      value={deal.stage}
      disabled={disabled}
      aria-label={`Stage for ${deal.company_name}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => onPick(e.target.value as DealStage)}
    >
      {ALL_STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

/** "Move to Samples" one-tap button; hidden at Won / Lost / On hold. */
export function NextStageButton({
  deal,
  onPick,
  disabled,
  size = "sm",
}: {
  deal: Deal;
  onPick: (stage: DealStage) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const next = nextStage(deal.stage);
  if (!next) return null;
  return (
    <button
      type="button"
      className={size === "sm" ? css.nextBtn : `pm2-btn ${css.nextBtnMd}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onPick(next);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      Move to {STAGE_LABEL[next]} <ArrowRight size={size === "sm" ? 14 : 16} aria-hidden />
    </button>
  );
}
