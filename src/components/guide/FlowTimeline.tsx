import { Clock, MessageCircle, OctagonX, Zap, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import s from "./guide.module.css";

export type FlowStepKind = "trigger" | "wait" | "message" | "stop";
export type FlowStep = { kind: FlowStepKind; title: string; detail?: string; preview?: ReactNode };

const KIND: Record<FlowStepKind, { Icon: LucideIcon; label: string; cls: string }> = {
  trigger: { Icon: Zap, label: "Starts when", cls: s.kTrigger },
  wait: { Icon: Clock, label: "Wait", cls: s.kWait },
  message: { Icon: MessageCircle, label: "Send message", cls: s.kMessage },
  stop: { Icon: OctagonX, label: "Stops if", cls: s.kStop },
};

/**
 * Visual step list for an automation: trigger, waits, messages, stop rules.
 * Horizontal by default when there is room; always vertical under 640px.
 */
export function FlowTimeline({
  steps,
  orientation = "horizontal",
}: {
  steps: FlowStep[];
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <ol className={`${s.flow} ${orientation === "horizontal" ? s.flowH : s.flowV}`}>
      {steps.map((st, i) => {
        const k = KIND[st.kind];
        return (
          <li key={i} className={`${s.flowStep} ${k.cls}`}>
            <span className={s.flowDot} aria-hidden="true">
              <k.Icon />
            </span>
            <div className={s.flowBody}>
              <div className={s.flowKind}>{k.label}</div>
              <div className={s.flowTitle}>{st.title}</div>
              {st.detail && <div className={s.flowDetail}>{st.detail}</div>}
              {st.preview != null && <div className={s.flowPreview}>{st.preview}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default FlowTimeline;
