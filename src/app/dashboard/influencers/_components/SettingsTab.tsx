"use client";

// Settings tab: the master switch for automatic creator messages, the daily
// digest, and the default timings new collabs start with.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog, Panel } from "@/components/pm";
import type { InfluencerSettings } from "@/lib/influencers/types";
import { api, errText, QK } from "./api";
import { Field, Switch, useSettings } from "./ui";
import s from "../influencers.module.css";

export function SettingsTab() {
  const settings = useSettings();
  if (settings.isLoading) return <p className={s.hint}>Loading settings…</p>;
  if (settings.error) return <p className={s.err}>{errText(settings.error)}</p>;
  if (!settings.data) return <p className={s.hint}>No settings found.</p>;
  return <SettingsForm initial={settings.data} />;
}

function SettingsForm({ initial }: { initial: InfluencerSettings }) {
  const qc = useQueryClient();
  const [f, setF] = useState<InfluencerSettings>({
    ...initial,
    team_sla: {
      brief_approval_hours: initial.team_sla?.brief_approval_hours ?? 24,
      dispatch_hours: initial.team_sla?.dispatch_hours ?? 48,
      draft_review_hours: initial.team_sla?.draft_review_hours ?? 24,
    },
  });
  const [confirmEngine, setConfirmEngine] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (patch: Partial<InfluencerSettings>) =>
      api("/api/influencers/settings", { method: "PATCH", body: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    },
  });

  // The two switches save immediately (they matter most); the numbers below
  // save with the button.
  const setEngine = (on: boolean) => {
    if (on) setConfirmEngine(true);
    else save.mutate({ engine_enabled: false });
  };

  const intIn = (v: string, min: number, max: number, fallback: number) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  const dirty =
    f.digest_hour_ist !== initial.digest_hour_ist ||
    f.default_draft_due_days !== initial.default_draft_due_days ||
    f.default_post_after_approval_days !== initial.default_post_after_approval_days ||
    JSON.stringify(f.team_sla) !== JSON.stringify(initial.team_sla);

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
      <Panel title="Automatic messages">
        <div className={s.settingRow}>
          <div>
            <div style={{ fontWeight: 650, fontSize: 13.5 }}>Send reminders and updates to creators</div>
            <p className={s.muted} style={{ margin: "4px 0 0" }}>
              When on, the system sends real WhatsApp messages from the PROMUNCH number to creators: brief ready,
              box check, draft reminders, feedback and post reminders. When off, nothing goes to any creator. You can
              still copy each creator&apos;s portal link and share it yourself.
            </p>
            {!initial.engine_enabled && (
              <p className={s.warn} style={{ marginTop: 8 }}>
                Off right now. Only switch this on once the influencer WhatsApp templates are approved by Meta.
              </p>
            )}
          </div>
          <Switch on={initial.engine_enabled} onChange={setEngine} label="Automatic creator messages" disabled={save.isPending} />
        </div>
        <div className={s.settingRow}>
          <div>
            <div style={{ fontWeight: 650, fontSize: 13.5 }}>Daily team digest</div>
            <p className={s.muted} style={{ margin: "4px 0 0" }}>
              One WhatsApp message a day to the team with what is due, overdue and waiting on us. Goes to the team only,
              never to creators.
            </p>
          </div>
          <Switch
            on={initial.digest_enabled}
            onChange={(v) => save.mutate({ digest_enabled: v })}
            label="Daily team digest"
            disabled={save.isPending}
          />
        </div>
      </Panel>

      <Panel title="Timings">
        <div className={s.form} style={{ marginTop: 8 }}>
          <Field label={`Send the digest at ${f.digest_hour_ist}:00 (India time)`}>
            <select
              className={s.input}
              value={f.digest_hour_ist}
              onChange={(e) => setF({ ...f, digest_hour_ist: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`New collabs: draft due ${f.default_draft_due_days} days after the box arrives`}>
            <input
              type="range"
              className={s.range}
              min={7}
              max={15}
              value={f.default_draft_due_days}
              onChange={(e) => setF({ ...f, default_draft_due_days: Number(e.target.value) })}
              aria-label="Default draft due days"
            />
            <span className={s.hint} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>7 days</span>
              <span>15 days</span>
            </span>
          </Field>
          <Field
            label="Post within this many days after we approve the draft"
            hint="Used when a collab has no go-live date."
          >
            <input
              className={s.input}
              inputMode="numeric"
              value={f.default_post_after_approval_days}
              onChange={(e) =>
                setF({ ...f, default_post_after_approval_days: intIn(e.target.value, 1, 60, f.default_post_after_approval_days) })
              }
            />
          </Field>
          <div className={s.flab} style={{ marginTop: 4 }}>How fast the team should act (hours)</div>
          <div className={s.grid3}>
            <Field label="Approve a brief">
              <input
                className={s.input}
                inputMode="numeric"
                value={f.team_sla.brief_approval_hours}
                onChange={(e) =>
                  setF({ ...f, team_sla: { ...f.team_sla, brief_approval_hours: intIn(e.target.value, 1, 720, f.team_sla.brief_approval_hours) } })
                }
              />
            </Field>
            <Field label="Ship the box">
              <input
                className={s.input}
                inputMode="numeric"
                value={f.team_sla.dispatch_hours}
                onChange={(e) =>
                  setF({ ...f, team_sla: { ...f.team_sla, dispatch_hours: intIn(e.target.value, 1, 720, f.team_sla.dispatch_hours) } })
                }
              />
            </Field>
            <Field label="Review a draft">
              <input
                className={s.input}
                inputMode="numeric"
                value={f.team_sla.draft_review_hours}
                onChange={(e) =>
                  setF({ ...f, team_sla: { ...f.team_sla, draft_review_hours: intIn(e.target.value, 1, 720, f.team_sla.draft_review_hours) } })
                }
              />
            </Field>
          </div>
          <p className={s.hint} style={{ margin: 0 }}>
            A collab turns &quot;Waiting on us&quot; on the Board when the team takes longer than this.
          </p>
          <div className={s.actions}>
            <button
              type="button"
              className="pm-btn primary sm"
              disabled={!dirty || save.isPending}
              onClick={() =>
                save.mutate({
                  digest_hour_ist: f.digest_hour_ist,
                  default_draft_due_days: f.default_draft_due_days,
                  default_post_after_approval_days: f.default_post_after_approval_days,
                  team_sla: f.team_sla,
                })
              }
            >
              {save.isPending ? "Saving…" : "Save timings"}
            </button>
            {saved && <span className={s.ok}>Saved</span>}
            {save.error && <span className={s.err}>{errText(save.error)}</span>}
          </div>
        </div>
      </Panel>

      {confirmEngine && (
        <ConfirmDialog
          title="Start sending WhatsApp messages to creators?"
          body="From now on the system sends real WhatsApp messages from the PROMUNCH number to every creator with an open collab, based on their stage and dates. Make sure the influencer templates are approved by Meta first."
          confirmLabel="Turn on"
          busy={save.isPending}
          onClose={() => setConfirmEngine(false)}
          onConfirm={() => save.mutate({ engine_enabled: true }, { onSettled: () => setConfirmEngine(false) })}
        />
      )}
    </div>
  );
}
