"use client";

// Email Studio campaign: a 3-step wizard (Email → Audience → Review & send)
// with autosave, then the results report once it has gone out.
// Guardrails (checks, test-send gate, approval, warm-up cap) are enforced on
// the server; this page only explains them.

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, OctagonX, Send, FlaskConical, Copy, Save } from "lucide-react";
import { Callout, ConfirmDialog } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { Builder } from "@/components/email-studio/Builder";
import { SegmentEditor, AudienceCount } from "@/components/email-studio/SegmentEditor";
import { ReportView } from "@/components/email-studio/ReportView";
import { useSegments, useStudioSettings } from "@/components/email-studio/hooks";
import { getJson, sendJson, when, niceText } from "@/components/email-studio/api";
import { parseDesign, type EmailDesign } from "@/lib/email-studio/design";
import { parseRules, type AudienceRules } from "@/lib/email-studio/segments";
import type { Issue } from "@/lib/email-studio/checks";
import s from "@/components/email-studio/studio.module.css";

type Campaign = {
  id: string;
  name: string;
  subject: string | null;
  preview_text: string | null;
  design: unknown;
  body_html: string | null;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  audience_rules: unknown;
  segment_filter: unknown;
  segment_id: string | null;
  approval_status: string | null;
  approved_by: string | null;
  test_sent_at: string | null;
};

type Readiness = {
  issues: Issue[];
  recipients: number;
  audienceSummary: string;
  testIsCurrent: boolean;
  needsApproval: boolean;
  capBlocker: string | null;
  warmupMax: number | null;
  approvalThreshold: number;
  status: string;
  approval_status: string;
  approved_by: string | null;
  scheduled_at: string | null;
  test_sent_at: string | null;
  isAdmin: boolean;
};

type Step = "email" | "audience" | "review";

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({
    queryKey: ["email-studio-campaign", id],
    queryFn: () => getJson<{ campaign: Campaign; testIsCurrent: boolean }>(`/api/email-studio/campaigns/${id}`),
  });

  if (q.isLoading) {
    return (
      <>
        <StudioHeader tab="campaigns" title="Campaign" back={{ href: "/dashboard/email/campaigns", label: "Campaigns" }} />
        <div className="pm2-body"><div className="pm2-skel" style={{ minHeight: 500 }} /></div>
      </>
    );
  }
  if (q.error || !q.data) {
    return (
      <>
        <StudioHeader tab="campaigns" title="Campaign" back={{ href: "/dashboard/email/campaigns", label: "Campaigns" }} />
        <div className="pm2-body"><Callout tone="crit" title="Could not open this campaign" body={(q.error as Error)?.message} /></div>
      </>
    );
  }
  const c = q.data.campaign;
  if (c.status === "sent" || c.status === "sending") return <SentView c={c} />;
  return <Editor key={c.id} initial={c} />;
}

function SentView({ c }: { c: Campaign }) {
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <StudioHeader
        tab="campaigns"
        title={c.name}
        back={{ href: "/dashboard/email/campaigns", label: "Campaigns" }}
        summary={
          <span className={s.sumLine}>
            <span className={`${s.statusText} ${s.statusLive}`}>{c.status === "sent" ? "Sent" : "Sending now"}</span>
            <span>
              “{niceText(c.subject ?? "")}” {c.sent_at ? `· ${when(c.sent_at)}` : ""}
            </span>
          </span>
        }
        actions={
          <button
            type="button"
            className="pm2-btn"
            onClick={async () => {
              try {
                const r = await sendJson<{ id: string }>(`/api/email-studio/campaigns/${c.id}/duplicate`, "POST");
                router.push(`/dashboard/email/campaigns/${r.id}`);
              } catch (e) {
                toast.push({ kind: "error", text: (e as Error).message });
              }
            }}
          >
            <Copy size={14} /> Duplicate
          </button>
        }
      />
      <div className="pm2-body">
        <ReportView id={c.id} />
      </div>
    </>
  );
}

