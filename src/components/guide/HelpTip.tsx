"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { GLOSSARY, type GlossaryKey } from "./glossary";
import { Popover } from "./Popover";
import s from "./guide.module.css";

/** Bubble body for one glossary entry: term, plain line, "For the customer:" line, optional link. */
export function GlossaryBody({ k }: { k: GlossaryKey }) {
  const g = GLOSSARY[k];
  return (
    <>
      <span className={s.popTitle}>{g.term}</span>
      <span className={s.popText}>{g.plain}</span>
      {g.customerEffect && (
        <span className={s.popCustomer}>
          <strong>For the customer:</strong> {g.customerEffect}
        </span>
      )}
      {g.learnMoreHref && (
        <Link className={s.popLink} href={g.learnMoreHref}>
          Learn more
        </Link>
      )}
    </>
  );
}

/**
 * Small round "?" button that explains something in a popover (hover, focus or click).
 * Pass `term` to show a GLOSSARY entry, or `text` for a one-off explanation
 * (if both are given, `text` is shown under the glossary entry).
 * `label` overrides the button's accessible name.
 */
export function HelpTip({
  term,
  text,
  placement = "top",
  label,
}: {
  term?: GlossaryKey;
  text?: ReactNode;
  placement?: "top" | "bottom";
  label?: string;
}) {
  const name = label ?? (term ? `What is ${GLOSSARY[term].term.toLowerCase()}?` : "More info");
  const interactive = Boolean(term && GLOSSARY[term].learnMoreHref);
  return (
    <Popover
      trigger={<span aria-hidden="true">?</span>}
      triggerClassName={s.helpBtn}
      ariaLabel={name}
      placement={placement}
      interactive={interactive}
    >
      {term && <GlossaryBody k={term} />}
      {text != null && <span className={s.popText}>{text}</span>}
    </Popover>
  );
}

export default HelpTip;
