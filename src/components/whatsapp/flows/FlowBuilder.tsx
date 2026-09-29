"use client";

// Guided builder for a custom automation: 1 Trigger, 2 Wait, 3 Message,
// 4 Review. New automations are saved OFF (a draft); they only start
// messaging customers after an explicit "Turn on" with a confirmation.

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, PackageCheck, Plus, Send, ShoppingCart, Trash2, Truck, type LucideIcon } from "lucide-react";
import { FlowTimeline, GlossaryTerm, HelpTip, NextStepCallout, PlainSummary, StepHeader } from "@/components/guide";
import { useToast } from "@/components/ui/Toast";
import { apiFetch } from "@/lib/api-fetch";
import type { Template } from "../types";
import { DurationInput, Field, PreviewTabs } from "./bits";
import { customFlowSteps } from "./CustomFlowCard";
import {
  blankKeys, draftFromFlow, fillBody, fillSample, flowTemplateOptions, friendlyDuration, friendlyTemplateName,
  gapsError, missingBlanks, normalizeTestNumber, stepsPayload, tokensFor, TRIGGER_TEXT, type DraftMessage, type Recipe,
} from "./logic";
import type { CustomFlow, TriggerEvent, TplRow } from "./types";
import s from "./flows.module.css";

const TRIGGERS: Array<{ key: TriggerEvent; icon: LucideIcon; sub: string }> = [
  { key: "order_placed", icon: PackageCheck, sub: "Good for thank-you notes and tips on how to enjoy the snacks." },
  { key: "order_fulfilled", icon: Truck, sub: "Good for cross-sells and \"how are you liking it?\" messages a few days later." },
  { key: "checkout_abandoned", icon: ShoppingCart, sub: "The built-in cart reminder already messages these people, so only add this for something different." },
];

const STEP_TITLES = ["What starts it", "How long to wait", "What to send", "Check and save"] as const;
const MAX_MESSAGES = 5;

type TemplateVar = { name?: string; sample?: string };

function blankHint(t: Template | undefined, key: string): string | undefined {
  const vars = Array.isArray(t?.variables) ? (t?.variables as TemplateVar[]) : [];
  const hit = vars[Number(key) - 1] ?? vars.find((v) => v?.name === key);
  return hit?.sample ? `e.g. ${hit.sample}` : undefined;
}

