"use client";

// A teammate-made automation (wa_custom_flows) shown like the built-ins.

import { Pencil, Sparkles, Trash2 } from "lucide-react";
import type { FlowStep } from "@/components/guide";
import { AutomationCard } from "./AutomationCard";
import { PreviewTabs, StatsRow, TechDetails } from "./bits";
import type { FlowsCtx } from "./context";
import { fillSample, friendlyDuration, friendlyTemplateName, offsetsToGaps, stopRuleFor, TRIGGER_TEXT } from "./logic";
import type { CustomFlow } from "./types";

export function customFlowSteps(f: Pick<CustomFlow, "trigger_event" | "steps">): FlowStep[] {
  const gaps = offsetsToGaps(f.steps.map((x) => Number(x.delay_hours)));
  const out: FlowStep[] = [{ kind: "trigger", title: TRIGGER_TEXT[f.trigger_event]?.short ?? "Starts" }];
  f.steps.forEach((st, i) => {
    out.push({ kind: "wait", title: friendlyDuration(gaps[i]) });
    out.push({ kind: "message", title: st.template ? friendlyTemplateName(st.template) : `Message ${i + 1}` });
  });
  out.push({ kind: "stop", title: stopRuleFor(f.trigger_event) });
  return out;
}

export function CustomFlowCard({ c, flow, onToggle, onEdit, onDelete }: {
  c: FlowsCtx; flow: CustomFlow; onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const st = c.stats[`custom:${flow.id}`] ?? {};
  const sampleVars = (vars: Record<string, string>) =>
    Object.fromEntries(Object.entries(vars ?? {}).map(([k, v]) => [k, fillSample(v)]));
  return (
    <AutomationCard
      icon={Sparkles}
      title={flow.name}
      line={TRIGGER_TEXT[flow.trigger_event]?.when ?? "Custom automation"}
      enabled={flow.enabled}
      stateOff="Off (draft): not sending"
      onToggle={onToggle}
      steps={customFlowSteps(flow)}
      actions={
        <>
          <button type="button" className="pm2-btn sm" onClick={onEdit}><Pencil aria-hidden="true" /> Edit</button>
          {c.isAdmin && (
            <button type="button" className="pm2-btn sm ghost" onClick={onDelete} aria-label={`Delete ${flow.name}`}>
              <Trash2 aria-hidden="true" /> Delete
            </button>
          )}
        </>
      }
      preview={
        <PreviewTabs
          templates={c.templates}
          statusRows={c.statusRows}
          items={flow.steps.map((s, i) => ({ key: String(i), label: `Message ${i + 1}`, name: s.template, vars: sampleVars(s.vars) }))}
        />
      }
      stats={
        <StatsRow rows={[
          { label: "sent", value: st.completed ?? 0 },
          { label: "waiting", value: st.active ?? 0 },
          { label: "did not send", value: st.failed ?? 0 },
          { label: "stopped (ordered or cancelled)", value: (st.converted ?? 0) + (st.cancelled ?? 0) },
        ]} />
      }
      tech={
        <TechDetails>
          <ul>
            <li>Each customer enters this automation at most once per order or cart, so nobody gets it twice.</li>
            <li>Only customers who trigger it while it is on are added. Turning it on does not message people from before.</li>
            <li>Paused while the customer has an open support ticket, and skipped for anyone who replied STOP.</li>
            <li>Each message counts towards the daily marketing limit for that person.</li>
          </ul>
        </TechDetails>
      }
    />
  );
}
