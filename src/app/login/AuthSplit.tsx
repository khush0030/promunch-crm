import type { ReactNode } from "react";
import s from "./auth.module.css";

// Red pinstripe band + form card, shared by /login and /auth/set-password.
export function AuthSplit({
  headline,
  eyebrow,
  children,
}: {
  headline: ReactNode;
  eyebrow: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={s.auth}>
      <div className={s.art}>
        <span className={s.logoChip}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/promunch-wordmark.png" alt="PROMUNCH" width={83} height={20} />
        </span>
        <h1 className={s.headline}>{headline}</h1>
        <span className={s.eyebrow}>{eyebrow}</span>
      </div>
      <div className={s.formSide}>
        <div className={s.card}>{children}</div>
      </div>
    </div>
  );
}
