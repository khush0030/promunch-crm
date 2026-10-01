"use client";

// The whole journey as a picture: the first message, then one branch per
// follow-up (wait, then send to the chosen people).

import { FlowTimeline } from "@/components/guide";
import { formatDelay, stageWho } from "../journey";
import s from "../campaigns.module.css";

export type JourneyBranch = { key: string; hours: number | null; stage: string; templateName: string | null };

export function JourneyFlow({ first, when, branches }: { first: string; when: string; branches: JourneyBranch[] }) {
  return (
    <div>
      <FlowTimeline
        orientation="vertical"
        steps={[
          { kind: "trigger", title: "Campaign goes out", detail: when },
          { kind: "message", title: first, detail: "Everyone in the audience" },
        ]}
      />
      {branches.length > 0 && (
        <div className={s.branches} role="list" aria-label="Follow-ups">
          {branches.map((b, i) => (
            <div key={b.key} className={s.branch} role="listitem">
              <div className={s.branchLabel}>Follow-up {i + 1}</div>
              <FlowTimeline
                orientation="vertical"
                steps={[
                  { kind: "wait", title: b.hours ? `Wait ${formatDelay(b.hours)}` : "Wait", detail: "counted from when each person got the first message" },
                  { kind: "message", title: b.templateName ?? "Pick a message", detail: `Only ${stageWho(b.stage)}` },
                ]}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