export function FlowBuilder({ initial, recipe, templates, statusRows, onDone, onCancel }: {
  initial: CustomFlow | null;
  recipe: Recipe | null;
  templates: Template[];
  statusRows: TplRow[];
  onDone: (saved: CustomFlow) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const preset = recipe?.availability.kind === "custom" ? recipe.availability : null;
  const [step, setStep] = useState(1);
  const [trigger, setTrigger] = useState<TriggerEvent>(initial?.trigger_event ?? preset?.trigger ?? "order_fulfilled");
  const [name, setName] = useState(initial?.name ?? preset?.name ?? "");
  const [messages, setMessages] = useState<DraftMessage[]>(
    initial ? draftFromFlow(initial) : [{ gapHours: preset?.waitHours ?? 72, template: "", language: "en", vars: {} }],
  );
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => flowTemplateOptions(templates), [templates]);
  const byName = useMemo(() => new Map(templates.map((t) => [t.name, t])), [templates]);
  const bodyOf = (n: string) => byName.get(n)?.body ?? "";
  const tokens = tokensFor(trigger);

  const waitErr = gapsError(messages.map((m) => m.gapHours));
  const noTemplate = messages.findIndex((m) => !m.template);
  const blanksLeft = missingBlanks(messages, bodyOf);
  const nameErr = name.trim().length < 2 ? "Give it a short name so your team can find it." : null;
  const canReach = [true, true, !waitErr, !waitErr && noTemplate < 0 && blanksLeft.length === 0];

  function patchMsg(i: number, p: Partial<DraftMessage>) {
    setMessages((ms) => ms.map((m, j) => (j === i ? { ...m, ...p } : m)));
  }

  async function save() {
    if (nameErr || waitErr || noTemplate >= 0 || blanksLeft.length) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        trigger_event: trigger,
        steps: stepsPayload(messages, bodyOf, (n) => byName.get(n)?.language),
      };
      const j = await apiFetch<{ flow: CustomFlow }>(
        initial ? `/api/whatsapp/flows/custom/${initial.id}` : "/api/whatsapp/flows/custom",
        { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      toast.push({
        kind: "success",
        text: initial
          ? `Saved "${body.name}". Changes apply to customers who start it from now on.`
          : `Saved "${body.name}" as a draft. It is off and sends nothing until you turn it on.`,
      });
      onDone(j.flow);
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Couldn't save the automation." });
    } finally {
      setSaving(false);
    }
  }

  const draftFlow = { trigger_event: trigger, steps: stepsPayload(messages, bodyOf, () => "en") };

  return (
    <section className={s.builder} aria-label={initial ? "Edit automation" : "New automation"}>
      <div className={s.builderTop}>
        <button type="button" className="pm2-btn sm" onClick={onCancel}><ArrowLeft aria-hidden="true" /> Back to automations</button>
        <ol className={s.stepper} aria-label="Steps">
          {STEP_TITLES.map((t, i) => (
            <li key={t}>
              <button type="button" className={s.stepDot} aria-current={step === i + 1 ? "step" : undefined}
                disabled={!canReach.slice(0, i + 1).every(Boolean)} onClick={() => setStep(i + 1)}>
                {i + 1}. {t}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className={`pm2-panel ${s.card}`}>
        {step === 1 && (
          <>
            <StepHeader step={1} total={4} title="What starts this automation?" glossary={["trigger"]}
              why="Pick the moment a customer enters it. Each customer enters at most once per order or cart." />
            <div className={s.choices} role="radiogroup" aria-label="Trigger">
              {TRIGGERS.map((t) => {
                const locked = !!initial && initial.trigger_event !== t.key;
                return (
                  <button key={t.key} type="button" role="radio" aria-checked={trigger === t.key} className={s.choice}
                    disabled={locked} onClick={() => setTrigger(t.key)}>
                    <t.icon aria-hidden="true" />
                    <span>
                      <span className={s.choiceTitle}>{TRIGGER_TEXT[t.key].when}</span>
                      <span className={s.choiceSub}>{t.sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {initial && <span className={s.hint}>The starting point can&apos;t change on a saved automation. Make a new one instead.</span>}
            <p className={s.hint}>
              Want to start from a popup sign-up or &quot;hasn&apos;t ordered in a while&quot;? Those are coming soon.
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <StepHeader step={2} total={4} title="How long should we wait?" glossary={["wait"]}
              why="Each wait is counted from the step before it. Up to 5 messages, all within 90 days." />
            {messages.map((m, i) => (
              <div key={i} className={s.msgBox}>
                <div className={s.msgHead}>
                  <span>Message {i + 1}</span>
                  {messages.length > 1 && (
                    <button type="button" className="pm2-btn sm ghost" aria-label={`Remove message ${i + 1}`}
                      onClick={() => setMessages((ms) => ms.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden="true" /> Remove
                    </button>
                  )}
                </div>
                <Field label={i === 0 ? `Wait after "${TRIGGER_TEXT[trigger].short.toLowerCase()}"` : `Wait after message ${i}`}>
                  <DurationInput label={`Message ${i + 1} wait`} hours={m.gapHours} min={i === 0 ? 0 : 0.25} max={24 * 90}
                    onChange={(h) => patchMsg(i, { gapHours: h })} />
                </Field>
                <span className={s.hint}>{i === 0 && m.gapHours === 0 ? "Sends right away." : `Sends ${friendlyDuration(m.gapHours)} later.`}</span>
              </div>
            ))}
            {waitErr && <span className={s.err} role="alert">{waitErr}</span>}
            {messages.length < MAX_MESSAGES && (
              <button type="button" className="pm2-btn sm" onClick={() =>
                setMessages((ms) => [...ms, { gapHours: 48, template: "", language: "en", vars: {} }])}>
                <Plus aria-hidden="true" /> Add a follow-up message
              </button>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <StepHeader step={3} total={4} title="What should we send?" glossary={["template", "blank_variable", "marketing_cap"]}
              why="Only approved marketing messages can be used. Fill each blank with words, or tap a chip to use the customer's details." />
            {options.length === 0 && (
              <NextStepCallout tone="warn" title="No approved marketing messages yet"
                body="Create one in Templates and wait for Meta to approve it (usually a few minutes to a day)."
                primary={{ label: "Go to Templates", href: "/dashboard/whatsapp?tab=templates" }} />
            )}
            {messages.map((m, i) => {
              const t = byName.get(m.template);
              const keys = blankKeys(t?.body);
              const offList = m.template !== "" && !options.some((o) => o.name === m.template);
              return (
                <div key={i} className={s.msgBox}>
                  <div className={s.msgHead}><span>Message {i + 1}</span><span className={s.hint}>{friendlyDuration(m.gapHours)} {i === 0 ? "after it starts" : "after the one before"}</span></div>
                  <Field label="Message">
                    <select className={`${s.select} ${s.wide}`} value={m.template} aria-label={`Message ${i + 1}`}
                      onChange={(e) => patchMsg(i, { template: e.target.value, vars: {} })}>
                      <option value="">Pick an approved message</option>
                      {options.map((o) => <option key={o.id} value={o.name}>{friendlyTemplateName(o.name)}</option>)}
                      {offList && <option value={m.template}>{friendlyTemplateName(m.template)} (not an approved marketing message)</option>}
                    </select>
                  </Field>
                  {offList && <span className={s.err}>This message is not an approved marketing message any more. Pick another one.</span>}
                  {keys.map((k) => (
                    <div key={k} className={s.blank}>
                      <label className={s.fieldLabel} htmlFor={`b-${i}-${k}`}>Blank {k}</label>
                      <input id={`b-${i}-${k}`} className={`${s.text} ${s.blankInput}`} value={m.vars[k] ?? ""}
                        placeholder={blankHint(t, k) ?? "Type words, or tap a chip below"}
                        onChange={(e) => patchMsg(i, { vars: { ...m.vars, [k]: e.target.value } })} />
                      <div className={s.tokens}>
                        <span className={s.hint}>Insert:</span>
                        {tokens.map((tk) => (
                          <button key={tk.token} type="button" className={s.token}
                            onClick={() => patchMsg(i, { vars: { ...m.vars, [k]: `${(m.vars[k] ?? "").trimEnd()}${(m.vars[k] ?? "").trim() ? " " : ""}${tk.token}` } })}>
                            {tk.label}
                          </button>
                        ))}
                      </div>
                      {(m.vars[k] ?? "").includes("{") && (
                        <span className={s.hint}>Customer sees: {fillSample(m.vars[k] ?? "")}</span>
                      )}
                    </div>
                  ))}
                  {t?.body && (
                    <span className={s.hint}>
                      Reads as: {fillBody(t.body, Object.fromEntries(keys.map((k) => [k, fillSample(m.vars[k] ?? "")])), (k) => `[blank ${k}]`)}
                    </span>
                  )}
                </div>
              );
            })}
            {noTemplate >= 0 && <span className={s.hint}>Pick a message for message {noTemplate + 1}.</span>}
            {noTemplate < 0 && blanksLeft.length > 0 && <span className={s.err}>Fill every blank: {blanksLeft.join(", ")}. Empty blanks are rejected by Meta.</span>}
          </>
        )}

        {step === 4 && (
          <>
            <StepHeader step={4} total={4} title="Check it and save" glossary={["test_send"]}
              why={initial ? "Saving keeps it on or off as it is now." : "It saves switched off. Nothing is sent until you turn it on."} />
            <Field label="Name (only your team sees this)">
              <input className={`${s.text} ${s.wide}`} value={name} maxLength={80} aria-label="Automation name"
                placeholder="e.g. Try another flavour after delivery" onChange={(e) => setName(e.target.value)} />
            </Field>
            {nameErr && <span className={s.hint}>{nameErr}</span>}
            <div className={s.review}>
              <div className={s.main}>
                <FlowTimeline orientation="vertical" steps={customFlowSteps(draftFlow)} />
                <PlainSummary sentences={[
                  `${TRIGGER_TEXT[trigger].when}, this sends ${messages.length} message${messages.length === 1 ? "" : "s"}.`,
                  `The first goes ${messages[0]?.gapHours ? `${friendlyDuration(messages[0].gapHours)} later` : "right away"}.`,
                  "It stops if they reply STOP" + (trigger === "checkout_abandoned" ? " or place the order." : " or the order is cancelled."),
                  "Each message counts towards the 1 marketing message a day each person can get.",
                ]} />
                <TestSend messages={messages} byName={byName} flowName={name.trim() || "automation test"} />
              </div>
              <PreviewTabs templates={templates} statusRows={statusRows}
                items={messages.map((m, i) => ({
                  key: String(i), label: `Message ${i + 1}`, name: m.template,
                  vars: Object.fromEntries(Object.entries(m.vars).map(([k, v]) => [k, fillSample(v)])),
                }))} />
            </div>
          </>
        )}

        <div className={s.navRow}>
          <button type="button" className="pm2-btn" onClick={() => (step === 1 ? onCancel() : setStep(step - 1))}>
            <ArrowLeft aria-hidden="true" /> {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < 4 ? (
            <button type="button" className="pm2-btn pri" disabled={!canReach[step]} onClick={() => setStep(step + 1)}>
              Next: {STEP_TITLES[step]} <ArrowRight aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="pm2-btn pri" disabled={saving || !!nameErr} onClick={save}>
              {saving ? "Saving…" : initial ? "Save changes" : "Save as draft (off)"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------------- test send ----------------
   Uses the campaign test-send path: the engine builds the exact message and
   sends it only to the number typed here. It creates no contact, no ledger
   row and no claim, so a test can never affect real customers. */

function TestSend({ messages, byName, flowName }: { messages: DraftMessage[]; byName: Map<string, Template>; flowName: string }) {
  const [phone, setPhone] = useState("");
  const [which, setWhich] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const m = messages[Math.min(which, messages.length - 1)];
  const t = m ? byName.get(m.template) : undefined;

  async function send() {
    const to = normalizeTestNumber(phone);
    if (!to) { setResult({ ok: false, text: "Enter your full mobile number, e.g. 98765 43210." }); return; }
    if (!t || t.status !== "approved") { setResult({ ok: false, text: "Pick an approved message first." }); return; }
    setBusy(true);
    setResult(null);
    try {
      const vars = Object.fromEntries(blankKeys(t.body).map((k) => [k, fillSample(m.vars[k] ?? "")]));
      await apiFetch("/api/whatsapp/campaigns/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, draft: { template_id: t.id, template_vars: vars, name: flowName }, test_name: "Priya" }),
      });
      setResult({ ok: true, text: `Sent to +${to}. Check your WhatsApp in a few seconds.` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "The test did not send." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.testBox}>
      <div className={s.fieldLabel}>
        Send me a test first <HelpTip term="test_send" />
      </div>
      <span className={s.hint}>
        Only your number gets it, filled with sample details (Priya, order #1234). No customer is messaged.
        It still counts as one <GlossaryTerm k="marketing">marketing</GlossaryTerm> message to you.
      </span>
      <div className={s.testRow}>
        {messages.length > 1 && (
          <select className={s.select} aria-label="Which message to test" value={which} onChange={(e) => setWhich(Number(e.target.value))}>
            {messages.map((_, i) => <option key={i} value={i}>Message {i + 1}</option>)}
          </select>
        )}
        <input className={s.text} inputMode="tel" placeholder="Your mobile number" aria-label="Your mobile number"
          value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button type="button" className="pm2-btn sm" disabled={busy || !t} onClick={send}>
          <Send aria-hidden="true" /> {busy ? "Sending…" : "Send test"}
        </button>
      </div>
      {result && <span className={result.ok ? s.ok : s.err} role="status">{result.text}</span>}
    </div>
  );
}
