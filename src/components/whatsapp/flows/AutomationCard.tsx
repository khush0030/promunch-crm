"use client";

// One automation, explained for a non-technical teammate: what starts it, the
// steps as one timeline, the real message, on/off with a clear state, friendly
// timing controls, recent numbers, and the technical notes tucked away.
//
// The same card renders three ways (set by AutomationDisplay from the list):
//   row     a calm list row (icon, name, one line, On/Off) that opens it
//   detail  the full page for one automation
//   card    the old all-in-one card (fallback, nothing uses it today)
// Every mode wires the same props, so the toggle and settings handlers are
// exactly the ones the section components pass in.

import { createContext, useContext, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, Clock, MessageCircle, OctagonX, Zap, type LucideIcon } from "lucide-react";
import { FlowTimeline, type FlowStep } from "@/components/guide";
import { Switch } from "./bits";
import s from "./flows.module.css";

export type AutomationDisplayMode =
  | { mode: "card" }
  | { mode: "row"; onOpen: () => void }
  | { mode: "detail"; onBack: () => void };

export const AutomationDisplay = createContext<AutomationDisplayMode>({ mode: "card" });

type Props = {
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
};

export function AutomationCard(p: Props) {
  const display = useContext(AutomationDisplay);
  if (display.mode === "row") return <AutomationRow {...p} onOpen={display.onOpen} />;
  if (display.mode === "detail") return <AutomationDetail {...p} onBack={display.onBack} />;
  return <AutomationFullCard {...p} />;
}

/* ---------------- list row ---------------- */

function AutomationRow({ icon: Icon, title, line, enabled, onOpen }: Props & { onOpen: () => void }) {
  return (
    <button type="button" className={s.row} onClick={onOpen} aria-label={`${title}. ${enabled === null ? "Setting" : enabled ? "On" : "Off"}. Open`}>
      <span className={`${s.rowIc} ${enabled === false ? s.rowIcOff : ""}`} aria-hidden="true"><Icon /></span>
      <span className={s.rowTx}>
        <b>{title}</b>
        <span>{line}</span>
      </span>
      {enabled !== null ? (
        <span className={`pm2-pill ${enabled ? "good" : "neu"} ${s.rowState}`}>{enabled ? "On" : "Off"}</span>
      ) : (
        <span className={s.rowSetting}>Setting</span>
      )}
      <ChevronRight className={s.rowChev} aria-hidden="true" />
    </button>
  );
}

/* ---------------- detail page ---------------- */

function AutomationDetail({
  title, line, enabled, onToggle, locked, stateOn = "On: sending to customers", stateOff = "Off",
  badge, steps, settings, preview, stats, tech, actions, onBack,
}: Props & { onBack: () => void }) {
  return (
    <article className={s.detail} aria-label={title}>
      <div className={s.dHead}>
        <button type="button" className={s.back} onClick={onBack}>
          <ArrowLeft aria-hidden="true" /> Automations
        </button>
        <div className={s.dTitleRow}>
          <div className={s.dTitleText}>
            <h2 className={s.dTitle}>{title}</h2>
            <p className={s.dLine}>{line}</p>
          </div>
          <div className={s.dState}>
            {badge}
            {enabled !== null && (
              <>
                <span className={`pm2-pill ${enabled ? "good" : "neu"}`}>{enabled ? stateOn : stateOff}</span>
                {!locked && onToggle && (
                  <Switch on={enabled} label={`${title}: ${enabled ? "turn off" : "turn on"}`} onClick={onToggle} />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className={preview ? s.dGrid : s.dGridOne}>
        <section className={s.dCard} aria-label="What happens">
          {steps && steps.length > 0 && (
            <>
              <h3 className={s.dH3}>What happens</h3>
              <StepLine steps={steps} />
            </>
          )}
          {settings && (
            <div className={s.dSettings}>
              <h3 className={s.dH3}>{steps ? "Change the timing" : "Settings"}</h3>
              {settings}
            </div>
          )}
          {actions && <div className={s.cardActs}>{actions}</div>}
          {stats && <div className={s.dStats}>{stats}</div>}
          {tech}
        </section>
        {preview && (
          <aside className={s.dSide} aria-label="What the customer sees">
            {preview}
          </aside>
        )}
      </div>
    </article>
  );
}

const KIND: Record<FlowStep["kind"], { Icon: LucideIcon; label: string; cls: string }> = {
  trigger: { Icon: Zap, label: "Starts when", cls: s.kTrigger },
  wait: { Icon: Clock, label: "Wait", cls: s.kWait },
  message: { Icon: MessageCircle, label: "Send", cls: s.kMessage },
  stop: { Icon: OctagonX, label: "Stops if", cls: s.kStop },
};

/** "Right away", "After 1 hour · if they still have not ordered", "15 min after the cart goes quiet". */
function waitWords(title: string, detail?: string): string {
  const t = title.trim();
  const now = /^right away$/i.test(t);
  if (detail && /^after\b/i.test(detail)) return `${now ? "Right away" : t} ${detail}`;
  const lead = now ? "Right away" : `After ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  return detail ? `${lead} · ${detail}` : lead;
}

/** One continuous vertical line: nodes for events, waits as mono text with a clock. */
function StepLine({ steps }: { steps: FlowStep[] }) {
  return (
    <ol className={s.tl}>
      {steps.map((st, i) => {
        const k = KIND[st.kind];
        if (st.kind === "wait") {
          return (
            <li key={i} className={s.tlWait}>
              <span className={s.tlClock} aria-hidden="true"><Clock /></span>
              <span className={s.tlWaitText}>{waitWords(st.title, st.detail)}</span>
            </li>
          );
        }
        return (
          <li key={i} className={`${s.tlNode} ${k.cls}`}>
            <span className={s.tlDot} aria-hidden="true"><k.Icon /></span>
            <div className={s.tlBody}>
              <span className={s.tlKind}>{k.label}</span>
              <b className={s.tlTitle}>{st.title}</b>
              {st.detail && <span className={s.tlDetail}>{st.detail}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------- legacy all-in-one card ---------------- */

function AutomationFullCard({
  icon: Icon, title, line, enabled, onToggle, locked, stateOn = "On: sending to customers", stateOff = "Off",
  badge, steps, settings, preview, stats, tech, actions,
}: Props) {
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
