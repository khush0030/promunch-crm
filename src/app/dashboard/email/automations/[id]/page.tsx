"use client";

// Automation editor, built for the team (owner, 2026-10-01): the emails as a
// numbered timeline on the left; the picked email on the right with plain
// settings (when, from, subject lines, offer) and a click-to-edit canvas
// (VisualEmailEditor), plus a Preview tab rendered by the same code the flow
// engine sends with. Raw HTML stays under "Advanced". Saves go through
// /api/email-studio/flows/[id]: anyone can edit the emails, admins change who
// gets a live automation, switch it on/off or delete it.

import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, Copy, Monitor, OctagonAlert, Plus, Send, Smartphone, Trash2, X } from "lucide-react";
import { Callout, ConfirmDialog, Pill } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { PreviewFrame } from "@/components/email-studio/Builder";
import { VisualEmailEditor } from "@/components/email-studio/VisualEmailEditor";
import { getJson, sendJson } from "@/components/email-studio/api";
import {
  FLOW_TRIGGERS,
  LIVE_TRIGGERS,
  flowIssues,
  hasBlockingIssue,
  joinDelay,
  mergeTagsFor,
  splitDelay,
  triggerLabel,
  type DelayUnit,
  type EditableFlow,
  type EditableStep,
} from "@/lib/email-studio/automations";
import { friendlyText, whenLabel } from "@/lib/email-studio/visual-edit";
import s from "@/components/email-studio/studio.module.css";

type FlowDto = EditableFlow & { id: string; status: string; updated_at: string | null };
type LoadDto = { flow: FlowDto; inProgress: number; admin: boolean };

const STATUS: Record<string, { tone: "good" | "warn" | "neu"; label: string }> = {
  active: { tone: "good", label: "On" },
  paused: { tone: "warn", label: "Paused" },
  draft: { tone: "neu", label: "Draft" },
};

const SENDERS = [
  { value: "", label: "PROMUNCH" },
  { value: "Parth from PROMUNCH", label: "Parth from PROMUNCH (founder letter)" },
];

function blankStep(prevCount: number): EditableStep {
  return {
    type: "email",
    delay_hours: prevCount === 0 ? 1 : 24,
    subject: "",
    preview_text: "",
    body_html: '<p style="margin:0 0 16px;font-family:Assistant,\'Helvetica Neue\',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1A1A;">Hi {{first_name}}, write your message here.</p>',
  };
}

export default function AutomationEditorPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <Editor params={params} />
    </Suspense>
  );
}