function initialRules(c: Campaign): AudienceRules {
  if (c.audience_rules) return parseRules(c.audience_rules);
  return { conditions: [] };
}

function Editor({ initial }: { initial: Campaign }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const settingsQ = useStudioSettings();
  const segmentsQ = useSegments();

  const [step, setStep] = useState<Step>("email");
  const [name, setName] = useState(initial.name);
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [preview, setPreview] = useState(initial.preview_text ?? "");
  const [design, setDesign] = useState<EmailDesign | null>(parseDesign(initial.design));
  const [rules, setRules] = useState<AudienceRules>(initialRules(initial));
  const [segmentId, setSegmentId] = useState<string | null>(initial.segment_id);
  const [status, setStatus] = useState(initial.status);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");

  // Autosave: collect changed fields, flush 800ms after the last edit.
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const body = pending.current;
    if (Object.keys(body).length === 0) return true;
    pending.current = {};
    setSaveState("saving");
    try {
      await sendJson(`/api/email-studio/campaigns/${initial.id}`, "PATCH", body);
      setSaveState(Object.keys(pending.current).length ? "dirty" : "saved");
      qc.invalidateQueries({ queryKey: ["email-studio-readiness", initial.id] });
      return true;
    } catch (e) {
      pending.current = { ...body, ...pending.current };
      setSaveState("error");
      toast.push({ kind: "error", text: `Not saved: ${(e as Error).message}` });
      return false;
    }
  }, [initial.id, qc, toast]);
  const queue = useCallback(
    (patch: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...patch };
      setSaveState("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 800);
    },
    [flush],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const editable = status === "draft" || status === "paused";
  const brand = settingsQ.data?.settings.brand;

  if (!design) {
    return (
      <>
        <StudioHeader tab="campaigns" title={name} back={{ href: "/dashboard/email/campaigns", label: "Campaigns" }} />
        <div className="pm2-body">
          <Callout
            tone="plain"
            title="This is an old HTML campaign"
            body="It was made before Email Studio, so it can't be edited in the builder. Duplicate a template to build a new one."
            action={<button type="button" className="pm2-btn" onClick={() => router.push("/dashboard/email/templates")}>Pick a template</button>}
          />
        </div>
      </>
    );
  }

  const saveLabel = { saved: "All changes saved", saving: "Saving…", dirty: "Unsaved changes", error: "Not saved" }[saveState];

  return (
    <>
      <StudioHeader
        tab="campaigns"
        title={name || "Untitled campaign"}
        back={{ href: "/dashboard/email/campaigns", label: "Campaigns" }}
        actions={
          <>
            <span className={s.hint} style={{ color: saveState === "error" ? "var(--pm-terra)" : undefined }}>{saveLabel}</span>
            <SaveAsTemplate design={design} subject={subject} preview={preview} />
          </>
        }
      />
      <div className="pm2-body">
        {status === "scheduled" && <ScheduledBanner id={initial.id} onUnscheduled={() => setStatus("draft")} />}
        {initial.approval_status === "rejected" && editable && (
          <Callout tone="crit" title="An admin rejected this campaign" body="Make the changes they asked for, send a new test and submit it again." />
        )}

        <div className={s.stepBar}>
          <div className={s.steps}>
            {(["email", "audience", "review"] as Step[]).map((k, i) => (
              <button
                key={k}
                type="button"
                className={`${s.step} ${step === k ? s.on : ""}`}
                onClick={async () => {
                  await flush();
                  setStep(k);
                }}
              >
                <b>{i + 1}</b>
                <span className={s.stepLong}>{k === "email" ? "Write" : k === "audience" ? "Who gets it" : "Check & send"}</span>
                <span className={s.stepShort}>{k === "email" ? "Write" : k === "audience" ? "Who" : "Send"}</span>
              </button>
            ))}
          </div>
          {step !== "review" && (
            <button
              type="button"
              className={`pm2-btn dark ${s.nextBtn}`}
              onClick={async () => {
                await flush();
                setStep(step === "email" ? "audience" : "review");
              }}
            >
              Next: {step === "email" ? "Who gets it" : "Check & send"}
            </button>
          )}
        </div>

        {step === "email" && (
          <>
            <div className="pm2-panel" style={{ padding: 16 }}>
              <div className="pm2-g3">
                <label className={s.field}>
                  <span>Campaign name <em>only your team sees this</em></span>
                  <input className={s.input} value={name} disabled={!editable} onChange={(e) => { setName(e.target.value); queue({ name: e.target.value }); }} />
                </label>
                <label className={s.field}>
                  <span>Subject line <em>{subject.length}/50</em></span>
                  <input className={s.input} value={subject} disabled={!editable} placeholder="e.g. Your Diwali snack box is here" onChange={(e) => { setSubject(e.target.value); queue({ subject: e.target.value }); }} />
                </label>
                <label className={s.field}>
                  <span>Preview text <em>shows after the subject</em></span>
                  <input className={s.input} value={preview} disabled={!editable} placeholder="One line that makes them open it" onChange={(e) => { setPreview(e.target.value); queue({ preview_text: e.target.value }); }} />
                </label>
              </div>
            </div>
            {brand ? (
              <Builder
                design={design}
                brand={brand}
                subject={subject}
                previewText={preview}
                onChange={(d) => {
                  if (!editable) return;
                  setDesign(d);
                  queue({ design: d });
                }}
              />
            ) : (
              <div className="pm2-skel" style={{ minHeight: 500 }} />
            )}
          </>
        )}

        {step === "audience" && (
          <AudienceStep
            rules={rules}
            segmentId={segmentId}
            segments={segmentsQ.data}
            disabled={!editable}
            onPick={(r, seg) => {
              setRules(r);
              setSegmentId(seg);
              queue(seg ? { segment_id: seg } : { audience_rules: r });
            }}
          />
        )}

        {step === "review" && (
          <ReviewStep
            id={initial.id}
            flush={flush}
            editable={editable}
            onDone={(next) => {
              setStatus(next);
              qc.invalidateQueries({ queryKey: ["email-studio-campaign", initial.id] });
              qc.invalidateQueries({ queryKey: ["email-studio-campaigns"] });
            }}
            goTo={setStep}
          />
        )}
      </div>
    </>
  );
}

