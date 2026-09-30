"use client";

// Guided template creator: a full-screen panel with 4 steps
//   1 Pick a starting point   2 Write your message
//   3 Picture and buttons     4 Check and send for approval
// New templates start at step 1; Edit & resubmit, Continue editing and
// Duplicate open at step 2 with everything prefilled. Work autosaves to this
// device; closing with unsaved changes asks first (pm ConfirmDialog).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, Save, Send, X } from "lucide-react";
import { NextStepCallout } from "@/components/guide";
import { ConfirmDialog } from "@/components/pm/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { friendlyTemplateName } from "@/lib/whatsapp/templateKind";
import { issuesFor, nextVersionName, validateTemplate, type Issue } from "@/lib/whatsapp/template-rules";
import {
  applyTitle, draftFingerprint, emptyDraft, toRulesDraft, type EditorDraft,
} from "@/lib/whatsapp/template-draft";
import { draftFromStarter } from "@/lib/whatsapp/template-starters";
import type { TemplateProblem } from "@/lib/whatsapp/template-errors";
import type { AutomaticWarning } from "@/lib/whatsapp/template-access";
import { saveDraft, submitToMeta } from "../api";
import { autosaveSlot, clearAutosave, readAutosave, savedAgo, useAutosave, type Autosaved } from "./autosave";
import { STEP_FIELDS, stepOfField } from "./fieldTypes";
import { PhonePreview } from "./PhonePreview";
import { StepCheck } from "./StepCheck";
import { StepMedia } from "./StepMedia";
import { StepStart } from "./StepStart";
import { StepWrite } from "./StepWrite";
import s from "../templates.module.css";

const STEPS = ["Starting point", "Message", "Picture and buttons", "Check and send"];
const TOTAL = STEPS.length;
const PREVIEW_ID = "tpl-live-preview";

