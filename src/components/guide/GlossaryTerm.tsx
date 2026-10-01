"use client";
import type { ReactNode } from "react";
import { GLOSSARY, type GlossaryKey } from "./glossary";
import { GlossaryBody } from "./HelpTip";
import { Popover } from "./Popover";
import s from "./guide.module.css";

/**
 * Inline word with a dotted underline; hover, focus or click shows the
 * GLOSSARY[k] popover (plain meaning + "For the customer:" line).
 * `children` defaults to the glossary term's own name. Safe inside <p>.
 */
export function GlossaryTerm({ k, children }: { k: GlossaryKey; children?: ReactNode }) {
  return <GlossaryPopover k={k} className={s.termBtn}>{children ?? GLOSSARY[k].term}</GlossaryPopover>;
}

/** Internal: same popover with a custom trigger style (used for StepHeader chips). */
export function GlossaryPopover({
  k,
  className,
  children,
}: {
  k: GlossaryKey;
  className: string;
  children: ReactNode;
}) {
  const g = GLOSSARY[k];
  return (
    <Popover
      trigger={children}
      triggerClassName={className}
      interactive={Boolean(g.learnMoreHref)}
      dialogLabel={g.term}
    >
      <GlossaryBody k={k} />
    </Popover>
  );
}

export default GlossaryTerm;
