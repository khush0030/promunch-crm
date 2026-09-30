"use client";

// One follow-up as a sentence: "After [2] [days] send [message] to people who
// [read it]", then its picture and blanks, a phone preview and a test send.
// Shared by the wizard's Follow-ups step and the "Add a follow-up" drawer.

import { useId } from "react";
import { AlertTriangle } from "lucide-react";
import { friendlyTemplateName } from "@/lib/whatsapp/templateKind";
import { CampaignPreview } from "../bits";
import {
  FOLLOWUP_STAGES,
  delayWarning,
  draftHours,
  stageDescription,
  stageDisabledReason,
  type DelayUnit,
  type FollowupDraft,
} from "../journey";
import { buildTemplateVars, initialVars, type CampaignTemplate } from "../logic";
import { ContentFields } from "../wizard/StepContent";
import { TestSendPanel } from "../wizard/TestSendPanel";
import type { FollowupStage } from "../../types";
import s from "../campaigns.module.css";

type ButtonLike = { type?: string | null; url?: string | null };

export function FollowupSentence({
  draft,
  onChange,
  templates,
  parentTpl,
  problems,
  showErrors,
}: {
  draft: FollowupDraft;
  onChange: (patch: Partial<FollowupDraft>) => void;
  templates: CampaignTemplate[];
  parentTpl: { buttons?: ButtonLike[] | null } | null | undefined;
  problems: { field: string; message: string }[];
  showErrors: boolean;
}) {
  const uid = useId();
  const hours = draftHours(draft);
  const warn = hours != null ? delayWarning(hours) : null;
  const errFor = (f: string) => (showErrors ? problems.filter((p) => p.field === f) : []);
  const known = templates.some((t) => t.id === draft.templateId);

  function pickTemplate(id: string) {
    const t = templates.find((x) => x.id === id) ?? null;
    onChange({ templateId: t?.id ?? null, vars: t ? initialVars(t) : {}, mediaUrl: null });
  }

  return (
    <div className={s.stack} style={{ gap: 8 }}>
      <div className={s.sentence}>
        <span>After</span>
        <label>
          <span className="pm2-sr">How long to wait</span>
          <input
            id={`${uid}-amt`}
            className={`${s.input} ${s.sentNum} ${errFor("delay").length ? s.inputErr : ""}`}
            inputMode="numeric"
            value={draft.amount}
            onChange={(e) => onChange({ amount: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
            aria-invalid={errFor("delay").length > 0 || undefined}
          />
        </label>
        <label>
          <span className="pm2-sr">Hours or days</span>
          <select className={s.select} value={draft.unit} onChange={(e) => onChange({ unit: e.target.value as DelayUnit })}>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </label>
        <span>send</span>
        <label className={s.sentTpl}>
          <span className="pm2-sr">Message to send</span>
          <select
            className={`${s.select} ${errFor("template").length ? s.inputErr : ""}`}
            style={{ width: "100%" }}
            value={known ? draft.templateId ?? "" : ""}
            onChange={(e) => pickTemplate(e.target.value)}
          >
            <option value="">Pick a message…</option>
            {[...templates]
              .sort((a, b) => friendlyTemplateName(a.name).localeCompare(friendlyTemplateName(b.name)))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {friendlyTemplateName(t.name)}
                </option>
              ))}
          </select>
        </label>
        <span>to people who</span>
        <label className={s.sentStage}>
          <span className="pm2-sr">Who gets it</span>
          <select
            className={`${s.select} ${errFor("stage").length ? s.inputErr : ""}`}
            style={{ width: "100%" }}
            value={draft.stage}
            onChange={(e) => onChange({ stage: e.target.value as FollowupStage })}
          >
            {FOLLOWUP_STAGES.map((st) => {
              const off = stageDisabledReason(st.key, parentTpl);
              return (
                <option key={st.key} value={st.key} disabled={!!off && st.key !== draft.stage}>
                  {st.who}
                  {off ? " (needs a tracked link)" : ""}
                </option>
              );
            })}
          </select>
        </label>
      </div>
      <div className={s.help}>{stageDescription(draft.stage)}</div>
      {stageDisabledReason("clicked", parentTpl) && (
        <div className={s.help}>The &quot;tapped the link&quot; choices are off. {stageDisabledReason("clicked", parentTpl)}</div>
      )}
      {[...errFor("delay"), ...errFor("stage"), ...errFor("template")].map((p) => (
        <span key={p.field + p.message} className={s.err}>{p.message}</span>
      ))}
      {warn && (
        <div className={s.warn} role="note">
          <AlertTriangle size={14} aria-hidden style={{ verticalAlign: -2 }} /> {warn}
        </div>
      )}
    </div>
  );
}

export function FollowupEditor({
  draft,
  onChange,
  templates,
  parentTpl,
  problems,
  showErrors,
  testName,
  warning,
}: {
  /** Shown at once, e.g. "exactly the same as the main message". */
  warning?: string | null;
  draft: FollowupDraft;
  onChange: (patch: Partial<FollowupDraft>) => void;
  templates: CampaignTemplate[];
  parentTpl: { buttons?: ButtonLike[] | null } | null | undefined;
  problems: { field: string; message: string }[];
  showErrors: boolean;
  testName: string;
}) {
  const tpl = templates.find((t) => t.id === draft.templateId) ?? null;
  const contentProblems = problems.filter((p) => !["delay", "stage", "template"].includes(p.field));
  const engineErrs = showErrors ? problems.filter((p) => p.field === "engine") : [];
  const testDraft = tpl
    ? { template_id: tpl.id, template_vars: buildTemplateVars(draft.vars, false, "", tpl), header_media_url: draft.mediaUrl, name: testName }
    : null;

  return (
    <div className={s.stack}>
      <FollowupSentence draft={draft} onChange={onChange} templates={templates} parentTpl={parentTpl} problems={problems} showErrors={showErrors} />
      {warning && <div className={s.danger} role="alert">{warning}</div>}
      {tpl && (
        <div className={s.fuBody}>
          <div className={s.stack}>
            <ContentFields
              compact
              allowAi={false}
              tpl={tpl}
              value={{ vars: draft.vars, mediaUrl: draft.mediaUrl }}
              onChange={(p) => onChange({ ...(p.vars ? { vars: p.vars } : {}), ...("mediaUrl" in p ? { mediaUrl: p.mediaUrl ?? null } : {}) })}
              problems={contentProblems}
              showErrors={showErrors}
            />
            {engineErrs.length > 0 && (
              <div className={s.danger} role="alert">{engineErrs.map((p) => <div key={p.message}>{p.message}</div>)}</div>
            )}
            <details className={s.details}>
              <summary>Send yourself a test of this follow-up</summary>
              <div style={{ marginTop: 8 }}>
                <TestSendPanel
                  bare
                  draft={testDraft}
                  disabledReason={contentProblems.length ? "Fill in the blanks and picture above first." : null}
                />
              </div>
            </details>
          </div>
          <CampaignPreview tpl={tpl} vars={draft.vars} mediaUrl={draft.mediaUrl} />
        </div>
      )}
    </div>
  );
}