function SaveAsTemplate({ design, subject, preview }: { design: EmailDesign; subject: string; preview: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  return (
    <button
      type="button"
      className="pm2-btn"
      onClick={async () => {
        const name = window.prompt("Name this template", "");
        if (!name) return;
        try {
          await sendJson("/api/email-studio/templates", "POST", { name, design, subject, preview_text: preview });
          qc.invalidateQueries({ queryKey: ["email-studio-templates"] });
          toast.push({ kind: "success", text: `Saved "${name}" to Templates.` });
        } catch (e) {
          toast.push({ kind: "error", text: (e as Error).message });
        }
      }}
    >
      <Save size={14} /> Save as template
    </button>
  );
}

function ScheduledBanner({ id, onUnscheduled }: { id: string; onUnscheduled: () => void }) {
  const q = useQuery({ queryKey: ["email-studio-campaign", id], queryFn: () => getJson<{ campaign: Campaign }>(`/api/email-studio/campaigns/${id}`) });
  const toast = useToast();
  return (
    <Callout
      tone="plain"
      title={`Scheduled for ${when(q.data?.campaign.scheduled_at)}`}
      body="It will go out automatically. To change anything, unschedule it first."
      action={
        <button
          type="button"
          className="pm2-btn"
          onClick={async () => {
            try {
              await sendJson(`/api/email-studio/campaigns/${id}`, "PATCH", { unschedule: true });
              onUnscheduled();
              toast.push({ kind: "success", text: "Unscheduled. It's a draft again." });
            } catch (e) {
              toast.push({ kind: "error", text: (e as Error).message });
            }
          }}
        >
          Unschedule
        </button>
      }
    />
  );
}

function AudienceStep({
  rules,
  segmentId,
  segments,
  disabled,
  onPick,
}: {
  rules: AudienceRules;
  segmentId: string | null;
  segments: ReturnType<typeof useSegments>["data"];
  disabled: boolean;
  onPick: (r: AudienceRules, segmentId: string | null) => void;
}) {
  const key = JSON.stringify(rules);
  const presetKey = segmentId ? null : segments?.presets.find((p) => JSON.stringify(p.rules) === key)?.key ?? null;
  const [custom, setCustom] = useState(!segmentId && !presetKey && rules.conditions.length > 0);
  return (
    <div className="pm2-g21">
      <div className={s.stack}>
        <div className="pm2-panel" style={{ padding: 16 }}>
          <div className={s.field} style={{ marginBottom: 10 }}><span>Quick audiences</span></div>
          <div className="pm2-chips">
            {(segments?.presets ?? []).map((p) => (
              <button
                key={p.key}
                type="button"
                disabled={disabled}
                className={`pm2-chip ${!custom && presetKey === p.key ? "on" : ""}`}
                title={p.hint}
                onClick={() => {
                  setCustom(false);
                  onPick(p.rules, null);
                }}
              >
                {p.label}
              </button>
            ))}
            <button type="button" disabled={disabled} className={`pm2-chip ${custom ? "on" : ""}`} onClick={() => { setCustom(true); if (segmentId) onPick(rules, null); }}>
              Custom filters
            </button>
          </div>
          {!!segments?.saved.length && (
            <>
              <div className={s.field} style={{ margin: "14px 0 8px" }}><span>Saved audiences</span></div>
              <div className="pm2-chips">
                {segments.saved.map((sg) => (
                  <button
                    key={sg.id}
                    type="button"
                    disabled={disabled}
                    className={`pm2-chip ${segmentId === sg.id ? "on" : ""}`}
                    title={sg.summary}
                    onClick={() => {
                      setCustom(false);
                      onPick(parseRules(sg.rules), sg.id);
                    }}
                  >
                    {sg.name}
                    {sg.last_count != null && <em>{sg.last_count}</em>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {custom && (
          <div className="pm2-panel" style={{ padding: 16 }}>
            <SegmentEditor rules={rules} onChange={(r) => onPick(r, null)} />
          </div>
        )}
        <div className={s.hint}>
          Only people who agreed to marketing email are ever included. Unsubscribes, bounces and spam complaints are removed automatically.
        </div>
      </div>
      <AudienceCount rules={rules} />
    </div>
  );
}

function IssueRow({ i }: { i: Issue }) {
  return (
    <li className={`${s.issue} ${i.level === "block" ? s.issueBlock : s.issueWarn}`}>
      {i.level === "block" ? <OctagonX /> : <AlertTriangle />}
      {i.message}
    </li>
  );
}

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ReviewStep({
  id,
  flush,
  editable,
  onDone,
  goTo,
}: {
  id: string;
  flush: () => Promise<boolean>;
  editable: boolean;
  onDone: (status: string) => void;
  goTo: (s: Step) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["email-studio-readiness", id],
    queryFn: async () => {
      await flush();
      return getJson<Readiness>(`/api/email-studio/campaigns/${id}/send`);
    },
  });
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [when_, setWhen] = useState<"now" | "schedule">("now");
  const [at, setAt] = useState(() => toLocalInput(new Date(Date.now() + 2 * 3600_000)));
  const [confirm, setConfirm] = useState(false);

  if (q.isLoading) return <div className="pm2-skel" style={{ minHeight: 320 }} />;
  if (q.error || !q.data) return <Callout tone="crit" title="Could not check this campaign" body={(q.error as Error)?.message} />;
  const r = q.data;
  const blockers = r.issues.filter((i) => i.level === "block");
  const warns = r.issues.filter((i) => i.level === "warn");
  const pending = r.approval_status === "pending";
  const canSubmit = editable && blockers.length === 0 && r.testIsCurrent && !r.capBlocker && !pending;
  const willNeedApproval = r.needsApproval && !r.isAdmin;

  const sendTest = async () => {
    setBusy("test");
    try {
      await flush();
      const res = await sendJson<{ to: string[] }>(`/api/email-studio/campaigns/${id}/test`, "POST", testTo.trim() ? { to: testTo } : {});
      toast.push({ kind: "success", text: `Test sent to ${res.to.join(", ")}. Check the inbox (and Promotions tab).` });
      qc.invalidateQueries({ queryKey: ["email-studio-readiness", id] });
    } catch (e) {
      toast.push({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    setBusy("send");
    try {
      const body = when_ === "schedule" ? { when: "schedule", scheduled_at: new Date(at).toISOString() } : { when: "now" };
      const res = await sendJson<{ pending?: boolean; scheduled?: boolean; sent?: boolean; total_sent?: number; scheduled_at?: string }>(
        `/api/email-studio/campaigns/${id}/send`,
        "POST",
        body,
      );
      if (res.pending) {
        toast.push({ kind: "info", text: "Sent to an admin for approval. It goes out once they approve." });
        onDone("draft");
      } else if (res.scheduled) {
        toast.push({ kind: "success", text: `Scheduled for ${when(res.scheduled_at)}.` });
        onDone("scheduled");
      } else {
        toast.push({ kind: "success", text: `Sent to ${res.total_sent ?? 0} people.` });
        onDone("sent");
        router.refresh();
      }
    } catch (e) {
      toast.push({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
      setConfirm(false);
      qc.invalidateQueries({ queryKey: ["email-studio-readiness", id] });
    }
  };

  const decide = async (decision: "approve" | "reject") => {
    setBusy(decision);
    try {
      const res = await sendJson<{ sent?: boolean; scheduled?: boolean; total_sent?: number }>(`/api/email-studio/campaigns/${id}/approve`, "POST", { decision });
      toast.push({
        kind: "success",
        text: decision === "reject" ? "Rejected. It's back with the author as a draft." : res.scheduled ? "Approved and scheduled." : `Approved and sent to ${res.total_sent ?? 0} people.`,
      });
      onDone(decision === "reject" ? "draft" : res.scheduled ? "scheduled" : "sent");
    } catch (e) {
      toast.push({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["email-studio-readiness", id] });
    }
  };

  return (
    <div className="pm2-g21">
      <div className={s.stack} style={{ gap: 16 }}>
        <div className="pm2-panel" style={{ padding: 16 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 17 }}>Checks</h3>
          {r.issues.length === 0 ? (
            <ul className={s.issues}><li className={`${s.issue} ${s.issueOk}`}><CheckCircle2 /> Everything looks good.</li></ul>
          ) : (
            <ul className={s.issues}>
              {blockers.map((i, k) => <IssueRow key={`b${k}`} i={i} />)}
              {warns.map((i, k) => <IssueRow key={`w${k}`} i={i} />)}
            </ul>
          )}
          {blockers.length > 0 && (
            <div className={s.row} style={{ marginTop: 10 }}>
              <button type="button" className="pm2-btn sm" onClick={() => goTo("email")}>Fix in the email</button>
              <span className={s.hint}>Red items must be fixed before sending. Yellow ones are advice.</span>
            </div>
          )}
        </div>

        <div className="pm2-panel" style={{ padding: 16 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 17 }}>1. Send yourself a test</h3>
          <div className={s.checklist}>
            <div className={s.check}>
              {r.testIsCurrent ? <CheckCircle2 className={s.good} /> : <Clock className={s.wait} />}
              {r.testIsCurrent
                ? `Test of this version sent ${when(r.test_sent_at)}. Check it on your phone before sending.`
                : r.test_sent_at
                  ? "You changed the email after the last test. Send a new one."
                  : "Required: see it in a real inbox before customers do."}
            </div>
          </div>
          <div className={s.row} style={{ marginTop: 10 }}>
            <input className={`${s.input} ${s.grow}`} placeholder="Your email (leave empty) or up to 5, comma separated" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <button type="button" className="pm2-btn" disabled={busy !== null} onClick={sendTest}>
              <FlaskConical size={14} /> {busy === "test" ? "Sending…" : "Send test"}
            </button>
          </div>
        </div>

        <div className="pm2-panel" style={{ padding: 16 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 17 }}>2. Send or schedule</h3>
          {r.capBlocker && <Callout tone="crit" title="Can't send this yet" body={r.capBlocker} />}
          {pending && (
            <Callout
              tone="plain"
              title="Waiting for an admin to approve"
              body={r.scheduled_at ? `Requested for ${when(r.scheduled_at)}.` : "It will send as soon as it's approved."}
              action={
                r.isAdmin ? (
                  <span className={s.row}>
                    <button type="button" className="pm2-btn pri" disabled={busy !== null} onClick={() => decide("approve")}>
                      {busy === "approve" ? "Approving…" : r.scheduled_at ? "Approve" : `Approve and send to ${r.recipients}`}
                    </button>
                    <button type="button" className="pm2-btn" disabled={busy !== null} onClick={() => decide("reject")}>Reject</button>
                  </span>
                ) : undefined
              }
            />
          )}
          {!pending && editable && (
            <div className={s.stack}>
              <div className={s.row}>
                <span className="pm2-seg">
                  <button type="button" className={when_ === "now" ? "on" : ""} onClick={() => setWhen("now")}>Send now</button>
                  <button type="button" className={when_ === "schedule" ? "on" : ""} onClick={() => setWhen("schedule")}>Schedule</button>
                </span>
                {when_ === "schedule" && (
                  <input type="datetime-local" className={s.input} style={{ width: "auto" }} value={at} onChange={(e) => setAt(e.target.value)} />
                )}
              </div>
              {willNeedApproval && (
                <div className={s.hint}>
                  {r.warmupMax != null
                    ? "While the new sending domain warms up, an admin approves every campaign."
                    : `Campaigns over ${r.approvalThreshold} people need an admin's approval.`}{" "}
                  Submitting sends it to them.
                </div>
              )}
              <div className={s.row}>
                <button type="button" className="pm2-btn pri" disabled={!canSubmit || busy !== null} onClick={() => setConfirm(true)}>
                  <Send size={14} />
                  {willNeedApproval ? "Submit for approval" : when_ === "schedule" ? "Schedule" : `Send to ${r.recipients.toLocaleString("en-IN")} people`}
                </button>
                {!canSubmit && !r.capBlocker && (
                  <span className={s.hint}>{blockers.length ? "Fix the red items first." : !r.testIsCurrent ? "Send a test of this version first." : ""}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="pm2-panel" style={{ padding: 16, display: "grid", gap: 8, alignContent: "start" }}>
        <div className={s.hint}>Recipients</div>
        <div className={s.bigCount}>{r.recipients.toLocaleString("en-IN")}</div>
        <div className={s.hint}>{r.audienceSummary}</div>
        <button type="button" className="pm2-btn sm" style={{ justifySelf: "start" }} onClick={() => goTo("audience")}>Change audience</button>
        {r.warmupMax != null && (
          <div className={s.hint} style={{ marginTop: 8 }}>
            Domain warm-up is on: up to {r.warmupMax} people per campaign.
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={willNeedApproval ? "Submit for approval?" : when_ === "schedule" ? "Schedule this campaign?" : `Send to ${r.recipients.toLocaleString("en-IN")} people now?`}
          body={
            willNeedApproval
              ? "An admin will review it. You'll see it here as waiting for approval."
              : when_ === "schedule"
                ? `It will go out on ${new Date(at).toLocaleString("en-IN")} to everyone in the audience at that moment.`
                : "This can't be undone. Everyone in the audience gets the email within a few minutes."
          }
          confirmLabel={willNeedApproval ? "Submit" : when_ === "schedule" ? "Schedule" : "Send now"}
          busy={busy === "send"}
          onConfirm={submit}
          onClose={() => setConfirm(false)}
        />
      )}
    </div>
  );
}
