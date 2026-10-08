"use client";

// Step 4: send now, at a set time (India time), or on repeat.

import { Card } from "@/components/pm";
import { GlossaryTerm, StepHeader } from "@/components/guide";
import {
  effectiveStart,
  fmtInt,
  fmtIst,
  fmtIstDate,
  inQuietHours,
  parseIstInput,
  toIstInput,
  type ScheduleState,
} from "../logic";
import s from "../campaigns.module.css";
import { useNow } from "../useNow";

export function StepSchedule({
  value,
  onChange,
  problems,
  showErrors,
  pace,
  step,
  total,
}: {
  step: number;
  total: number;
  value: ScheduleState;
  onChange: (p: Partial<ScheduleState>) => void;
  problems: string[];
  showErrors: boolean;
  pace: { perDay: number | null; finishMs: number | null; people: number | null };
}) {
  const at = parseIstInput(value.at);
  const now = useNow();
  const quietNow = inQuietHours(now);
  const quietAt = value.when === "schedule" && at != null && inQuietHours(at);
  const options: { key: ScheduleState["when"]; title: string; hint: string }[] = [
    { key: "now", title: "Send now", hint: "Starts right after you confirm." },
    { key: "schedule", title: "Schedule", hint: "Pick a date and time (India time). You can also repeat it." },
  ];

  return (
    <div className={s.stack}>
      <StepHeader
        step={step}
        total={total}
        title="When should it go out?"
        why={
          <>
            Big audiences go out over several days: the campaign sends up to today&apos;s{" "}
            <GlossaryTerm k="daily_budget">daily budget</GlossaryTerm>, then continues by itself every morning. Nothing goes out during{" "}
            <GlossaryTerm k="quiet_hours">quiet hours</GlossaryTerm> (9 PM to 9 AM).
          </>
        }
        glossary={["daily_budget", "quiet_hours", "fair_use"]}
      />

      <div className={s.optionGrid} role="radiogroup" aria-label="When to send">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={value.when === o.key}
            className={`${s.option} ${value.when === o.key ? s.optionOn : ""}`}
            onClick={() => onChange({ when: o.key, at: o.key === "schedule" && !value.at ? toIstInput(Date.now() + 2 * 3600_000).slice(0, 14) + "00" : value.at })}
          >
            <span className={s.optionTitle}>{o.title}</span>
            <span className={s.optionHint}>{o.hint}</span>
          </button>
        ))}
      </div>

      {value.when === "now" && quietNow && (
        <div className={s.danger}>
          It&apos;s quiet hours (9 PM to 9 AM India time) right now, so the first messages go out at about <b>{fmtIst(effectiveStart(value))}</b>.
        </div>
      )}

      {value.when === "schedule" && (
        <Card title="Date and time" basis="India time (IST)">
          <div className={s.stack}>
            <div className={s.row2}>
              <label className={s.field}>
                <span className={s.label}>Start</span>
                <input className={s.input} type="datetime-local" value={value.at} onChange={(e) => onChange({ at: e.target.value })} />
              </label>
              <label className={s.field}>
                <span className={s.label}>Repeat</span>
                <select className={s.select} value={value.repeat} onChange={(e) => onChange({ repeat: e.target.value as ScheduleState["repeat"] })}>
                  <option value="">Just once</option>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                  <option value="monthly">Every month</option>
                </select>
              </label>
            </div>
            {value.repeat && (
              <label className={s.field} style={{ maxWidth: 260 }}>
                <span className={s.label}>Stop repeating after (optional)</span>
                <input className={s.input} type="date" value={value.until} onChange={(e) => onChange({ until: e.target.value })} />
                <span className={s.help}>Leave empty to keep repeating until you pause or cancel it. Each repeat is a fresh send to the audience.</span>
              </label>
            )}
            {quietAt && (
              <div className={s.danger}>
                That time is in quiet hours (9 PM to 9 AM India time). It will start at <b>10:00 AM</b> the next morning instead.
              </div>
            )}
            {at != null && <div className={s.help}>Starts {fmtIst(at)} India time.</div>}
          </div>
        </Card>
      )}

      {pace.people != null && pace.people > 0 && (
        <div className={s.help}>
          {pace.perDay != null ? <>Sends about <b>{fmtInt(pace.perDay)}</b> a day</> : <>Sends as fast as your daily limit allows</>}
          {pace.finishMs ? <>, finishes about <b>{fmtIstDate(pace.finishMs)}</b></> : null}. Held-back people are retried within the campaign&apos;s 7 days.
        </div>
      )}

      {showErrors && problems.length > 0 && <div className={s.err} role="alert">{problems.map((p) => <div key={p}>{p}</div>)}</div>}
    </div>
  );
}

