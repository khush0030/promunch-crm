"use client";
import type { ReactNode } from "react";
import { GLOSSARY, type GlossaryKey } from "./glossary";
import { GlossaryPopover } from "./GlossaryTerm";
import s from "./guide.module.css";

/**
 * Wizard step heading: "Step 2 of 5" eyebrow, title (h2), one-line
 * "why this matters", and optional glossary chips that open explanations.
 */
export function StepHeader({
  step,
  total,
  title,
  why,
  glossary,
}: {
  step: number;
  total: number;
  title: string;
  why?: ReactNode;
  glossary?: GlossaryKey[];
}) {
  return (
    <header className={s.stepHead}>
      <div className={s.stepEyebrow}>
        Step {step} of {total}
      </div>
      <h2 className={s.stepTitle}>{title}</h2>
      {why != null && <p className={s.stepWhy}>{why}</p>}
      {glossary && glossary.length > 0 && (
        <div className={s.stepChips}>
          <span className={s.stepChipsLabel}>Words on this step:</span>
          {glossary.map((k) => (
            <GlossaryPopover key={k} k={k} className={s.chip}>
              {GLOSSARY[k].term}
            </GlossaryPopover>
          ))}
        </div>
      )}
    </header>
  );
}

export default StepHeader;
