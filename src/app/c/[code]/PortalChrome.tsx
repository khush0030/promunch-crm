// Shared, hook-free chrome for the creator portal and its not-found page:
// the red PROMUNCH hero band (logo, step meter, headline) and the footer.

import Image from "next/image";
import s from "./portal.module.css";

export const PORTAL_STEPS = ["Brief", "Box", "Draft", "Go live"] as const;

export function PortalHero({
  step,
  allDone = false,
  title,
  sub,
  meta,
}: {
  /** 1-based current step, or null to hide the meter (closed / not found). */
  step: number | null;
  /** Every step complete (posted / completed). */
  allDone?: boolean;
  title: string[];
  sub?: React.ReactNode;
  meta?: string;
}) {
  return (
    <header className={s.hero}>
      <div className={s.heroIn}>
        <div className={s.heroTop}>
          <a className={s.logo} href="https://promunch.in" aria-label="PROMUNCH home (opens promunch.in)">
            <Image src="/pm-logo-wordmark.png" alt="PROMUNCH" width={600} height={144} priority />
          </a>
          {step !== null && (
            <span className={s.heroStep}>{allDone ? "ALL DONE" : `STEP ${step} OF ${PORTAL_STEPS.length}`}</span>
          )}
        </div>

        {step !== null && (
          <ol className={s.meter} aria-label="Collab progress">
            {PORTAL_STEPS.map((label, i) => {
              const n = i + 1;
              const done = allDone || n < step;
              const now = !allDone && n === step;
              return (
                <li
                  key={label}
                  className={`${s.meterStep} ${done ? s.meterDone : ""} ${now ? s.meterNow : ""}`}
                  aria-current={now ? "step" : undefined}
                >
                  <i aria-hidden="true" />
                  <span>
                    {label}
                    <span className={s.srOnly}>{done ? ", done" : now ? ", you are here" : ", coming up"}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {meta && <p className={s.heroMeta}>{meta}</p>}
        <h1 className={s.h1}>
          {title.map((line, i) => (
            <span key={i} className={s.h1Line}>
              {line}
            </span>
          ))}
        </h1>
        {sub && <p className={s.heroSub}>{sub}</p>}
      </div>
    </header>
  );
}

export function PortalFooter() {
  return (
    <footer className={s.foot}>
      <p className={s.footHelp}>Questions? Just reply to our WhatsApp message, a real person reads every one.</p>
      <p className={s.footSign}>★ PROMUNCH · Your Munchy Pal</p>
      <a className={s.footLink} href="https://promunch.in">
        promunch.in
      </a>
    </footer>
  );
}