function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["email-studio-flow", id], queryFn: () => getJson<LoadDto>(`/api/email-studio/flows/${id}`) });

  const [draft, setDraft] = useState<EditableFlow | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [sel, setSel] = useState(() => Math.max(0, Number(search.get("email") ?? 1) - 1));
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [dialog, setDialog] = useState<"on" | "off" | "delete" | null>(null);
  const [showChecks, setShowChecks] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    const { flow } = q.data;
    const d: EditableFlow = { name: flow.name, description: flow.description, trigger_type: flow.trigger_type, trigger_config: flow.trigger_config, steps: flow.steps };
    setDraft(d);
    setSaved(JSON.stringify(d));
    setSel((v) => Math.min(v, Math.max(0, d.steps.length - 1)));
  }, [q.data]);

  // Keep ?email=N in the address bar so a link opens the same email.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("email", String(sel + 1));
    window.history.replaceState(null, "", url.toString());
  }, [sel]);

  const dirty = draft !== null && JSON.stringify(draft) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const issues = useMemo(() => (draft ? flowIssues(draft) : []), [draft]);
  const flow = q.data?.flow;
  const admin = q.data?.admin ?? false;
  const on = flow?.status === "active";
  // Live automations: anyone edits the emails; only admins change who gets it
  // or add/remove emails (the API enforces the same).
  const rulesLocked = on && !admin;

  const setStep = useCallback((i: number, patch: Partial<EditableStep>) => {
    setDraft((d) => (d ? { ...d, steps: d.steps.map((st, k) => (k === i ? cleanStep({ ...st, ...patch }) : st)) } : d));
  }, []);
  const setCfg = (k: string, v: unknown) =>
    setDraft((d) => {
      if (!d) return d;
      const cfg = { ...d.trigger_config };
      if (v === undefined || v === false || v === "" || v === null) delete cfg[k];
      else cfg[k] = v;
      return { ...d, trigger_config: cfg };
    });
  const moveStep = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const j = i + dir;
      if (j < 0 || j >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      setSel(j);
      return { ...d, steps };
    });

  // --- preview (debounced), only while the Preview tab is open ---
  const step = draft?.steps[sel];
  const [preview, setPreview] = useState<{ subject: string; html: string; source: string } | null>(null);
  useEffect(() => {
    if (!draft || !step || tab !== "preview") return;
    const t = setTimeout(() => {
      sendJson<{ subject: string; html: string; source: string }>("/api/email-studio/flows/preview", "POST", {
        trigger_type: draft.trigger_type,
        flowId: id,
        step,
        stepIndex: sel,
      })
        .then(setPreview)
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [draft?.trigger_type, step, sel, id, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- actions ---
  const save = async () => {
    if (!draft) return;
    setBusy("save");
    try {
      await sendJson(`/api/email-studio/flows/${id}`, "PUT", draft);
      setSaved(JSON.stringify(draft));
      qc.invalidateQueries({ queryKey: ["email-studio-flows"] });
      toast.push({ kind: "success", text: on ? "Saved. Customers get the new version from their next email." : "Saved." });
    } catch (e) {
      toast.push({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const test = async (which: number | "all") => {
    setBusy("test");
    try {
      const r = await sendJson<{ to: string[]; sent: unknown[]; source: string }>("/api/email-studio/flows/test", "POST", { flowId: id, step: which });
      toast.push({ kind: "success", text: `Sent ${r.sent.length} test email${r.sent.length === 1 ? "" : "s"} to ${r.to.join(", ")}.` });
    } catch (e) {
      toast.push({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const setStatus = async (status: "active" | "paused") => {
    setBusy("status");
    try {
      await sendJson(`/api/email-studio/flows/${id}`, "PATCH", { status });
      await q.refetch();
      qc.invalidateQueries({ queryKey: ["email-studio-flows"] });
      toast.push({ kind: "success", text: status === "active" ? "Automation is on." : "Automation paused." });
      setDialog(null);
    } catch (e) {
      toast.push({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy("delete");
    try {
      await sendJson(`/api/email-studio/flows/${id}`, "DELETE");
      qc.invalidateQueries({ queryKey: ["email-studio-flows"] });
      setSaved(JSON.stringify(draft));
      router.push("/dashboard/email/automations");
    } catch (e) {
      toast.push({ kind: "error", text: (e as Error).message });
      setBusy(null);
    }
  };

  if (q.error) {
    return (
      <>
        <StudioHeader tab="automations" title="Automation" />
        <div className="pm2-body"><Callout tone="crit" title="Could not load this automation" body={(q.error as Error).message} /></div>
      </>
    );
  }
  if (!draft || !flow) {
    return (
      <>
        <StudioHeader tab="automations" title="Automation" />
        <div className="pm2-body"><div className="pm2-panel" style={{ padding: 16 }}><span className={s.hint}>Loading…</span></div></div>
      </>
    );
  }

  const st = STATUS[flow.status] ?? { tone: "neu" as const, label: flow.status };
  const blockers = hasBlockingIssue(issues);
  const blockCount = issues.filter((i) => i.level === "block").length;
  const tags = mergeTagsFor(draft.trigger_type);
  const cfg = draft.trigger_config;

  return (
    <>
      <StudioHeader
        tab="automations"
        title={
          <span className={s.row} style={{ gap: 10 }}>
            {draft.name || "Untitled automation"} <Pill tone={st.tone}>{st.label}</Pill>
          </span>
        }
        actions={
          <>
            {admin && (on ? (
              <button type="button" className="pm2-btn ghost" disabled={busy !== null} onClick={() => setDialog("off")}>Pause</button>
            ) : (
              <button type="button" className="pm2-btn ghost" disabled={busy !== null || dirty || blockers} title={dirty ? "Save first" : blockers ? "Fix the issues first" : undefined} onClick={() => setDialog("on")}>Switch on</button>
            ))}
            <button type="button" className="pm2-btn pri" disabled={busy !== null || !dirty || (on && blockers)} title={on && blockers ? "Fix the red issues first" : undefined} onClick={save}>
              {busy === "save" ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
          </>
        }
      />
      <div className="pm2-body">
        <Link href="/dashboard/email/automations" className={s.hint} style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
          <ChevronLeft size={14} /> All automations
        </Link>

        {on && (
          <Callout
            tone="sun"
            title="This automation is live"
            body={`Saved changes go to real customers from their next email (${q.data!.inProgress} ${q.data!.inProgress === 1 ? "person is" : "people are"} in it now). After saving, send yourself a test.`}
          />
        )}

        <button type="button" className={`${s.aeChecks} ${blockCount ? s.aeChecksBad : s.aeChecksOk}`} style={{ border: 0, cursor: issues.length ? "pointer" : "default", textAlign: "left" }} onClick={() => setShowChecks((v) => !v)}>
          {blockCount ? <OctagonAlert size={16} /> : <CheckCircle2 size={16} />}
          {blockCount
            ? `${blockCount} thing${blockCount === 1 ? "" : "s"} to fix before this can be saved`
            : issues.length ? `Looks good. ${issues.length} tip${issues.length === 1 ? "" : "s"}` : "Looks good"}
          {issues.length > 0 && <span style={{ textDecoration: "underline", fontWeight: 600 }}>{showChecks ? "Hide" : "Show"}</span>}
        </button>
        {showChecks && issues.length > 0 && (
          <ul className={s.issues}>
            {issues.map((it, k) => (
              <li key={k} className={`${s.issue} ${it.level === "block" ? s.issueBlock : s.issueWarn}`}>
                {it.level === "block" ? <OctagonAlert /> : <AlertTriangle />} {it.message}
              </li>
            ))}
          </ul>
        )}

        <div className={s.ae}>
          {/* ---------- left: the emails + who gets it ---------- */}
          <div className={s.aeList}>
            <span className={s.alGroup}>The emails, in order</span>
            {draft.steps.map((x, i) => (
              <button key={i} type="button" className={`${s.aeItem} ${i === sel ? s.on : ""}`} onClick={() => setSel(i)}>
                <span className={s.aeNum}>{i + 1}</span>
                <span>
                  <span className={s.aeSubj}>{x.subject ? friendlyText(x.subject) : "No subject yet"}</span>
                  <span className={s.aeWhen}>{whenLabel(draft.trigger_type, i, x.delay_hours)}{x.coupon ? ` · ${x.coupon.percent_off}% code` : ""}</span>
                </span>
              </button>
            ))}
            {!rulesLocked && draft.steps.length < 10 && (
              <button type="button" className="pm2-btn ghost" onClick={() => { setDraft({ ...draft, steps: [...draft.steps, blankStep(draft.steps.length)] }); setSel(draft.steps.length); setTab("edit"); }}>
                <Plus size={14} /> Add an email
              </button>
            )}

            <details className="pm2-panel" style={{ padding: 14, marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 14 }}>Who gets it</summary>
              <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                {rulesLocked && <span className={s.hint}>Only admins can change who gets a live automation.</span>}
                <label className={s.field}>
                  <span>Name</span>
                  <input className={s.input} value={draft.name} disabled={rulesLocked} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <label className={s.field}>
                  <span>Note for the team <em>optional</em></span>
                  <textarea className={s.textarea} style={{ minHeight: 70 }} value={draft.description} placeholder="What this does and why" onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                </label>
                <label className={s.field}>
                  <span>Starts when</span>
                  <select className={s.select} value={draft.trigger_type} disabled={on} onChange={(e) => setDraft({ ...draft, trigger_type: e.target.value })}>
                    {FLOW_TRIGGERS.map((t) => (
                      <option key={t} value={t}>{triggerLabel(t)}{(LIVE_TRIGGERS as string[]).includes(t) ? "" : " (not connected yet)"}</option>
                    ))}
                  </select>
                  {on && <span className={s.hint} style={{ fontWeight: 500 }}>Pause it to change this.</span>}
                </label>
                {draft.trigger_type === "order_placed" && (
                  <>
                    <Toggle disabled={rulesLocked} checked={cfg.first_order_only === true} onChange={(v) => setCfg("first_order_only", v)} label="First order only" hint="Skip anyone who has ordered before." />
                    <Toggle disabled={rulesLocked} checked={cfg.exit_on_order === true || cfg.exit_on_reorder === true} onChange={(v) => { setCfg("exit_on_reorder", v); setCfg("exit_on_order", v ? true : undefined); }} label="Stop if they order again" hint="Checked before each email." />
                  </>
                )}
                {draft.trigger_type === "checkout_abandoned" && (
                  <label className={s.field}>
                    <span>Stop trying after <em>hours</em></span>
                    <input className={s.input} type="number" min={1} disabled={rulesLocked} value={Number(cfg.deadline_hours ?? "") || ""} placeholder="No limit" onChange={(e) => setCfg("deadline_hours", Number(e.target.value) || undefined)} />
                    <span className={s.hint} style={{ fontWeight: 500 }}>It always stops as soon as they buy.</span>
                  </label>
                )}
                <Toggle
                  disabled={rulesLocked}
                  checked={Number(cfg.once_per_contact_days ?? 0) > 0}
                  onChange={(v) => setCfg("once_per_contact_days", v ? 30 : undefined)}
                  label="Limit how often one person gets it"
                  hint={Number(cfg.once_per_contact_days ?? 0) > 0 ? undefined : "Off: every matching event enters them."}
                >
                  {Number(cfg.once_per_contact_days ?? 0) > 0 && (
                    <span className={s.row} style={{ fontSize: 13, color: "var(--pm-muted)" }}>
                      At most once every
                      <input className={s.input} style={{ width: 70 }} type="number" min={1} disabled={rulesLocked} value={Number(cfg.once_per_contact_days)} onChange={(e) => setCfg("once_per_contact_days", Math.max(1, Number(e.target.value) || 1))} />
                      days
                    </span>
                  )}
                </Toggle>
                {admin && !on && (
                  <button type="button" className="pm2-btn ghost" style={{ color: "var(--pm-terra)", justifySelf: "start" }} disabled={busy !== null} onClick={() => setDialog("delete")}>
                    <Trash2 size={14} /> Delete automation
                  </button>
                )}
              </div>
            </details>
          </div>

          {/* ---------- right: the picked email ---------- */}
          {step ? (
            <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
              <div className={s.row} style={{ justifyContent: "space-between" }}>
                <div className={s.aeTabs}>
                  <button type="button" className={tab === "edit" ? s.on : ""} onClick={() => setTab("edit")}>Edit email {sel + 1}</button>
                  <button type="button" className={tab === "preview" ? s.on : ""} onClick={() => setTab("preview")}>Preview as a customer</button>
                </div>
                <button type="button" className="pm2-btn ghost" disabled={busy !== null || dirty} title={dirty ? "Save first. Tests send the saved version." : undefined} onClick={() => test(sel)}>
                  <Send size={14} /> {busy === "test" ? "Sending…" : "Send me this email"}
                </button>
              </div>

              {tab === "edit" ? (
                <>
                  <StepSettings step={step} index={sel} trigger={draft.trigger_type} winback={cfg.segment === "winback"} onChange={(patch) => setStep(sel, patch)} />
                  <VisualEmailEditor key={sel} html={step.body_html} trigger={draft.trigger_type} tags={tags} onChange={(html) => setStep(sel, { body_html: html })} />
                  <details className="pm2-panel" style={{ padding: 14 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 14 }}>Advanced</summary>
                    <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                      {!rulesLocked && (
                        <div className={s.row}>
                          <button type="button" className="pm2-btn ghost" disabled={sel === 0} onClick={() => moveStep(sel, -1)}><ArrowUp size={14} /> Move earlier</button>
                          <button type="button" className="pm2-btn ghost" disabled={sel === draft.steps.length - 1} onClick={() => moveStep(sel, 1)}><ArrowDown size={14} /> Move later</button>
                          <button type="button" className="pm2-btn ghost" disabled={draft.steps.length >= 10} onClick={() => { setDraft({ ...draft, steps: [...draft.steps.slice(0, sel + 1), { ...step }, ...draft.steps.slice(sel + 1)] }); setSel(sel + 1); }}><Copy size={14} /> Copy this email</button>
                          <button type="button" className="pm2-btn ghost" style={{ color: "var(--pm-terra)" }} onClick={() => { setDraft({ ...draft, steps: draft.steps.filter((_, k) => k !== sel) }); setSel(Math.max(0, sel - 1)); }}><Trash2 size={14} /> Remove this email</button>
                        </div>
                      )}
                      <label className={s.field}>
                        <span>Fixed code <em>only when the offer is off; fills the code box</em></span>
                        <input className={s.input} value={step.coupon_code ?? ""} onChange={(e) => setStep(sel, { coupon_code: e.target.value.toUpperCase() || undefined })} placeholder="PROMUNCH10" />
                      </label>
                      <label className={s.field}>
                        <span>Email HTML <em>for experts, the editor above writes this</em></span>
                        <textarea className={s.textarea} style={{ minHeight: 220, fontFamily: "var(--pm-mono)", fontSize: 12 }} value={step.body_html} onChange={(e) => setStep(sel, { body_html: e.target.value })} />
                      </label>
                    </div>
                  </details>
                </>
              ) : (
                <div className={s.previewWrap}>
                  <div className={s.previewBar}>
                    <span className={s.grow}>Email {sel + 1}{preview?.source ? ` · filled from ${preview.source}` : ""}</span>
                    <button type="button" className={s.iconBtn} aria-label="Desktop" onClick={() => setMobile(false)} style={{ color: mobile ? undefined : "var(--pm-ink)" }}><Monitor /></button>
                    <button type="button" className={s.iconBtn} aria-label="Phone" onClick={() => setMobile(true)} style={{ color: mobile ? "var(--pm-ink)" : undefined }}><Smartphone /></button>
                  </div>
                  {preview ? (
                    <>
                      <div className={s.inboxLine}><b>{step.from_name || "PROMUNCH"}</b> · <b>{preview.subject || "(no subject)"}</b> <span>{step.preview_text ? ` · ${step.preview_text}` : ""}</span></div>
                      <PreviewFrame html={preview.html} mobile={mobile} />
                    </>
                  ) : (
                    <div style={{ padding: 16 }}><span className={s.hint}>Rendering…</span></div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="pm2-panel" style={{ padding: 16 }}><span className={s.hint}>No emails yet. Add the first one.</span></div>
          )}
        </div>
      </div>

      {dialog === "on" && (
        <ConfirmDialog
          title={`Switch on "${draft.name}"?`}
          body="Real customers start getting these emails from the next matching event. Make sure you have checked the test emails."
          confirmLabel="Switch on"
          danger
          busy={busy === "status"}
          onClose={() => setDialog(null)}
          onConfirm={() => setStatus("active")}
        />
      )}
      {dialog === "off" && (
        <ConfirmDialog
          title={`Pause "${draft.name}"?`}
          body="No more emails go out from this automation. People already in it wait where they are and continue if you switch it back on."
          confirmLabel="Pause"
          busy={busy === "status"}
          onClose={() => setDialog(null)}
          onConfirm={() => setStatus("paused")}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title={`Delete "${draft.name}"?`}
          body="The automation and everyone waiting in it are removed. This cannot be undone."
          confirmLabel="Delete"
          danger
          busy={busy === "delete"}
          onClose={() => setDialog(null)}
          onConfirm={remove}
        />
      )}
    </>
  );
}

/** Drop empty optional fields so a cleared box does not save "" or []. */
function cleanStep(st: EditableStep): EditableStep {
  const out = { ...st };
  if (!out.subject_variants?.length) delete out.subject_variants;
  if (!out.preview_variants?.length) delete out.preview_variants;
  if (!out.from_name) delete out.from_name;
  if (!out.coupon) delete out.coupon;
  return out;
}

/** The plain settings of one email: when, from, subject lines, offer. */
function StepSettings({ step, index, trigger, winback, onChange }: {
  step: EditableStep;
  index: number;
  trigger: string;
  winback: boolean;
  onChange: (patch: Partial<EditableStep>) => void;
}) {
  const d = splitDelay(step.delay_hours);
  const maxPct = winback ? 20 : 15;
  return (
    <div className={`pm2-panel ${s.aeCard}`}>
      <div className={s.aeGrid2}>
        <div className={s.field}>
          <span>When it sends</span>
          <div className={s.row}>
            <input className={s.input} style={{ width: 80 }} type="number" min={0} value={d.value} onChange={(e) => onChange({ delay_hours: joinDelay(Number(e.target.value), d.unit) })} />
            <select className={s.select} style={{ width: "auto" }} value={d.unit} onChange={(e) => onChange({ delay_hours: joinDelay(d.value, e.target.value as DelayUnit) })}>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </div>
          <span className={s.hint} style={{ fontWeight: 500 }}>{whenLabel(trigger, index, step.delay_hours)}. Emails only go out 9am to 9pm.</span>
        </div>
        <label className={s.field}>
          <span>From</span>
          <select className={s.select} value={step.from_name ?? ""} onChange={(e) => onChange({ from_name: e.target.value || undefined })}>
            {SENDERS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
          <span className={s.hint} style={{ fontWeight: 500 }}>Replies always come to hello@promunch.in.</span>
        </label>
      </div>

      <Lines
        label="Subject line"
        hint="Add up to 2 more to test. Each person gets one at random and we keep the winner's numbers."
        main={step.subject}
        variants={step.subject_variants ?? []}
        onMain={(v) => onChange({ subject: v })}
        onVariants={(v) => onChange({ subject_variants: v })}
      />
      <Lines
        label="Preview text"
        hint="The grey line after the subject in the inbox."
        main={step.preview_text ?? ""}
        variants={step.preview_variants ?? []}
        onMain={(v) => onChange({ preview_text: v })}
        onVariants={(v) => onChange({ preview_variants: v })}
      />

      <div className={s.aeOffer}>
        <label className={s.check} style={{ fontWeight: 650 }}>
          <input type="checkbox" checked={!!step.coupon} onChange={(e) => onChange({ coupon: e.target.checked ? { percent_off: Math.min(15, maxPct), expires_in_days: 9, prefix: "PM" } : undefined })} />
          Give a one-time discount code
        </label>
        {step.coupon && (
          <>
            <span className={s.row}>
              <input className={s.input} style={{ width: 70 }} type="number" min={1} max={maxPct} value={step.coupon.percent_off} onChange={(e) => onChange({ coupon: { ...step.coupon!, percent_off: Math.max(1, Math.min(maxPct, Number(e.target.value) || 1)) } })} />
              % off, code works for
              <input className={s.input} style={{ width: 70 }} type="number" min={1} max={60} value={step.coupon.expires_in_days ?? 7} onChange={(e) => onChange({ coupon: { ...step.coupon!, expires_in_days: Math.max(1, Math.min(60, Number(e.target.value) || 1)) } })} />
              days
            </span>
            <span className={s.hint}>Each customer gets their own single-use code. Our rule: 15% max{winback ? ", 20% for win-back" : ""}. Put a &quot;Discount code box&quot; section in the email so they see it.</span>
          </>
        )}
      </div>
      {step.skip_if_wa_journey && (
        <span className={s.hint}>Skipped for anyone WhatsApp already sent the {step.skip_if_wa_journey === "cart" ? "cart reminder" : step.skip_if_wa_journey === "review" ? "review request" : "refill reminder"} to, so nobody gets both.</span>
      )}
    </div>
  );
}

function Lines({ label, hint, main, variants, onMain, onVariants }: {
  label: string;
  hint: string;
  main: string;
  variants: string[];
  onMain: (v: string) => void;
  onVariants: (v: string[]) => void;
}) {
  return (
    <div className={s.field}>
      <span>{label}</span>
      <input className={s.input} value={main} onChange={(e) => onMain(e.target.value)} />
      {variants.map((v, k) => (
        <div key={k} className={s.aeVariant}>
          <input className={s.input} value={v} placeholder={`Option ${k + 2}`} onChange={(e) => onVariants(variants.map((x, j) => (j === k ? e.target.value : x)))} />
          <button type="button" className={s.iconBtn} aria-label="Remove option" onClick={() => onVariants(variants.filter((_, j) => j !== k))}><X /></button>
        </div>
      ))}
      <span className={s.row} style={{ justifyContent: "space-between" }}>
        <span className={s.hint} style={{ fontWeight: 500 }}>{hint}</span>
        {variants.length < 2 && (
          <button type="button" className="pm2-btn ghost" style={{ height: 28, fontSize: 12.5 }} onClick={() => onVariants([...variants, ""])}>
            <Plus size={12} /> Add an option to test
          </button>
        )}
      </span>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean; children?: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label className={s.check} style={{ fontSize: 14, cursor: disabled ? "default" : "pointer" }}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span style={{ display: "grid", gap: 2 }}>
          <b style={{ fontWeight: 600 }}>{label}</b>
          {hint && <span className={s.hint}>{hint}</span>}
        </span>
      </label>
      {children}
    </div>
  );
}
