import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import type { ReactNode } from "react";
import { ActionButton, type GuideAction } from "./GuideChecklist";
import s from "./guide.module.css";

const TONE = {
  info: { cls: s.toneInfo, Icon: Info },
  success: { cls: s.toneSuccess, Icon: CheckCircle2 },
  warn: { cls: "sun", Icon: AlertTriangle },
  danger: { cls: "crit", Icon: OctagonAlert },
} as const;

/**
 * "What to do next" banner. Built on the pm2-callout look (same as pm
 * <Callout>) with four tones and up to two actions; `href` renders a
 * next/link, otherwise a button calling `onClick`.
 */
export function NextStepCallout({
  tone = "info",
  title,
  body,
  primary,
  secondary,
}: {
  tone?: "info" | "success" | "warn" | "danger";
  title: ReactNode;
  body?: ReactNode;
  primary?: GuideAction;
  secondary?: GuideAction;
}) {
  const { cls, Icon } = TONE[tone];
  return (
    <div className={`pm2-callout ${cls} ${s.next}`}>
      <Icon className={s.nextIcon} aria-hidden="true" />
      <div className={s.nextText}>
        <div className="t">{title}</div>
        {body != null && <div className="c">{body}</div>}
      </div>
      {(primary || secondary) && (
        <div className={`act ${s.nextActs}`}>
          {secondary && <ActionButton action={secondary} />}
          {primary && <ActionButton action={primary} primary />}
        </div>
      )}
    </div>
  );
}

export default NextStepCallout;
