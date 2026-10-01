import { useId, type ReactNode } from "react";
import s from "./guide.module.css";

/** Boxed "In plain words" recap: one short sentence per bullet. */
export function PlainSummary({ sentences, title = "In plain words" }: { sentences: ReactNode[]; title?: string }) {
  const uid = useId();
  if (sentences.length === 0) return null;
  return (
    <section className={s.summary} aria-labelledby={uid}>
      <h3 id={uid} className={s.summaryTitle}>{title}</h3>
      <ul className={s.summaryList}>
        {sentences.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </section>
  );
}

export default PlainSummary;
