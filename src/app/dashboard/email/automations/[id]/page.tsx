"use client";

// Automation editor: who enters, the emails in order with their waits, a live
// preview rendered by the same code the flow engine sends with, copy checks,
// and a test send. Edits save through /api/email-studio/flows/[id], which
// keeps an ON automation admin-only and blocks bad copy from going live.

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, Copy, Mail, Monitor, Plus, Send, Smartphone, Trash2, AlertTriangle, OctagonAlert, CheckCircle2 } from "lucide-react";
import { Callout, ConfirmDialog, Pill } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { PreviewFrame } from "@/components/email-studio/Builder";
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
import s from "@/components/email-studio/studio.module.css";

type FlowDto = EditableFlow & { id: string; status: string; updated_at: string | null };
type LoadDto = { flow: FlowDto; inProgress: number; admin: boolean };

const STATUS: Record<string, { tone: "good" | "warn" | "neu"; label: string }> = {
  active: { tone: "good", label: "On" },
  paused: { tone: "warn", label: "Paused" },
  draft: { tone: "neu", label: "Draft" },
};

// Ready-made pieces in the house email style (same as the live flows).
const SNIPPETS: { label: string; html: string }[] = [
  { label: "Paragraph", html: '<p style="font-size:16px;line-height:1.6;margin:0 0 14px;">Your text here.</p>' },
  { label: "Small print", html: '<p style="font-size:15px;line-height:1.6;color:#6E665A;margin:0 0 10px;">Your text here.</p>' },
  { label: "Heading", html: '<p style="font-size:17px;line-height:1.5;font-weight:700;margin:22px 0 8px;">Your heading</p>' },
  {
    label: "Button",
    html: '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr><td style="background:#1B2A20;border-radius:10px;"><a href="https://promunch.in" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">Shop now</a></td></tr></table>',
  },
  { label: "Bullet list", html: '<ul style="padding-left:20px;margin:0 0 14px;"><li style="font-size:16px;line-height:1.6;margin:0 0 8px;">First point</li><li style="font-size:16px;line-height:1.6;margin:0 0 8px;">Second point</li></ul>' },
  { label: "Sign-off", html: '<p style="font-size:15px;line-height:1.6;color:#6E665A;margin:0 0 10px;">Your Munchy Pal,<br>Team PROMUNCH</p>' },
];

function blankStep(prevCount: number): EditableStep {
  return {
    type: "email",
    delay_hours: prevCount === 0 ? 1 : 24,
    subject: "",
    preview_text: "",
    body_html: '<p style="font-size:16px;line-height:1.6;margin:0 0 14px;">Hi {{first_name}},</p>',
  };
}

