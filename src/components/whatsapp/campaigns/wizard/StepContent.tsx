"use client";

// Step 2: campaign name, this campaign's picture/video/PDF, the template's
// blanks and buttons, optional AI personalisation.

import { Sparkles, UserRound } from "lucide-react";
import { Card } from "@/components/pm";
import { GlossaryTerm, HelpTip, StepHeader } from "@/components/guide";
import { MediaUploader } from "../../MediaUploader";
import { SAMPLE_NAME, mediaKindOf, templateFields, type CampaignTemplate } from "../logic";
import s from "../campaigns.module.css";

export type ContentValue = {
  name: string;
  vars: Record<string, string>;
  mediaUrl: string | null;
  ai: boolean;
  brief: string;
};

export function StepContent({
  tpl,
  value,
  onChange,
  problems,
  showErrors,
  step,
  total,
}: {
  step: number;
  total: number;
  tpl: CampaignTemplate;
  value: ContentValue;
  onChange: (patch: Partial<ContentValue>) => void;
  problems: { field: string; message: string }[];
  showErrors: boolean;
}) {
  const fields = templateFields(tpl);
  const kind = mediaKindOf(tpl);
  const errFor = (f: string) => (showErrors ? problems.filter((p) => p.field === f) : []);
  const setVar = (k: string, v: string) => onChange({ vars: { ...value.vars, [k]: v } });
  const bodyFields = fields.filter((f) => f.kind === "body");
  const otherFields = fields.filter((f) => f.kind !== "body");
  const engineErrs = errFor("engine");

  return (
    <div className={s.stack}>
      <StepHeader
        step={step}
        total={total}
        title="Fill in your message"
        why={
          <>
            The template has <GlossaryTerm k="blank_variable">blanks</GlossaryTerm> that you fill in for this campaign. The preview updates as
            you type and shows what a customer called {SAMPLE_NAME} would see.
          </>
        }
        glossary={["blank_variable", ...(kind ? (["header_media"] as const) : []), "marketing"]}
      />

      <Card title="Campaign name" basis="only your team sees this">
        <label className={s.field}>
          <span className="pm2-sr">Campaign name</span>
          <input
            className={`${s.input} ${errFor("name").length ? s.inputErr : ""}`}
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Diwali offer, loyal buyers"
            maxLength={120}
          />
          {errFor("name").map((p) => <span key={p.message} className={s.err}>{p.message}</span>)}
        </label>
      </Card>

      {kind && (
        <Card
          title={kind === "image" ? "Picture" : kind === "video" ? "Video" : "PDF"}
          basis="shown at the top of the message"
          right={<HelpTip term="header_media" />}
        >
          <div className={s.stack}>
            <p className={s.help} style={{ margin: 0 }}>
              You can use a new {kind === "document" ? "PDF" : kind} for every campaign without asking Meta again, as long as the text stays the same.
              {value.mediaUrl ? " This campaign uses the file below." : " Right now it uses the template's own file."}
            </p>
            <MediaUploader kind={kind} value={value.mediaUrl ?? tpl.header_media_url} onChange={(url) => onChange({ mediaUrl: url && url !== tpl.header_media_url ? url : null })} />
            {value.mediaUrl && (
              <button type="button" className="pm2-btn sm ghost" style={{ justifySelf: "start" }} onClick={() => onChange({ mediaUrl: null })}>
                Go back to the template&apos;s own {kind === "document" ? "PDF" : kind}
              </button>
            )}
            {errFor("media").map((p) => <span key={p.message} className={s.err}>{p.message}</span>)}
          </div>
        </Card>
      )}

      {(bodyFields.length > 0 || otherFields.length > 0) && (
        <Card title="Fill in the blanks" basis={`${fields.length} to fill`} right={<HelpTip term="blank_variable" />}>
          <div className={s.stack}>
            {[...otherFields.filter((f) => f.kind === "header"), ...bodyFields, ...otherFields.filter((f) => f.kind !== "header")].map((f) => {
              const errs = errFor(f.key);
              const aiFills = value.ai && f.kind === "body";
              const v = value.vars[f.key] ?? "";
              const isNameValue = v.trim().toLowerCase() === "{name}";
              return (
                <label key={f.key} className={s.field}>
                  <span className={s.label}>{f.label} <span className={s.muted} style={{ fontWeight: 400 }}>(required)</span></span>
                  <input
                    className={`${s.input} ${errs.length ? s.inputErr : ""}`}
                    value={v}
                    onChange={(e) => setVar(f.key, e.target.value)}
                    placeholder={aiFills ? "AI writes this per person (this text is the backup)" : f.placeholder}
                    inputMode={f.kind === "track" || f.kind === "button" ? "url" : undefined}
                    aria-invalid={errs.length > 0 || undefined}
                  />
                  <span className={s.help}>
                    {isNameValue ? `Each customer sees their own first name here (for example ${SAMPLE_NAME}).` : f.help}
                  </span>
                  {(f.kind === "body" || f.kind === "header") && !isNameValue && (
                    <span className={s.inline}>
                      <button type="button" className={s.miniChip} onClick={() => setVar(f.key, `${v.trimEnd()}${v.trim() ? " " : ""}{name}`)}>
                        <UserRound size={12} aria-hidden style={{ verticalAlign: -1 }} /> Insert customer first name
                      </button>
                    </span>
                  )}
                  {isNameValue && (
                    <span className={s.inline}>
                      <button type="button" className={s.miniChip} onClick={() => setVar(f.key, "")}>
                        Type my own text instead
                      </button>
                    </span>
                  )}
                  {errs.map((p) => <span key={p.message} className={s.err}>{p.message}</span>)}
                </label>
              );
            })}
            <p className={s.help} style={{ margin: 0 }}>
              <b>{"{name}"}</b> becomes each customer&apos;s first name, or &quot;there&quot; when we don&apos;t know it.
            </p>
          </div>
        </Card>
      )}

      {bodyFields.length > 0 && (
        <Card title="AI personalisation" basis="optional, most campaigns leave this off">
          <div className={s.stack}>
            <label className={s.check}>
              <input type="checkbox" checked={value.ai} onChange={(e) => onChange({ ai: e.target.checked })} />
              <span>
                <Sparkles size={14} aria-hidden style={{ verticalAlign: -2, color: "var(--pm-brand)" }} /> Let AI write the blanks for each person
                <span className={s.help} style={{ display: "block" }}>
                  It uses your brief and what we know about the customer. The text above is used if AI fails. Sending is slower, one AI call per person.
                </span>
              </span>
            </label>
            {value.ai && (
              <label className={s.field}>
                <span className={s.label}>Brief for the AI</span>
                <textarea
                  className={`${s.textarea} ${errFor("brief").length ? s.inputErr : ""}`}
                  rows={3}
                  value={value.brief}
                  onChange={(e) => onChange({ brief: e.target.value })}
                  placeholder="e.g. Suggest a snack based on what they bought before, mention the Diwali 15% offer, keep it short and warm."
                />
                {errFor("brief").map((p) => <span key={p.message} className={s.err}>{p.message}</span>)}
              </label>
            )}
          </div>
        </Card>
      )}

      {engineErrs.length > 0 && (
        <div className={s.danger} role="alert">
          {engineErrs.map((p) => <div key={p.message}>{p.message}</div>)}
        </div>
      )}
    </div>
  );
}
