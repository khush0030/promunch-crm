"use client";

// Step 2: title, message with labelled blanks and their examples, language,
// and Marketing vs Utility.

import { useRef, useState } from "react";
import { Bold, Check, Italic, Plus, Strikethrough, UserRound, Wand2, X } from "lucide-react";
import { GlossaryTerm, HelpTip, StepHeader } from "@/components/guide";
import {
  BODY_MAX, TEMPLATE_LANGUAGES, isMarketingCategory, languageLabel, varNumbers,
} from "@/lib/whatsapp/template-rules";
import {
  FIRST_NAME_LABEL, FIRST_NAME_SAMPLE, blanksNeedRenumber, insertBlank, renumberBlanks,
} from "@/lib/whatsapp/template-draft";
import { friendlyTemplateName } from "@/lib/whatsapp/templateKind";
import { IssueList } from "../bits";
import type { StepProps } from "./fieldTypes";
import s from "../templates.module.css";

export function StepWrite({
  d, update, errorsFor, warningsFor, touch, total, onTitle, nameClash, approvedEdit,
}: StepProps & {
  total: number;
  onTitle: (title: string) => void;
  nameClash: string | null;
  approvedEdit: boolean;
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [editName, setEditName] = useState(false);
  const vars = varNumbers(d.body);
  const bodyErr = errorsFor("body");

  function wrap(mark: string) {
    const el = bodyRef.current;
    const src = d.body;
    const a = el?.selectionStart ?? src.length;
    const b = el?.selectionEnd ?? src.length;
    const sel = src.slice(a, b) || "text";
    update({ body: src.slice(0, a) + mark + sel + mark + src.slice(b) });
    touch("body");
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + mark.length, a + mark.length + sel.length); });
  }

  function addBlank(kind: "first_name" | "custom") {
    const el = bodyRef.current;
    const at = el ? el.selectionStart ?? d.body.length : d.body.length;
    const r = insertBlank(d.body, at, kind);
    const k = String(r.n);
    update({
      body: r.body,
      blankLabels: { ...d.blankLabels, [k]: kind === "first_name" ? FIRST_NAME_LABEL : "" },
      bodySamples: { ...d.bodySamples, [k]: kind === "first_name" ? FIRST_NAME_SAMPLE : "" },
    });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(r.cursor, r.cursor); });
  }

  function removeBlank(n: number) {
    const cleaned = d.body.replace(new RegExp(`\\s?\\{\\{${n}\\}\\}`, "g"), "");
    const r = renumberBlanks(cleaned, d.bodySamples, d.blankLabels);
    update({ body: r.body, bodySamples: r.samples, blankLabels: r.labels });
    touch("body");
  }

  function fixNumbers() {
    const r = renumberBlanks(d.body, d.bodySamples, d.blankLabels);
    update({ body: r.body, bodySamples: r.samples, blankLabels: r.labels });
  }

  const marketing = isMarketingCategory(d.category);

  return (
    <div className={s.cMain}>
      <StepHeader
        step={2}
        total={total}
        title="Write your message"
        why="Keep it short and friendly. Use blanks for anything that changes per customer or per campaign."
        glossary={["blank_variable", "marketing", "utility"]}
      />

      {d.mode === "edit" && (
        <div className={`${s.box} ${s.boxInfo}`}>
          {approvedEdit ? (
            <span>
              Editing an approved template sends it back to Meta for review. Meta allows about <strong>1 edit a day and 10 a month</strong>,
              and the type (Marketing or Utility) can&apos;t change. Campaigns can&apos;t use it until Meta approves the change.
              To keep the current version sending, close this and use Duplicate as new version instead.
            </span>
          ) : (
            <span>This fixes the template at Meta under the same name and sends it for review again. The name and language can&apos;t change.</span>
          )}
        </div>
      )}

      <section className={s.section}>
        {d.mode === "edit" ? (
          <div className={s.field}>
            <span className={s.label}>Template</span>
            <div>{friendlyTemplateName(d.name)} <span className={s.mono}>{d.name} · {languageLabel(d.language)}</span></div>
          </div>
        ) : (
          <div className={s.field}>
            <label className={s.label} htmlFor="tpl-title">Name for your team</label>
            <input
              id="tpl-title"
              className={`${s.input} ${errorsFor("name").length || nameClash ? s.inputErr : ""}`}
              value={d.title}
              placeholder="Diwali offer 2026"
              onChange={(e) => onTitle(e.target.value)}
              onBlur={() => touch("name")}
            />
            <div className={s.hint}>
              Customers never see this. Meta&apos;s name: <span className={s.mono}>{d.name || "..."}</span>{" "}
              <button type="button" className="pm2-btn sm ghost" onClick={() => setEditName((v) => !v)}>
                {editName ? "Done" : "Change"}
              </button>
            </div>
            {editName && (
              <input
                className={s.input}
                aria-label="Name at Meta"
                value={d.name}
                onChange={(e) => update({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"), nameTouched: true })}
                onBlur={() => touch("name")}
              />
            )}
            {nameClash && (
              <IssueList tone="error" issues={[{ field: "name", message: "A template with this name already exists.", fix: `Try ${nameClash}.` }]} />
            )}
            <IssueList tone="error" issues={errorsFor("name")} />
          </div>
        )}

        {d.mode !== "edit" && (
          <div className={s.field}>
            <label className={s.label} htmlFor="tpl-lang">Language the message is written in</label>
            <select id="tpl-lang" className={s.select} value={d.language} onChange={(e) => { update({ language: e.target.value }); touch("language"); }}>
              {!TEMPLATE_LANGUAGES.some((l) => l.code === d.language) && <option value={d.language}>{d.language}</option>}
              {TEMPLATE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <IssueList tone="error" issues={errorsFor("language")} />
          </div>
        )}
      </section>

      <section className={s.section} aria-labelledby="tpl-msg">
        <h3 id="tpl-msg" className={s.sectionTitle}>Your message</h3>
        <div className={s.editorBar}>
          <button type="button" className={s.fmtBtn} onClick={() => wrap("*")} aria-label="Bold" title="Bold"><Bold aria-hidden="true" /></button>
          <button type="button" className={s.fmtBtn} onClick={() => wrap("_")} aria-label="Italic" title="Italic"><Italic aria-hidden="true" /></button>
          <button type="button" className={s.fmtBtn} onClick={() => wrap("~")} aria-label="Strikethrough" title="Strikethrough"><Strikethrough aria-hidden="true" /></button>
          <span className={s.hint}>Insert blank:</span>
          <button type="button" className="pm2-btn sm" onClick={() => addBlank("first_name")}><UserRound aria-hidden="true" /> Customer first name</button>
          <button type="button" className="pm2-btn sm" onClick={() => addBlank("custom")}><Plus aria-hidden="true" /> Custom blank</button>
          <HelpTip term="blank_variable" />
          <span className={`${s.counter} ${d.body.length > BODY_MAX ? s.counterOver : ""}`}>{d.body.length}/{BODY_MAX}</span>
        </div>
        <textarea
          ref={bodyRef}
          aria-label="Message"
          className={`${s.textarea} ${bodyErr.length ? s.inputErr : ""}`}
          value={d.body}
          rows={7}
          placeholder="Hi {{1}}, something new just landed at PROMUNCH. Tap below to take a look."
          onChange={(e) => update({ body: e.target.value })}
          onBlur={() => touch("body")}
        />
        <div className={s.hint}>Emojis are fine here. Wrap words in *stars* for bold. No long dashes in PROMUNCH copy.</div>
        <IssueList tone="error" issues={bodyErr} />
        <IssueList tone="warning" issues={warningsFor("body")} />
        {blanksNeedRenumber(d.body) && (
          <div>
            <button type="button" className="pm2-btn sm" onClick={fixNumbers}><Wand2 aria-hidden="true" /> Fix blank numbering for me</button>
          </div>
        )}

        {vars.length > 0 && (
          <div className={s.stackTight}>
            <div className={s.label}>Your blanks</div>
            <div className={s.help}>
              Name each blank so your team knows what to fill in, and give an example. The real value is filled in when a campaign sends.
            </div>
            {vars.map((n) => {
              const k = String(n);
              return (
                <div key={k} className={s.blankRow}>
                  <span className={`${s.blank} ${s.blankTag}`}>{d.blankLabels[k] || `Blank ${n}`}</span>
                  <div className={s.field}>
                    <label className={s.hint} htmlFor={`bl-${k}`}>What goes here?</label>
                    <input
                      id={`bl-${k}`}
                      className={s.input}
                      value={d.blankLabels[k] ?? ""}
                      placeholder="Product name"
                      onChange={(e) => update({ blankLabels: { ...d.blankLabels, [k]: e.target.value } })}
                    />
                  </div>
                  <div className={s.field}>
                    <label className={s.hint} htmlFor={`bs-${k}`}>Example of what goes here (Meta&apos;s reviewer sees this)</label>
                    <input
                      id={`bs-${k}`}
                      className={`${s.input} ${errorsFor("body_samples").length && !(d.bodySamples[k] ?? "").trim() ? s.inputErr : ""}`}
                      value={d.bodySamples[k] ?? ""}
                      placeholder={n === 1 ? FIRST_NAME_SAMPLE : "Roasted Edamame"}
                      onChange={(e) => update({ bodySamples: { ...d.bodySamples, [k]: e.target.value } })}
                      onBlur={() => touch("body_samples")}
                    />
                  </div>
                  <button type="button" className={`pm2-btn sm ${s.iconOnly}`} onClick={() => removeBlank(n)} aria-label={`Remove blank ${n}`} title="Remove this blank">
                    <X aria-hidden="true" />
                  </button>
                </div>
              );
            })}
            <IssueList tone="error" issues={errorsFor("body_samples")} />
            <IssueList tone="warning" issues={warningsFor("body_samples")} />
          </div>
        )}
      </section>

      <section className={s.section} aria-labelledby="tpl-type">
        <h3 id="tpl-type" className={s.sectionTitle}>
          Type of message <HelpTip text="Meta charges and limits these differently. Pick Marketing for anything that sells or promotes." />
        </h3>
        <div className={s.choices2}>
          {([
            { key: "marketing", title: "Marketing", text: "Offers, launches, restocks, reminders to buy. We add the STOP line for you." },
            { key: "utility", title: "Utility", text: "Only order or delivery updates the customer expects. No offers or sales words." },
          ] as const).map((c) => {
            const on = c.key === "marketing" ? marketing : d.category === "utility";
            const locked = approvedEdit && !on;
            return (
              <button
                key={c.key}
                type="button"
                className={`${s.choice} ${on ? s.choiceOn : ""}`}
                aria-pressed={on}
                disabled={locked}
                onClick={() => { update({ category: c.key === "marketing" && d.category === "offer" ? "offer" : c.key }); touch("category"); }}
              >
                <span className={s.choiceTitle}>{on && <Check aria-hidden="true" />}{c.title}</span>
                <span className={s.choiceText}>{c.text}</span>
              </button>
            );
          })}
        </div>
        <div className={s.hint}>
          Not sure? Read what <GlossaryTerm k="marketing">marketing</GlossaryTerm> and <GlossaryTerm k="utility">utility</GlossaryTerm> mean.
          Campaigns can only send Marketing templates.
        </div>
        <IssueList tone="error" issues={errorsFor("category")} />
        <IssueList tone="warning" issues={warningsFor("category")} />
      </section>
    </div>
  );
}
