"use client";

// Step 4: plain-English checklist from validateTemplate, final preview and
// "what happens next".

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { GlossaryTerm, PlainSummary, StepHeader } from "@/components/guide";
import type { Issue } from "@/lib/whatsapp/template-rules";
import type { EditorDraft } from "@/lib/whatsapp/template-draft";
import type { TemplateProblem } from "@/lib/whatsapp/template-errors";
import { ProblemBox } from "../bits";
import { PhonePreview } from "./PhonePreview";
import { stepOfField } from "./fieldTypes";
import s from "../templates.module.css";

const STEP_NAME: Record<number, string> = { 1: "Write your message", 2: "Picture and buttons" };

function Row({ issue, tone, onGo }: { issue: Issue; tone: "error" | "warning"; onGo: (step: number) => void }) {
  const step = stepOfField(issue.field);
  return (
    <li className={s.checkRow}>
      {tone === "error" ? <XCircle className={s.errIcon} aria-label="Must fix" /> : <AlertTriangle className={s.warnIcon} aria-label="Worth checking" />}
      <span className={s.checkText}>
        {issue.message}
        {issue.fix && <span className={s.issueFix}> {issue.fix}</span>}
      </span>
      <button type="button" className="pm2-btn sm" onClick={() => onGo(step)}>Fix in &quot;{STEP_NAME[step]}&quot;</button>
    </li>
  );
}

export function StepCheck({
  d, total, errors, warnings, nameClash, problem, onDismissProblem, onGo,
}: {
  d: EditorDraft;
  total: number;
  errors: Issue[];
  warnings: Issue[];
  nameClash: string | null;
  problem: TemplateProblem | null;
  onDismissProblem: () => void;
  onGo: (step: number) => void;
}) {
  const allErrors: Issue[] = nameClash
    ? [{ field: "name", message: "A template with this name already exists.", fix: `Try ${nameClash}.` }, ...errors]
    : errors;
  const ok = allErrors.length === 0;

  return (
    <div className={s.cGrid}>
      <div className={s.cMain}>
        <StepHeader
          step={4}
          total={total}
          title="Check and send for approval"
          why="Meta has to approve every template before we can send it. We checked it against every rule we know, so it has the best chance first time."
          glossary={["approval", "stop_footer"]}
        />
        {problem && <ProblemBox problem={problem} onClose={onDismissProblem} />}

        <section className={s.section} aria-labelledby="tpl-checks">
          <h3 id="tpl-checks" className={s.sectionTitle}>Checklist</h3>
          {ok ? (
            <div className={`${s.box} ${s.boxGood}`}>
              <span className={s.boxTitle}><span className={s.inline}><CheckCircle2 aria-hidden="true" className={s.okIcon} /> Passes every check we know of. Ready to send to Meta.</span></span>
            </div>
          ) : (
            <div className={s.help}>Fix {allErrors.length} thing{allErrors.length === 1 ? "" : "s"} before sending:</div>
          )}
          {allErrors.length > 0 && (
            <ul className={s.issues}>
              {allErrors.map((e, i) => <Row key={`e${i}`} issue={e} tone="error" onGo={onGo} />)}
            </ul>
          )}
          {warnings.length > 0 && (
            <>
              <div className={s.help}>Worth checking (these won&apos;t stop you sending):</div>
              <ul className={s.issues}>
                {warnings.map((w, i) => <Row key={`w${i}`} issue={w} tone="warning" onGo={onGo} />)}
              </ul>
            </>
          )}
        </section>

        <PlainSummary
          title="What happens next"
          sentences={[
            "Meta usually reviews it in a few minutes to 24 hours.",
            "We'll update the status here automatically. Nothing is sent to customers now.",
            <>You can use it in campaigns once it shows <strong>Approved</strong>.</>,
            d.mode === "edit" && d.status === "approved"
              ? "This edit counts toward Meta's limit of about 1 edit a day and 10 a month."
              : null,
          ].filter(Boolean)}
        />
      </div>
      <aside className={s.cSide} aria-label="Final preview">
        <PhonePreview d={d} />
        <div className={s.hint}>
          The <GlossaryTerm k="stop_footer">STOP footer</GlossaryTerm> and link tracking are added for you. You don&apos;t need to type them.
        </div>
      </aside>
    </div>
  );
}
