"use client";

// Step 5 (optional): follow-ups. Each one is a sentence ("After 2 days send X
// to people who read it") plus its blanks, picture and a test send. Up to 3
// here; more (and follow-ups of follow-ups) can be added on the campaign page.

import { BellRing, HeartHandshake, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/pm";
import { GlossaryTerm, RecipeCard, StepHeader } from "@/components/guide";
import { friendlyTemplateName } from "@/lib/whatsapp/templateKind";
import { FollowupEditor } from "../followups/FollowupEditor";
import { JourneyFlow } from "../followups/JourneyFlow";
import {
  FOLLOWUP_SUGGESTIONS,
  MAX_WIZARD_FOLLOWUPS,
  draftFromSuggestion,
  draftHours,
  followupName,
  type FollowupDraft,
} from "../journey";
import type { CampaignTemplate } from "../logic";
import s from "../campaigns.module.css";

const ICONS = { remind: BellRing, thanks: HeartHandshake } as const;

type ButtonLike = { type?: string | null; url?: string | null };

export function StepFollowups({
  step,
  total,
  value,
  onChange,
  templates,
  parentTpl,
  parentName,
  whenText,
  problemsFor,
  showErrors,
  warnings = {},
  saveErrors = {},
}: {
  /** key -> "exactly the same as ..." warning, shown at once. */
  warnings?: Record<string, string>;
  /** key -> why the server refused to save it. */
  saveErrors?: Record<string, string>;
  step: number;
  total: number;
  value: FollowupDraft[];
  onChange: (next: FollowupDraft[]) => void;
  templates: CampaignTemplate[];
  parentTpl: (CampaignTemplate & { buttons?: ButtonLike[] | null }) | null;
  parentName: string;
  whenText: string;
  problemsFor: (d: FollowupDraft) => { field: string; message: string }[];
  showErrors: boolean;
}) {
  const full = value.length >= MAX_WIZARD_FOLLOWUPS;
  const add = (d: FollowupDraft) => !full && onChange([...value, d]);
  const patch = (key: string, p: Partial<FollowupDraft>) => onChange(value.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const remove = (key: string) => onChange(value.filter((d) => d.key !== key));
  const nameOf = (id: string | null) => {
    const t = templates.find((x) => x.id === id);
    return t ? friendlyTemplateName(t.name) : null;
  };

  return (
    <div className={s.stack}>
      <StepHeader
        step={step}
        total={total}
        title="Follow-ups (optional)"
        why={
          <>
            A <GlossaryTerm k="followup">follow-up</GlossaryTerm> is a second message that goes out later, only to the people it fits. The
            wait counts from when each person got this campaign. No follow-up is fine too: just press Next.
          </>
        }
        glossary={["followup", "journey", "fair_use"]}
      />

      {value.length === 0 && (
        <>
          <div className={s.suggestGrid}>
            {FOLLOWUP_SUGGESTIONS.map((sg) => (
              <RecipeCard
                key={sg.key}
                icon={ICONS[sg.key as keyof typeof ICONS] ?? BellRing}
                title={sg.title}
                when={sg.hint}
                sends="A message you pick next"
                badge={sg.key === "remind" ? "Recommended" : undefined}
                useLabel="Add this follow-up"
                onUse={() => add(draftFromSuggestion(sg))}
              />
            ))}
          </div>
          <div className={s.inline}>
            <button type="button" className="pm2-btn sm" onClick={() => add(draftFromSuggestion({ stage: "read", hours: 48 }))}>
              <Plus size={14} aria-hidden /> Make my own follow-up
            </button>
            <span className={s.help}>Or skip this step. You can also add follow-ups later from the campaign page.</span>
          </div>
        </>
      )}

      {value.map((d, i) => (
        <section key={d.key} className={s.fuCard} aria-label={`Follow-up ${i + 1}`}>
          <div className={s.fuHead}>
            <span className={s.fuTitle}>Follow-up {i + 1}</span>
            <button type="button" className="pm2-btn sm ghost" onClick={() => remove(d.key)} style={{ color: "var(--pm-terra)" }}>
              <Trash2 size={14} aria-hidden /> Remove
            </button>
          </div>
          {warnings[d.key] && (
            <div className={s.danger} role="alert">
              <b>Follow-up {i + 1}:</b> {warnings[d.key]}
            </div>
          )}
          {saveErrors[d.key] && !warnings[d.key] && (
            <div className={s.danger} role="alert">
              <b>Follow-up {i + 1} not saved:</b> {saveErrors[d.key]}
            </div>
          )}
          <FollowupEditor
            draft={d}
            onChange={(p) => patch(d.key, p)}
            templates={templates}
            parentTpl={parentTpl}
            problems={problemsFor(d)}
            showErrors={showErrors}
            testName={followupName(parentName, i + 1)}
          />
        </section>
      ))}

      {value.length > 0 && (
        <div className={s.inline}>
          <button type="button" className="pm2-btn sm" disabled={full} onClick={() => add(draftFromSuggestion({ stage: "read", hours: 48 }))}>
            <Plus size={14} aria-hidden /> Add another follow-up
          </button>
          <span className={s.help}>
            {full ? `Up to ${MAX_WIZARD_FOLLOWUPS} here. Add more later from the campaign page.` : `Up to ${MAX_WIZARD_FOLLOWUPS} here.`} Each person still gets at
            most 1 marketing message a day.
          </span>
        </div>
      )}

      {value.length > 0 && (
        <Card title="Your journey" basis="who gets what, and when">
          <JourneyFlow
            first={parentTpl ? friendlyTemplateName(parentTpl.name) : parentName}
            when={whenText}
            branches={value.map((d) => ({ key: d.key, hours: draftHours(d), stage: d.stage, templateName: nameOf(d.templateId) }))}
          />
        </Card>
      )}
    </div>
  );
}
