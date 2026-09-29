"use client";

// One automation, explained for a non-technical teammate: what starts it, the
// steps as a timeline, the real message, on/off with a clear state, friendly
// timing controls, recent numbers, and the technical notes tucked away.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { FlowTimeline, type FlowStep } from "@/components/guide";
import { Switch } from "./bits";
import s from "./flows.module.css";

export function AutomationCard({
  icon: Icon, title, line, enabled, onToggle, locked, stateOn = "On: sending to customers", stateOff = "Off",
  badge, steps, settings, preview, stats, tech, actions,
}: {
  icon: LucideIcon;
  title: string;
  /** Plain one-liner, e.g. "When someone leaves items in their cart". */
  line: string;
  /** null = not an on/off automation (e.g. brand sign-off). */
  enabled: boolean | null;
  onToggle?: () => void;
  locked?: boolean;
  stateOn?: string;
  stateOff?: string;
  badge?: ReactNode;
  steps?: FlowStep[];
  settings?: ReactNode;
  preview?: ReactNode;
  stats?: ReactNode;
  tech?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <article className={`pm2-panel ${s.card} ${enabled === false ? s.cardOff : ""}`} aria-label={title}>
      <div className={s.cardHead}>
        <span className={s.cardIcon} aria-hidden="true"><Icon /></span>
        <div className={s.cardTitleWrap}>
          <h3 className={s.cardTitle}>{title}</h3>
          <p className={s.cardLine}>{line}</p>
        </div>
        <div className={s.cardStatus}>
          {badge}
          {enabled !== null && (
            <>
              <span className={`${s.stateText} ${enabled ? s.stateOn : ""}`}>{enabled ? stateOn : stateOff}</span>
              {!locked && onToggle && (
                <Switch on={enabled} label={`${title}: ${enabled ? "turn off" : "turn on"}`} onClick={onToggle} />
              )}
            </>
          )}
        </div>
      </div>
      {steps && <FlowTimeline steps={steps} />}
      {(settings || preview || actions) && (
        <div className={preview ? s.body : s.main}>
          <div className={s.main}>
            {settings}
            {actions && <div className={s.cardActs}>{actions}</div>}
          </div>
          {preview}
        </div>
      )}
      {stats}
      {tech}
    </article>
  );
}

export default AutomationCard;
