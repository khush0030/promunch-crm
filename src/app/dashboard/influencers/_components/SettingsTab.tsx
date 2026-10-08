"use client";

// Settings tab: the master switch for automatic creator messages, the daily
// digest, and the default timings new collabs start with.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ConfirmDialog } from "@/components/pm";
import type { InfluencerSettings } from "@/lib/influencers/types";
import { api, errText, QK } from "./api";
import { Field, Switch, useSettings, useSummary } from "./ui";
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

  const sched = schedule(initial.nudges);
  const hourLabel = (h: number) => (h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`);

  return (
    <div>
      <div className={s.g2}>
        <section className={s.pcard}>
          <div className={s.pcardHead}>
            <div>
              <h3>Automatic WhatsApp reminders</h3>
              <p className={s.muted} style={{ margin: "4px 0 0" }}>
                To creators, from the PROMUNCH number: brief ready, box check, draft reminders, feedback and post
                reminders. When off, nothing goes to any creator. You can still copy each creator&apos;s page link and
                share it yourself.
              </p>
            </div>
            <Switch on={initial.engine_enabled} onChange={setEngine} label="Automatic creator messages" disabled={save.isPending} />
          </div>
          {!initial.engine_enabled && (
            <p className={s.warn}>Off right now. Only switch this on once the influencer WhatsApp templates are approved by Meta.</p>
          )}
          <div className={s.divide} style={{ marginTop: 14 }}>
            {sched.map((r) => (
              <div key={r.what} className={s.setRow}>
                <span>{r.what}</span>
                <b>{r.when}</b>
              </div>
            ))}
          </div>
        </section>

        <section className={s.pcard}>
          <div className={s.pcardHead}>
            <div>
              <h3>Daily team digest</h3>
              <p className={s.muted} style={{ margin: "4px 0 0" }}>
                One WhatsApp a day at {hourLabel(initial.digest_hour_ist)} (India time) with what is due, overdue and waiting
                on us. Goes to the team only, never to creators. Skipped on days with nothing to report.
              </p>
            </div>
            <Switch
              on={initial.digest_enabled}
              onChange={(v) => save.mutate({ digest_enabled: v })}
              label="Daily team digest"
              disabled={save.isPending}
            />
          </div>
          <DigestPreview />
        </section>
      </div>

      <BriefFocus initial={initial} />

      <div className={s.secH}>
        <div>
          <h2>Timings</h2>
          <p>Defaults for new collabs, and how fast the team should act before a collab turns &quot;Waiting on us&quot;.</p>
        </div>
      </div>
      <section className={s.pcard}>
        <div className={s.form}>
          <div className={s.grid2}>
            <Field label={`Send the digest at ${f.digest_hour_ist}:00 (India time)`}>
              <select
                className={s.input}
                value={f.digest_hour_ist}
                onChange={(e) => setF({ ...f, digest_hour_ist: Number(e.target.value) })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
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
          </div>
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
              className="pm-btn sm"
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
      </section>

      <div className={s.secH}>
        <div>
          <h2>What creators receive</h2>
          <p>
            Examples of the approved message copy, shown with a sample name. Each one links to the creator&apos;s private collab
            page and is sent once per step.
          </p>
        </div>
      </div>
      <div className={s.g3}>
        {CREATOR_PREVIEWS.map((m) => (
          <div key={m.when}>
            <Phone title="PROMUNCH">
              <div className={s.waB}>
                {m.body}
                <span className={s.waFt}>Your Munchy Pal</span>
                <div className={s.waBtns}>
                  <span>{m.button}</span>
                </div>
              </div>
            </Phone>
            <p className={s.previewCap}>{m.when}</p>
          </div>
        ))}
      </div>

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

// ── previews (read only) ────────────────────────────────────────────────────

// Copy mirrors docs/whatsapp/influencer-templates.md (sample name Priya).
const CREATOR_PREVIEWS: { body: string; button: string; when: string }[] = [
  {
    body: "Hi Priya, your PROMUNCH collab brief is ready. It has the concept, the key points to cover and your dates.\n\nPlease read it and tap \"I'm in\" on your collab page so we can ship your box.",
    button: "Open my brief",
    when: "When the team sends an approved brief.",
  },
  {
    body: "Hi Priya, your PROMUNCH collab box was shipped on 12 Oct. Has it reached you?\n\nPlease tap \"My box arrived\" on your collab page so we can confirm your draft date.",
    button: "Open collab page",
    when: "When the box is not confirmed a few days after shipping.",
  },
  {
    body: "Hi Priya, a reminder that your PROMUNCH collab draft is due on 22 Oct.\n\nYou can share a link or upload the video on your collab page.",
    button: "Submit my draft",
    when: "Before the draft is due and on the day.",
  },
];

// Campaign hero product: every AI-written brief centres on it.
function BriefFocus({ initial }: { initial: InfluencerSettings }) {
  const qc = useQueryClient();
  const [focus, setFocus] = useState(initial.brief_focus ?? "");
  const [notes, setNotes] = useState(initial.brief_focus_notes ?? "");
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api("/api/influencers/settings", {
        method: "PATCH",
        body: { brief_focus: focus.trim() || null, brief_focus_notes: notes.trim() || null },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    },
  });
  const dirty = focus.trim() !== (initial.brief_focus ?? "") || notes.trim() !== (initial.brief_focus_notes ?? "");

  return (
    <>
      <div className={s.secH}>
        <div>
          <h2>Briefs</h2>
          <p>
            The product every AI brief is built around: the idea, the 3 hooks, the script and what to say. Product facts
            still come only from the PROMUNCH knowledge base. Leave it empty to let briefs cover the whole range.
          </p>
        </div>
      </div>
      <section className={s.pcard}>
        <div className={s.form}>
          <div className={s.grid2}>
            <Field label="Hero product">
              <input
                className={s.input}
                value={focus}
                maxLength={80}
                placeholder="e.g. Roasted Edamame"
                onChange={(e) => setFocus(e.target.value)}
              />
            </Field>
            <Field label="Campaign angle (optional)">
              <textarea
                className={s.input}
                value={notes}
                maxLength={600}
                rows={3}
                placeholder="e.g. olive oil roasted, the 4pm office snack, gym bag protein"
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>
          {save.error && <p className={s.err}>{errText(save.error)}</p>}
          <div className={s.actions}>
            <button type="button" className="pm-btn primary sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : saved ? "Saved" : "Save"}
            </button>
            <span className={s.hint}>Applies to the next brief you generate. Briefs already written stay as they are.</span>
          </div>
        </div>
      </section>
    </>
  );
}

function Phone({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={s.phone} aria-label={`WhatsApp preview from ${title}`}>
      <div className={s.phoneTop}>
        <span className={s.phoneAv}>PM</span>
        {title}
      </div>
      <div className={s.phoneBody}>{children}</div>
    </div>
  );
}

/** The digest line with today's board numbers (same wording the digest uses). */
function DigestPreview() {
  const summary = useSummary();
  const c = summary.data;
  const line = c
    ? [
        `Due today ${c.due_today}`,
        `Overdue ${c.overdue}`,
        `At risk ${c.at_risk}`,
        `Briefs to approve ${c.briefs_to_approve}`,
        `Drafts to review ${c.drafts_to_review}`,
        `Kits to ship ${c.kits_to_ship}`,
      ].join(" · ")
    : "Due today · Overdue · At risk · Briefs to approve · Drafts to review · Kits to ship";
  return (
    <>
      <Phone title="PROMUNCH Desk">
        <div className={s.waB}>{line}</div>
      </Phone>
      <p className={s.previewCap}>Preview with today&apos;s numbers. Overdue creators are listed by handle.</p>
    </>
  );
}

type Nudges = {
  brief_ack?: { after_hours?: unknown };
  delivery_check?: { after_days_from_dispatch?: unknown };
  draft_due?: { days_before_due?: unknown; days_after_due?: unknown };
  post_due?: { days_before?: unknown };
};

const nums = (v: unknown, fb: number[]): number[] =>
  Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n >= 0) : fb;

const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Plain-language reminder schedule from the saved nudge offsets (defaults when unset). */
function schedule(raw: Record<string, unknown> | null | undefined): { what: string; when: string }[] {
  const n = (raw ?? {}) as Nudges;
  const brief = nums(n.brief_ack?.after_hours, [24, 48]);
  const box = nums(n.delivery_check?.after_days_from_dispatch, [4, 6]);
  const before = nums(n.draft_due?.days_before_due, [2, 0]);
  const after = nums(n.draft_due?.days_after_due, [1, 3]);
  const post = nums(n.post_due?.days_before, [1]);
  const d = (x: number) => `${x} day${x === 1 ? "" : "s"}`;
  return [
    { what: "Brief not accepted yet", when: `${andList(brief.map((h) => `${h}h`))} after sending` },
    { what: "Box not confirmed", when: `${andList(box.map(String))} days after shipping` },
    {
      what: "Draft coming up",
      when: andList(before.map((x) => (x === 0 ? "on the due day" : `${d(x)} before`))),
    },
    { what: "Draft late", when: `${andList(after.map(String))} days after the due date` },
    { what: "Going live", when: andList(post.map((x) => `${d(x)} before go-live`)) },
  ];
}