export function TemplateCreator({
  initial,
  automatic = null,
  takenNames,
  onClose,
  onDone,
}: {
  /** null = brand-new template (starts at "Pick a starting point"). */
  initial: EditorDraft | null;
  /**
   * Set when editing or duplicating an automatic (utility) message: the
   * warning to show, and for order confirmations the name to type first.
   */
  automatic?: AutomaticWarning | null;
  /** Meta names already used by other templates. */
  takenNames: Set<string>;
  onClose: () => void;
  /** After a successful save or submit (the list refreshes). */
  onDone: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<EditorDraft>(() => initial ?? emptyDraft());
  const [baseline, setBaseline] = useState(() => draftFingerprint(initial ?? emptyDraft()));
  const [step, setStep] = useState(initial ? 1 : 0);
  const [maxStep, setMaxStep] = useState(initial ? TOTAL - 1 : 0);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [problem, setProblem] = useState<TemplateProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [typedName, setTypedName] = useState("");

  // Offer to resume unfinished work: for a new template (only when opened
  // fresh, not from Duplicate) or for the same template being edited.
  const slot = autosaveSlot(draft);
  const [resume, setResume] = useState<Autosaved | null>(() => {
    if (typeof window === "undefined") return null;
    if (initial && initial.mode === "new") return null;
    const saved = readAutosave(autosaveSlot(initial ?? emptyDraft()));
    return saved && draftFingerprint(saved.draft) !== draftFingerprint(initial ?? emptyDraft()) ? saved : null;
  });

  const dirty = draftFingerprint(draft) !== baseline;
  useAutosave(slot, draft, step, dirty);

  /* ---------- validation ---------- */
  const taken = useMemo(() => {
    const t = new Set(takenNames);
    if (draft.mode !== "new" && draft.name) t.delete(draft.name);
    return t;
  }, [takenNames, draft.mode, draft.name]);
  const validation = useMemo(() => validateTemplate(toRulesDraft(draft)), [draft]);
  const errors = useMemo(
    () => [...validation.errors, ...serverIssues.filter((x) => !validation.errors.some((e) => e.message === x.message))],
    [validation.errors, serverIssues],
  );
  const warnings = validation.warnings;
  const nameClash = draft.mode === "new" && draft.name && takenNames.has(draft.name) ? nextVersionName(draft.name, takenNames) : null;

  const visible = useCallback(
    (field: string) => revealed.has(stepOfField(field)) || touched.has(field) || touched.has(field.split(".")[0]),
    [revealed, touched],
  );
  const errorsFor = useCallback((field: string) => (visible(field) ? issuesFor(errors, field) : []), [errors, visible]);
  const warningsFor = useCallback((field: string) => issuesFor(warnings, field), [warnings]);
  const touch = useCallback((field: string) => setTouched((t) => (t.has(field) ? t : new Set(t).add(field))), []);

  const stepErrors = (st: number): Issue[] => {
    const fields = STEP_FIELDS[st];
    if (!fields) return [];
    const errs = errors.filter((e) => fields.some((f) => e.field === f || e.field.startsWith(f + ".")));
    if (st === 1 && nameClash) errs.unshift({ field: "name", message: "A template with this name already exists.", fix: `Try ${nameClash}.` });
    return errs;
  };
  const blocking = step > 0 && step < TOTAL - 1 ? stepErrors(step) : [];
  const needsTypedName = !!automatic?.confirmName && draft.mode === "edit";
  const typedOk = !needsTypedName || typedName.trim() === automatic?.confirmName;
  const canSubmit = errors.length === 0 && !nameClash && !busy && typedOk;

  /* ---------- editing ---------- */
  const update = useCallback((patch: Partial<EditorDraft>) => {
    setDraft((cur) => ({ ...cur, ...patch }));
    setServerIssues([]);
  }, []);

  function start(d: EditorDraft) {
    setDraft(d);
    setBaseline(draftFingerprint(emptyDraft()));
    setTouched(new Set());
    setRevealed(new Set());
    setResume(null);
    go(1);
  }

  /* ---------- navigation ---------- */
  const scrollRef = useRef<HTMLDivElement>(null);
  const headingFocus = useRef(false);
  function go(n: number) {
    setStep(n);
    setMaxStep((m) => Math.max(m, n));
    headingFocus.current = true;
  }
  useEffect(() => {
    if (!headingFocus.current) return;
    headingFocus.current = false;
    scrollRef.current?.scrollTo({ top: 0 });
    const h = scrollRef.current?.querySelector("h2");
    if (h instanceof HTMLElement) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }, [step]);

  function next() {
    if (blocking.length) {
      setRevealed((r) => new Set(r).add(step));
      setTouched((t) => { const n = new Set(t); for (const e of blocking) n.add(e.field); return n; });
      return;
    }
    go(Math.min(step + 1, TOTAL - 1));
  }

  function canJump(n: number): boolean {
    if (n === step) return false;
    if (n === 0) return !initial;
    if (n > maxStep) return false;
    if (n < step) return true;
    for (let st = Math.max(1, step); st < n; st++) if (stepErrors(st).length) return false;
    return true;
  }

  /* ---------- close ---------- */
  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }, [busy, dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || confirmClose || confirmSubmit) return;
      // An open help popover handles its own Escape.
      if (document.querySelector("[aria-controls][aria-expanded=true]")) return;
      requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose, confirmClose, confirmSubmit]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  /* ---------- server actions ---------- */
  async function doSaveDraft() {
    if (!draft.name) { toast.push({ kind: "error", text: "Give the template a name first." }); go(1); touch("name"); return; }
    setBusy(true);
    const r = await saveDraft(draft);
    setBusy(false);
    if (!r.ok) { toast.push({ kind: "error", text: `${r.problem.title}. ${r.problem.howToFix}` }); return; }
    clearAutosave(slot);
    toast.push({ kind: "success", text: "Draft saved. It stays here until you send it to Meta." });
    onDone();
  }

  async function doSubmit() {
    setConfirmSubmit(false);
    setProblem(null);
    setServerIssues([]);
    setBusy(true);
    const r = await submitToMeta(draft);
    setBusy(false);
    if (!r.ok) {
      if (r.issues?.length) { setServerIssues(r.issues); setRevealed(new Set([1, 2, 3])); }
      setProblem(r.problem);
      return;
    }
    clearAutosave(slot);
    toast.push({
      kind: "success",
      text: draft.mode === "edit"
        ? "Changes sent to Meta. We'll update the status here as soon as they reply."
        : "Sent to Meta for approval. Usually a few minutes, up to 24 hours. We'll update the status here automatically.",
    });
    onDone();
  }

  /* ---------- render ---------- */
  const approvedEdit = draft.mode === "edit" && draft.status === "approved";
  const title = draft.mode === "edit"
    ? `Edit and resubmit: ${friendlyTemplateName(draft.name)}`
    : draft.mode === "draft" ? `Continue: ${friendlyTemplateName(draft.name)}` : "New WhatsApp template";
  const stepProps = { d: draft, update, errorsFor, warningsFor, touch };
  const reason = blocking[0] ? `To continue: ${blocking[0].message}` : step === TOTAL - 1 && !canSubmit && !busy
    ? (!typedOk && errors.length === 0 && !nameClash ? `Type ${automatic?.confirmName} above to confirm.` : "Fix the items in the checklist to send it.")
    : "";

  return (
    <div className={s.overlay} role="dialog" aria-modal="true" aria-labelledby="tpl-creator-title">
      <div className={s.cTop}>
        <div className={s.cTopRow}>
          <h1 id="tpl-creator-title" className={s.cTitle}>{title}</h1>
          <button type="button" className="pm2-btn sm" onClick={requestClose} aria-label="Close the template editor">
            <X aria-hidden="true" /> Close
          </button>
        </div>
        <ol className={s.steps} aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} className={s.stepItem}>
              <button
                type="button"
                className={`${s.step} ${i === step ? s.stepOn : i < step || i <= maxStep ? s.stepDone : ""}`}
                aria-current={i === step ? "step" : undefined}
                disabled={!canJump(i) && i !== step}
                onClick={() => go(i)}
              >
                <b>STEP {i + 1}</b>{label}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className={s.cScroll} ref={scrollRef}>
        <div className={s.cInner}>
          <div className={s.cFull}>
            {automatic && (
              <div
                className={`${s.box} ${automatic.tone === "danger" ? s.boxBad : automatic.tone === "warn" ? s.boxWarn : s.boxInfo}`}
                role="note"
              >
                <div className={s.boxTitle}>{automatic.title}</div>
                <div className={s.typeConfirmBody}>
                  {automatic.lines.map((line) => <div key={line}>{line}</div>)}
                  {needsTypedName && step === TOTAL - 1 && (
                    <label className={s.typeConfirm}>
                      <span>
                        To resubmit, type the template name <b className={s.mono}>{automatic.confirmName}</b>
                      </span>
                      <input
                        className={s.input}
                        value={typedName}
                        onChange={(e) => setTypedName(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={`Type ${automatic.confirmName} to confirm`}
                      />
                    </label>
                  )}
                  {needsTypedName && step !== TOTAL - 1 && (
                    <div>You will be asked to type the template name before it is resubmitted.</div>
                  )}
                </div>
              </div>
            )}
            {resume && (
              <NextStepCallout
                tone="info"
                title="You have unfinished work on this template"
                body={`Saved on this device ${savedAgo(resume.savedAt)}.`}
                primary={{
                  label: "Continue where I left off",
                  onClick: () => {
                    setDraft(resume.draft);
                    setResume(null);
                    setMaxStep(TOTAL - 1);
                    go(Math.max(1, Math.min(resume.step, TOTAL - 1)));
                  },
                }}
                secondary={{ label: "Start fresh", onClick: () => { clearAutosave(autosaveSlot(resume.draft)); setResume(null); } }}
              />
            )}

            {step === 0 && (
              <StepStart
                total={TOTAL}
                onPick={(st) => start(draftFromStarter(st, takenNames))}
                onScratch={() => start(emptyDraft())}
              />
            )}

            {(step === 1 || step === 2) && (
              <div className={s.cGrid}>
                {step === 1 ? (
                  <StepWrite
                    {...stepProps}
                    total={TOTAL}
                    onTitle={(t) => update(applyTitle(draft, t, taken))}
                    nameClash={nameClash}
                    approvedEdit={approvedEdit}
                  />
                ) : (
                  <StepMedia {...stepProps} total={TOTAL} />
                )}
                <aside className={s.cSide} aria-label="Live preview">
                  <PhonePreview d={draft} id={PREVIEW_ID} />
                </aside>
              </div>
            )}

            {step === 3 && (
              <StepCheck
                d={draft}
                total={TOTAL}
                errors={errors}
                warnings={warnings}
                nameClash={nameClash}
                problem={problem}
                onDismissProblem={() => setProblem(null)}
                onGo={(n) => { setRevealed((r) => new Set(r).add(n)); go(n); }}
              />
            )}
          </div>
        </div>
      </div>

      {step > 0 && (
        <div className={s.cFoot}>
          <div className={s.cFootRow}>
            <span className={s.cReason} role="status">{reason}</span>
            <div className={s.cFootBtns}>
              {(step === 1 || step === 2) && (
                <button
                  type="button"
                  className={`pm2-btn ${s.previewJump}`}
                  aria-label="Preview"
                  onClick={() => document.getElementById(PREVIEW_ID)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  <Eye aria-hidden="true" /> <span className={s.btnLabel}>Preview</span>
                </button>
              )}
              <button type="button" className="pm2-btn" aria-label="Back" onClick={() => go(step - 1)} disabled={busy || (step === 1 && !canJump(0))}>
                <ArrowLeft aria-hidden="true" /> <span className={s.btnLabel}>Back</span>
              </button>
              {draft.mode !== "edit" && (
                <button type="button" className="pm2-btn" aria-label="Save draft" onClick={doSaveDraft} disabled={busy}>
                  <Save aria-hidden="true" /> <span className={s.btnLabel}>Save draft</span>
                </button>
              )}
              {step < TOTAL - 1 ? (
                <button
                  type="button"
                  className={`pm2-btn pri ${blocking.length ? s.btnBlocked : ""}`}
                  aria-disabled={blocking.length > 0}
                  onClick={next}
                >
                  Next <ArrowRight aria-hidden="true" />
                </button>
              ) : (
                <button type="button" className="pm2-btn pri" onClick={() => setConfirmSubmit(true)} disabled={!canSubmit}>
                  <Send aria-hidden="true" /> {busy ? "Sending..." : draft.mode === "edit" ? "Resubmit to Meta" : "Send for approval"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmSubmit && (
        <ConfirmDialog
          title={draft.mode === "edit" ? "Resubmit this template to Meta?" : "Send this template to Meta for approval?"}
          confirmLabel={draft.mode === "edit" ? "Resubmit" : "Send for approval"}
          keepLabel="Not yet"
          busy={busy}
          onClose={() => setConfirmSubmit(false)}
          onConfirm={doSubmit}
          body={
            <>
              {automatic && draft.mode === "edit" ? (
                <>
                  This is an automatic message. Meta usually reviews it in a few minutes to 24 hours, and while it is in review it is not sent
                  to customers, not even the old wording.
                </>
              ) : (
                <>
                  Nothing is sent to customers now. Meta usually reviews it in a few minutes to 24 hours, and you can use it
                  {automatic ? " in its automation" : " in campaigns"} once it shows Approved.
                </>
              )}
              {approvedEdit && " This counts toward Meta's limit of about 1 edit a day and 10 a month."}
            </>
          }
        />
      )}

      {confirmClose && (
        <ConfirmDialog
          title="Close without sending?"
          confirmLabel="Close"
          keepLabel="Keep editing"
          busy={false}
          onClose={() => setConfirmClose(false)}
          onConfirm={() => { setConfirmClose(false); onClose(); }}
          body="Your work so far is saved on this device. Open the same template again (or New template) to pick up where you left off."
        />
      )}
    </div>
  );
}