export default function AutomationEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["email-studio-flow", id], queryFn: () => getJson<LoadDto>(`/api/email-studio/flows/${id}`) });

  const [draft, setDraft] = useState<EditableFlow | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [dialog, setDialog] = useState<"on" | "off" | "delete" | null>(null);

  useEffect(() => {
    if (!q.data) return;
    const { flow } = q.data;
    const d: EditableFlow = { name: flow.name, description: flow.description, trigger_type: flow.trigger_type, trigger_config: flow.trigger_config, steps: flow.steps };
    setDraft(d);
    setSaved(JSON.stringify(d));
  }, [q.data]);

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
  const locked = on && !admin;

  const setStep = useCallback((i: number, patch: Partial<EditableStep>) => {
    setDraft((d) => (d ? { ...d, steps: d.steps.map((st, k) => (k === i ? { ...st, ...patch } : st)) } : d));
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

  // --- live preview (debounced) ---
  const step = draft?.steps[sel];
  const [preview, setPreview] = useState<{ subject: string; html: string; source: string } | null>(null);
  useEffect(() => {
    if (!draft || !step) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      sendJson<{ subject: string; html: string; source: string }>("/api/email-studio/flows/preview", "POST", {
        trigger_type: draft.trigger_type,
        flowId: id,
        step,
        stepIndex: sel,
      })
        .then(setPreview)
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [draft?.trigger_type, step, sel, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- merge tag / snippet insert at the cursor of the last focused field ---
  const lastField = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; key: "subject" | "preview_text" | "body_html" } | null>(null);
  const insert = (text: string, prefer: "subject" | "preview_text" | "body_html" = "body_html") => {
    if (!step) return;
    const f = lastField.current;
    const key = f?.key ?? prefer;
    const el = f?.el;
    const cur = String(step[key] ?? "");
    const at = el && el.selectionStart != null ? el.selectionStart : cur.length;
    const end = el && el.selectionEnd != null ? el.selectionEnd : at;
    setStep(sel, { [key]: cur.slice(0, at) + text + cur.slice(end) });
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(at + text.length, at + text.length);
      }
    });
  };
  const track = (key: "subject" | "preview_text" | "body_html") => (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    lastField.current = { el: e.currentTarget, key };
  };

  // --- actions ---
  const save = async () => {
    if (!draft) return;
    setBusy("save");
    try {
      await sendJson(`/api/email-studio/flows/${id}`, "PUT", draft);
      setSaved(JSON.stringify(draft));
      qc.invalidateQueries({ queryKey: ["email-studio-flows"] });
      toast.push({ kind: "success", text: "Saved." });
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
      setSaved(JSON.stringify(draft)); // nothing left to lose
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
            <button type="button" className="pm2-btn ghost" disabled={busy !== null || dirty || draft.steps.length === 0} title={dirty ? "Save first, tests send the saved version" : undefined} onClick={() => test("all")}>
              <Send size={14} /> {busy === "test" ? "Sending…" : "Send me a test"}
            </button>
            {admin && (on ? (
              <button type="button" className="pm2-btn ghost" disabled={busy !== null} onClick={() => setDialog("off")}>Pause</button>
            ) : (
              <button type="button" className="pm2-btn ghost" disabled={busy !== null || dirty || blockers} title={dirty ? "Save first" : blockers ? "Fix the issues first" : undefined} onClick={() => setDialog("on")}>Switch on</button>
            ))}
            <button type="button" className="pm2-btn pri" disabled={busy !== null || !dirty || locked} onClick={save}>{busy === "save" ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
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
            title="This automation is on"
            body={admin
              ? `Saved changes apply to the next email each person gets (${q.data!.inProgress} people are in it right now). Check the test before saving.`
              : "Only admins can change an automation that is on. You can look, preview and send yourself a test."}
          />
        )}

        <div className={s.builder}>
          {/* ---------- left: settings + emails ---------- */}
          <div className={s.side} style={{ position: "static", maxHeight: "none" }}>
            <div className="pm2-panel" style={{ padding: 14, display: "grid", gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>Who gets it</h3>
              <label className={s.field}>
                <span>Name</span>
                <input className={s.input} value={draft.name} disabled={locked} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className={s.field}>
                <span>Note for the team <em>optional</em></span>
                <input className={s.input} value={draft.description} disabled={locked} placeholder="What this does and why" onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </label>
              <label className={s.field}>
                <span>Starts when</span>
                <select className={s.select} value={draft.trigger_type} disabled={on} onChange={(e) => setDraft({ ...draft, trigger_type: e.target.value })}>
                  {FLOW_TRIGGERS.map((t) => (
                    <option key={t} value={t}>{triggerLabel(t)}{(LIVE_TRIGGERS as string[]).includes(t) ? "" : " (not connected yet)"}</option>
                  ))}
                </select>
                {on && <span className={s.hint} style={{ fontWeight: 500 }}>Pause it to change the trigger.</span>}
              </label>

              {draft.trigger_type === "order_placed" && (
                <>
                  <Toggle disabled={locked} checked={cfg.first_order_only === true} onChange={(v) => setCfg("first_order_only", v)} label="First order only" hint="Skip anyone who has ordered before (checked against Shopify)." />
                  <Toggle disabled={locked} checked={cfg.exit_on_reorder === true} onChange={(v) => setCfg("exit_on_reorder", v)} label="Stop if they order again" hint="Checked just before each email." />
                </>
              )}
              {draft.trigger_type === "checkout_abandoned" && (
                <label className={s.field}>
                  <span>Stop trying after <em>hours</em></span>
                  <input className={s.input} type="number" min={1} disabled={locked} value={Number(cfg.deadline_hours ?? "") || ""} placeholder="No limit" onChange={(e) => setCfg("deadline_hours", Number(e.target.value) || undefined)} />
                  <span className={s.hint} style={{ fontWeight: 500 }}>It always stops as soon as they buy.</span>
                </label>
              )}
              <Toggle
                disabled={locked}
                checked={Number(cfg.once_per_contact_days ?? 0) > 0}
                onChange={(v) => setCfg("once_per_contact_days", v ? 30 : undefined)}
                label="Limit how often one person gets it"
                hint={Number(cfg.once_per_contact_days ?? 0) > 0 ? undefined : "Off: every matching event enters them."}
              >
                {Number(cfg.once_per_contact_days ?? 0) > 0 && (
                  <span className={s.row} style={{ fontSize: 13, color: "var(--pm-muted)" }}>
                    At most once every
                    <input className={s.input} style={{ width: 70 }} type="number" min={1} disabled={locked} value={Number(cfg.once_per_contact_days)} onChange={(e) => setCfg("once_per_contact_days", Math.max(1, Number(e.target.value) || 1))} />
                    days
                  </span>
                )}
              </Toggle>
            </div>

            <div className="pm2-panel" style={{ padding: 14, display: "grid", gap: 8 }}>
              <div className={s.row} style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>Emails</h3>
                <button type="button" className="pm2-btn ghost" disabled={locked || draft.steps.length >= 10} onClick={() => { setDraft({ ...draft, steps: [...draft.steps, blankStep(draft.steps.length)] }); setSel(draft.steps.length); }}>
                  <Plus size={14} /> Add email
                </button>
              </div>
              {draft.steps.length === 0 && <span className={s.hint}>No emails yet. Add the first one.</span>}
              {draft.steps.map((x, i) => {
                const d = splitDelay(x.delay_hours);
                return (
                  <div key={i} style={{ display: "grid", gap: 6 }}>
                    <div className={s.row} style={{ fontSize: 13, color: "var(--pm-muted)" }}>
                      Wait
                      <input className={s.input} style={{ width: 70 }} type="number" min={0} disabled={locked} value={d.value} onChange={(e) => setStep(i, { delay_hours: joinDelay(Number(e.target.value), d.unit) })} />
                      <select className={s.select} style={{ width: "auto" }} disabled={locked} value={d.unit} onChange={(e) => setStep(i, { delay_hours: joinDelay(d.value, e.target.value as DelayUnit) })}>
                        <option value="minutes">minutes</option>
                        <option value="hours">hours</option>
                        <option value="days">days</option>
                      </select>
                      {i === 0 ? "after it starts" : "after the email above"}
                    </div>
                    <div className={`${s.block} ${i === sel ? s.on : ""}`}>
                      <div className={s.blockHead} onClick={() => setSel(i)}>
                        <Mail size={14} />
                        <span className={s.blockName}>Email {i + 1}</span>
                        <span className={s.blockPeek}>{x.subject || "No subject yet"}</span>
                        <button type="button" className={s.iconBtn} aria-label="Move up" disabled={locked || i === 0} onClick={(e) => { e.stopPropagation(); moveStep(i, -1); }}><ArrowUp /></button>
                        <button type="button" className={s.iconBtn} aria-label="Move down" disabled={locked || i === draft.steps.length - 1} onClick={(e) => { e.stopPropagation(); moveStep(i, 1); }}><ArrowDown /></button>
                        <button type="button" className={s.iconBtn} aria-label="Duplicate" disabled={locked || draft.steps.length >= 10} onClick={(e) => { e.stopPropagation(); setDraft({ ...draft, steps: [...draft.steps.slice(0, i + 1), { ...x }, ...draft.steps.slice(i + 1)] }); setSel(i + 1); }}><Copy /></button>
                        <button type="button" className={s.iconBtn} aria-label="Remove" disabled={locked} onClick={(e) => { e.stopPropagation(); setDraft({ ...draft, steps: draft.steps.filter((_, k) => k !== i) }); setSel(Math.max(0, Math.min(sel, draft.steps.length - 2))); }}><Trash2 /></button>
                      </div>
                      {i === sel && (
                        <div className={s.blockBody}>
                          <label className={s.field}>
                            <span>Subject</span>
                            <input className={s.input} value={x.subject} disabled={locked} onFocus={track("subject")} onChange={(e) => setStep(i, { subject: e.target.value })} placeholder="{{first_name}}, …" />
                          </label>
                          <label className={s.field}>
                            <span>Preview text <em>grey line after the subject</em></span>
                            <input className={s.input} value={x.preview_text ?? ""} disabled={locked} onFocus={track("preview_text")} onChange={(e) => setStep(i, { preview_text: e.target.value })} />
                          </label>
                          <label className={s.field}>
                            <span>Coupon code <em>optional, fills {"{{coupon_code}}"}</em></span>
                            <input className={s.input} value={x.coupon_code ?? ""} disabled={locked} onChange={(e) => setStep(i, { coupon_code: e.target.value.toUpperCase() || undefined })} placeholder="PROMUNCH10" />
                          </label>
                          <div className={s.field}>
                            <span>Insert a personal detail</span>
                            <div className={s.toolbar}>
                              {tags.map((t) => <button key={t.tag} type="button" disabled={locked} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(`{{${t.tag}}}`)}>{t.label}</button>)}
                            </div>
                          </div>
                          <div className={s.field}>
                            <span>Add to the email</span>
                            <div className={s.toolbar}>
                              {SNIPPETS.map((sn) => <button key={sn.label} type="button" disabled={locked} onMouseDown={(e) => e.preventDefault()} onClick={() => { lastField.current = lastField.current?.key === "body_html" ? lastField.current : null; insert(sn.html, "body_html"); }}>{sn.label}</button>)}
                            </div>
                          </div>
                          <label className={s.field}>
                            <span>Email body <em>HTML, preview on the right</em></span>
                            <textarea className={s.textarea} style={{ minHeight: 260, fontFamily: "var(--pm-mono)", fontSize: 12.5 }} value={x.body_html} disabled={locked} onFocus={track("body_html")} onChange={(e) => setStep(i, { body_html: e.target.value })} />
                          </label>
                          <button type="button" className="pm2-btn ghost" disabled={busy !== null || dirty} title={dirty ? "Save first" : undefined} onClick={() => test(i)}>
                            <Send size={14} /> Send me just this email
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pm2-panel" style={{ padding: 14, display: "grid", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>Checks</h3>
              <ul className={s.issues}>
                {issues.length === 0 && <li className={`${s.issue} ${s.issueOk}`}><CheckCircle2 /> All good.</li>}
                {issues.map((it, k) => (
                  <li key={k} className={`${s.issue} ${it.level === "block" ? s.issueBlock : s.issueWarn}`}>
                    {it.level === "block" ? <OctagonAlert /> : <AlertTriangle />} {it.message}
                  </li>
                ))}
              </ul>
            </div>

            {admin && !on && (
              <button type="button" className="pm2-btn ghost" style={{ color: "var(--pm-terra)", justifySelf: "start" }} disabled={busy !== null} onClick={() => setDialog("delete")}>
                <Trash2 size={14} /> Delete automation
              </button>
            )}
          </div>

          {/* ---------- right: preview ---------- */}
          <div className={s.previewWrap} style={{ position: "sticky", top: 12 }}>
            <div className={s.previewBar}>
              <span className={s.grow}>{step ? `Email ${sel + 1} preview` : "Preview"}{preview?.source ? ` · filled from ${preview.source}` : ""}</span>
              <button type="button" className={s.iconBtn} aria-label="Desktop" onClick={() => setMobile(false)} style={{ color: mobile ? undefined : "var(--pm-ink)" }}><Monitor /></button>
              <button type="button" className={s.iconBtn} aria-label="Phone" onClick={() => setMobile(true)} style={{ color: mobile ? "var(--pm-ink)" : undefined }}><Smartphone /></button>
            </div>
            {step && preview ? (
              <>
                <div className={s.inboxLine}><b>{preview.subject || "(no subject)"}</b> <span>{step.preview_text ? ` · ${step.preview_text}` : ""}</span></div>
                <PreviewFrame html={preview.html} mobile={mobile} />
              </>
            ) : (
              <div style={{ padding: 16 }}><span className={s.hint}>{step ? "Rendering…" : "Add an email to see it here."}</span></div>
            )}
          </div>
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
