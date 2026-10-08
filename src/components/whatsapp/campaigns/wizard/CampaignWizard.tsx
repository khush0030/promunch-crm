"use client";

// Full-page campaign wizard: Template -> Message -> Audience -> When ->
// Follow-ups (optional) -> Review. Follow-ups live in the wizard state and are
// saved as linked campaigns once the parent draft exists.
// Autosaves a draft from the moment a template is picked. Launching re-saves
// everything, checks the server kept the exact audience, then schedules or
// starts the send and opens the campaign page.
//
// URL params on /new: ?template=<id> (preselect), ?from=<campaign id>
// (duplicate), ?segment=<key>, ?retarget=<campaign id>&stage=<stage>.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Rocket } from "lucide-react";
import { Callout, ConfirmDialog, PageHeader } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { friendlyTemplateName } from "@/lib/whatsapp/templateKind";
import type { Campaign, RetargetStage } from "../../types";
import {
  api,
  describeSendResult,
  errorMessage,
  useApprovedTemplates,
  useAudiencePreview,
  useCampaign,
  useCampaigns,
  useInvalidateCampaigns,
  useTierMix,
  type CampaignWrite,
} from "../api";
import { CampaignPreview } from "../bits";
import {
  DEFAULT_AUDIENCE,
  RETARGET_STAGES,
  STEPS,
  audienceFromFilter,
  audienceProblems,
  buildAudienceFilter,
  buildTemplateVars,
  campaignTemplates,
  contentProblems,
  effectiveStart,
  filterKey,
  fmtInt,
  fmtIst,
  initialVars,
  isColdAudience,
  pacing,
  parseIstInput,
  samplesUsed,
  sameFilter,
  scheduleProblems,
  toIstInput,
  typedCountMatches,
  type AudienceState,
  type CampaignTemplate,
  type ScheduleState,
} from "../logic";
import { campaignHref } from "../useCampaignActions";
import {
  draftFromCampaign,
  followupProblems,
  followupRuleSentence,
  duplicateWarnings,
  followupTemplates,
  draftHours,
  type FollowupDraft,
} from "../journey";
import { StepFollowups } from "./StepFollowups";
import { followupPayload, useFollowupSync } from "./useFollowupSync";
import { AudiencePreviewPanel } from "./AudiencePreviewPanel";
import { StepAudience } from "./StepAudience";
import { StepContent, type ContentValue } from "./StepContent";
import { StepReview, describeAudience } from "./StepReview";
import { StepSchedule } from "./StepSchedule";
import { StepTemplate } from "./StepTemplate";
import { useAutosave } from "./useAutosave";
import s from "../campaigns.module.css";
import w from "./wizard.module.css";

type Form = ContentValue & { templateId: string | null; audience: AudienceState; schedule: ScheduleState; followups: FollowupDraft[] };

const EMPTY: Form = {
  name: "",
  templateId: null,
  vars: {},
  mediaUrl: null,
  ai: false,
  brief: "",
  audience: DEFAULT_AUDIENCE,
  schedule: { when: "now", at: "", repeat: "", until: "" },
  followups: [],
};

const EDITABLE = new Set(["draft", "scheduled", "paused", "failed"]);
const BACK_HREF = "/dashboard/whatsapp?tab=campaigns";

function makePayload(f: Form, tpl: CampaignTemplate | null, audienceFilter: CampaignWrite["audience_filter"] | undefined): CampaignWrite | null {
  if (!f.templateId) return null;
  const p: CampaignWrite = {
    name: f.name.trim() || "Untitled campaign",
    template_id: f.templateId,
    template_vars: buildTemplateVars(f.vars, f.ai, f.brief, tpl),
    header_media_url: f.mediaUrl,
  };
  if (audienceFilter) p.audience_filter = audienceFilter;
  return p;
}

function formFromCampaign(c: Campaign, copy: boolean): Form {
  const vars = { ...(c.template_vars ?? {}) };
  const brief = vars._ai_brief ?? "";
  delete vars._ai_brief;
  const at = c.scheduled_at ? Date.parse(c.scheduled_at) : NaN;
  return {
    name: copy ? `Copy of ${c.name}` : c.name,
    templateId: c.template_id,
    vars,
    mediaUrl: c.header_media_url ?? null,
    ai: !!brief,
    brief,
    audience: audienceFromFilter(c.audience_filter),
    schedule:
      !copy && c.status === "scheduled" && Number.isFinite(at)
        ? { when: "schedule", at: toIstInput(at), repeat: c.repeat_rule ?? "", until: c.repeat_until ? toIstInput(Date.parse(c.repeat_until)).slice(0, 10) : "" }
        : EMPTY.schedule,
    followups: [],
  };
}

export default function CampaignWizard({ editId }: { editId?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const invalidate = useInvalidateCampaigns();
  const templatesQ = useApprovedTemplates();
  const campaignsQ = useCampaigns();
  const sourceId = editId ?? params.get("from");
  const sourceQ = useCampaign(sourceId);

  const [form, setForm] = useState<Form>(EMPTY);
  const [ready, setReady] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(editId ?? null);
  const [status, setStatus] = useState<string>("draft");
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [typed, setTyped] = useState("");
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [sampleOk, setSampleOk] = useState(false);

  const templates = useMemo(() => templatesQ.data ?? [], [templatesQ.data]);
  // Only marketing templates can be sent as a campaign (an old draft pointing
  // at an internal or customer-service template has to pick again).
  const tpl = useMemo(
    () => campaignTemplates(templates).find((t) => t.id === form.templateId) ?? null,
    [templates, form.templateId],
  );

  const fuTemplates = useMemo(() => followupTemplates(templates), [templates]);

  /* ---------- audience + live preview ---------- */
  const filter = useMemo(() => buildAudienceFilter(form.audience), [form.audience]);
  const fKey = filterKey(filter);
  const audProblems = audienceProblems(form.audience);
  const [previewFilter, setPreviewFilter] = useState<typeof filter | null>(null);
  useEffect(() => {
    if (audProblems.length) {
      setPreviewFilter(null);
      return;
    }
    const t = setTimeout(() => setPreviewFilter(filter), 400);
    return () => clearTimeout(t);
    // fKey captures the filter's content; audProblems derive from the same state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fKey, audProblems.length]);
  const previewQ = useAudiencePreview(previewFilter, filterKey(previewFilter), campaignId);
  const previewCurrent = previewFilter != null && filterKey(previewFilter) === fKey && !!previewQ.data;
  const verified = previewCurrent && (!previewQ.data?.filter || sameFilter(filter, previewQ.data.filter));
  const people = previewCurrent ? previewQ.data!.counts.eligible_total : null;

  const tierTags =
    form.audience.mode === "segment" || (form.audience.mode === "tags" && !form.audience.tagsAll.length && !form.audience.excludeTags.length)
      ? filter.tags ?? []
      : null;
  const tierQ = useTierMix(tierTags && tierTags.length ? tierTags : null);
  const coldShare = tierQ.data?.byTier && tierQ.data.count
    ? ((tierQ.data.byTier.imported ?? 0) + (tierQ.data.byTier.suppressed ?? 0)) / tierQ.data.count
    : null;
  const risky = isColdAudience(form.audience.mode, coldShare);

  const startMs = effectiveStart(form.schedule);
  const pace = pacing(people ?? 0, previewCurrent ? previewQ.data!.budget : null, previewCurrent ? previewQ.data!.eta_days : null, startMs);

  /* ---------- autosave ---------- */
  const editable = EDITABLE.has(status);
  const payload = useMemo(
    () => makePayload(form, tpl, !audProblems.length && verified ? filter : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, tpl, verified, fKey, audProblems.length],
  );
  const onCreated = useCallback((c: Campaign) => {
    setCampaignId(c.id);
    setStatus(c.status);
    // Keep the address bar on something that reopens this draft after a reload.
    window.history.replaceState(null, "", `/dashboard/whatsapp/campaigns/${c.id}/edit`);
  }, []);
  const autosave = useAutosave({ initialId: editId ?? null, payload, enabled: ready && editable && !launching, onCreated });
  const onFollowupSaved = useCallback((key: string, id: string) => {
    setForm((f) => ({ ...f, followups: f.followups.map((d) => (d.key === key ? { ...d, id } : d)) }));
  }, []);
  // Exact copies of the main message or an earlier follow-up: warned at once,
  // never sent to the server (it would refuse them).
  const dupWarnings = useMemo(
    () =>
      duplicateWarnings(
        tpl ? { template_id: tpl.id, template_vars: buildTemplateVars(form.vars, form.ai, form.brief, tpl), header_media_url: form.mediaUrl } : null,
        form.followups.map((d) => {
          const ft = fuTemplates.find((t) => t.id === d.templateId) ?? null;
          return { key: d.key, msg: { template_id: ft?.id ?? null, template_vars: buildTemplateVars(d.vars, false, "", ft), header_media_url: d.mediaUrl } };
        }),
        (id) => fuTemplates.find((t) => t.id === id)?.header_media_url ?? null,
      ),
    [tpl, form.vars, form.ai, form.brief, form.mediaUrl, form.followups, fuTemplates],
  );
  const dupKeys = useMemo(() => new Set(Object.keys(dupWarnings)), [dupWarnings]);
  const fuSync = useFollowupSync({
    skip: dupKeys,
    parentId: campaignId,
    parentName: form.name,
    drafts: form.followups,
    templates: fuTemplates,
    enabled: ready && editable && !launching,
    onSaved: onFollowupSaved,
  });

  /* ---------- initialise from URL / existing campaign ---------- */
  useEffect(() => {
    if (ready || !templatesQ.isFetched) return;
    if (sourceId && (!sourceQ.data || !campaignsQ.isFetched)) return;
    let next: Form = { ...EMPTY };
    let startStep = 0;
    if (sourceQ.data) {
      next = formFromCampaign(sourceQ.data, !editId);
      if (editId) setStatus(sourceQ.data.status);
      startStep = next.templateId ? 1 : 0;
    }
    const tId = params.get("template");
    const t = tId ? campaignTemplates(templates).find((x) => x.id === tId) : null;
    if (t) {
      next = { ...next, templateId: t.id, vars: initialVars(t), mediaUrl: null };
      startStep = 1;
    }
    const seg = params.get("segment");
    if (seg) next = { ...next, audience: { ...DEFAULT_AUDIENCE, mode: "segment", segments: [seg] } };
    const rt = params.get("retarget");
    if (rt) {
      const stage = (RETARGET_STAGES.find((x) => x.key === params.get("stage"))?.key ?? "not_read") as RetargetStage;
      const src = (campaignsQ.data ?? []).find((c) => c.id === rt);
      next = {
        ...next,
        name: next.name || `Follow-up: ${src?.name ?? "past campaign"}`,
        audience: { ...DEFAULT_AUDIENCE, mode: "retarget", retargetCampaignId: rt, retargetStage: stage },
      };
    }
    // Direct follow-ups come along: as they are when editing, as new copies
    // when duplicating. Deeper ones are managed on the campaign page.
    if (sourceQ.data) {
      const kids = (campaignsQ.data ?? [])
        .filter((c) => c.followup_of === sourceQ.data!.id && !["cancelled", "failed"].includes(c.status))
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .slice(0, editId ? undefined : 3);
      const drafts = kids.map((c) => draftFromCampaign(c, !editId));
      next = { ...next, followups: drafts };
      if (editId) {
        const parentName = next.name.trim() || "Untitled campaign";
        fuSync.setBaseline(
          kids.map((c, i) => ({
            key: drafts[i].key,
            id: c.id,
            body: followupPayload(drafts[i], i, parentName, fuTemplates.find((x) => x.id === c.template_id) ?? null),
          })),
        );
      }
    }
    setForm(next);
    if (editId) {
      autosave.setBaseline(makePayload(next, templates.find((x) => x.id === next.templateId) ?? null, undefined));
    }
    setStep(startStep);
    setMaxStep(editId ? STEPS.length - 1 : startStep);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, templatesQ.isFetched, sourceQ.data, sourceId, campaignsQ.isFetched]);

  /* ---------- per-step problems ---------- */
  const content = contentProblems(tpl, form.vars, { mediaUrl: form.mediaUrl, ai: form.ai, brief: form.brief, name: form.name });
  const schedProblems = scheduleProblems(form.schedule);
  const sampleFields = samplesUsed(tpl, form.ai ? {} : form.vars);
  const stepProblems: string[][] = [
    tpl ? [] : [form.templateId ? "That message can't be used for a campaign any more (not approved, or not a marketing template). Pick another one." : "Pick a message to continue."],
    content.map((p) => p.message),
    [
      ...audProblems,
      ...(audProblems.length
        ? []
        : previewQ.isError
          ? [errorMessage(previewQ.error)]
          : !previewCurrent
            ? ["Counting who will get it…"]
            : !verified
              ? ["This audience isn't supported by the server yet. Pick another one."]
              : people === 0
                ? ["Nobody in this audience can get it right now. Pick another audience."]
                : []),
    ],
    schedProblems,
    form.followups.flatMap((d, i) =>
      [
        ...followupProblems(d, fuTemplates.find((t) => t.id === d.templateId) ?? null, tpl).map((p) => p.message),
        ...(dupWarnings[d.key] ? [dupWarnings[d.key]] : []),
      ].map((m) => `Follow-up ${i + 1}: ${m}`),
    ),
    [
      ...(risky && !typedCountMatches(typed, people ?? -1) ? [`Type ${fmtInt(people ?? 0)} to confirm this risky audience.`] : []),
      ...(sampleFields.length && !sampleOk ? ["Some blanks still have Meta's example text. Change them in step 2, or tick \"Yes, send this exact text\"."] : []),
    ],
  ];
  const firstBlocked = stepProblems.findIndex((p) => p.length > 0);

  function goTo(i: number) {
    if (i <= step || i <= maxStep) {
      if (i > step && firstBlocked !== -1 && firstBlocked < i) {
        setStep(firstBlocked);
        setShowErrors(true);
        return;
      }
      setStep(i);
      setShowErrors(false);
    }
  }
  function next() {
    if (stepProblems[step].length) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    const n = Math.min(STEPS.length - 1, step + 1);
    setStep(n);
    setMaxStep((m) => Math.max(m, n));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function pickTemplate(t: CampaignTemplate) {
    setForm((f) => (f.templateId === t.id ? f : { ...f, templateId: t.id, vars: initialVars(t), mediaUrl: null }));
    setSampleOk(false);
    setStep(1);
    setMaxStep((m) => Math.max(m, 1));
    setShowErrors(false);
  }

  /* ---------- leave ---------- */
  async function leave(saveFirst: boolean) {
    if (saveFirst) {
      try {
        await autosave.saveNow();
        await fuSync.flush();
      } catch {
        return; // error shows in the footer; stay on the page
      }
    }
    autosave.stop();
    fuSync.stop();
    router.push(campaignId && status !== "draft" ? campaignHref(campaignId) : BACK_HREF);
  }

  /* ---------- launch ---------- */
  async function launch() {
    if (!tpl || !payload || !verified) return;
    setLaunching(true);
    try {
      const autosaved = await autosave.saveNow().catch(() => null);
      let id = autosaved?.id ?? campaignId;
      const full = makePayload(form, tpl, filter)!;
      if (!id) {
        id = (await api.create(full)).campaign.id;
        setCampaignId(id);
      }
      const saved = (await api.patch(id, full)).campaign;
      if (!sameFilter(filter, saved.audience_filter)) {
        throw new Error("The server changed who this goes to, so nothing was sent. Pick another audience or tell the owner.");
      }
      // Follow-ups are saved (as drafts) before the parent goes out, so the
      // launch arms them together.
      await fuSync.flush(id);
      fuSync.stop();
      autosave.stop();
      if (form.schedule.when === "schedule") {
        const at = parseIstInput(form.schedule.at)!;
        const until = form.schedule.repeat && form.schedule.until ? new Date(Date.parse(`${form.schedule.until}T23:59:59+05:30`)).toISOString() : null;
        const sched = { scheduled_at: new Date(at).toISOString(), repeat_rule: form.schedule.repeat || null, repeat_until: until };
        if (saved.status === "paused") {
          await api.patch(id, sched);
          await api.action(id, "resume");
        } else {
          await api.patch(id, { ...sched, status: "scheduled" });
        }
        toast.push({ kind: "success", text: `Scheduled. It starts by itself at the chosen time.` });
      } else {
        if (saved.status === "scheduled") await api.patch(id, { status: "draft", scheduled_at: null, repeat_rule: null, repeat_until: null });
        if (saved.status === "paused") {
          await api.action(id, "resume");
          toast.push({ kind: "success", text: "Started. Progress shows on the campaign page." });
        } else {
          // The first batch can take a while; don't keep the teammate waiting.
          const r = await Promise.race([api.send(id), new Promise<null>((res) => setTimeout(() => res(null), 12_000))]);
          toast.push({ kind: "success", text: r ? describeSendResult(r) : "Started. Progress shows on the campaign page." });
        }
      }
      await invalidate(id);
      router.push(campaignHref(id));
    } catch (e) {
      toast.push({ kind: "error", text: errorMessage(e) });
      setLaunching(false);
      setConfirmLaunch(false);
    }
  }

  /* ---------- render ---------- */
  const title = editId ? `Edit: ${form.name || "campaign"}` : "New WhatsApp campaign";
  const header = (
    <PageHeader
      crumb={<>Marketing · <Link href={BACK_HREF}>WhatsApp</Link></>}
      title={title}
      actions={
        <button type="button" className="pm2-btn sm" onClick={() => (autosave.dirty ? setConfirmLeave(true) : leave(false))}>
          <ArrowLeft size={14} aria-hidden /> Close
        </button>
      }
    />
  );

  if (!ready) {
    const err = templatesQ.error ?? sourceQ.error;
    return (
      <>
        {header}
        <div className="pm2-body">{err ? <Callout tone="crit" title="Couldn't open the campaign" body={errorMessage(err)} /> : <div className="pm2-skel" />}</div>
      </>
    );
  }

  if (editId && sourceQ.data?.followup_of) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="plain"
            title="This is a follow-up"
            body="Follow-ups are changed from the Journey card on the campaign page: the wait, who gets it, and the message."
            action={<Link className="pm2-btn sm pri" href={campaignHref(editId)}>Open the journey</Link>}
          />
        </div>
      </>
    );
  }

  if (editId && !editable) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="sun"
            title="This campaign can't be edited any more"
            body="It has already started. Pause or cancel it from its page, or duplicate it to send something similar."
            action={<Link className="pm2-btn sm pri" href={campaignHref(editId)}>Open campaign</Link>}
          />
        </div>
      </>
    );
  }

  const stepKey = STEPS[step].key;
  const campaignName = (id: string) => (campaignsQ.data ?? []).find((c) => c.id === id)?.name;
  const testDraft = tpl
    ? { template_id: tpl.id, template_vars: buildTemplateVars(form.vars, form.ai, form.brief, tpl), header_media_url: form.mediaUrl, name: form.name.trim() || "test" }
    : null;
  const saving = autosave.state === "saving" || fuSync.state === "saving";
  // Which follow-ups didn't save: refused by the server, or held back here
  // because they copy an earlier message.
  const unsavedNums = form.followups
    .map((d, i) => (fuSync.errors[d.key] || (campaignId && dupWarnings[d.key]) ? i + 1 : 0))
    .filter(Boolean);
  const saveError =
    autosave.state === "error"
      ? `Not saved: ${autosave.error}`
      : fuSync.error
        ? `Not saved: follow-ups: ${fuSync.error}`
        : unsavedNums.length
          ? `${unsavedNums.length === 1 ? "Follow-up" : "Follow-ups"} ${unsavedNums.join(", ")} not saved`
          : null;
  const saveText = saving
    ? "Saving…"
    : saveError
      ? saveError
      : campaignId
        ? autosave.dirty || fuSync.dirty
          ? "Unsaved changes"
          : "Draft saved"
        : "";
  const whenText =
    form.schedule.when === "now"
      ? startMs > Date.now() + 60_000
        ? `Right after you launch, first messages ${fmtIst(startMs)}`
        : "Right after you launch"
      : `${fmtIst(startMs)} India time`;
  const fuName = (id: string | null) => {
    const t = fuTemplates.find((x) => x.id === id);
    return t ? friendlyTemplateName(t.name) : null;
  };
  const followupSentences = form.followups.map((d) => followupRuleSentence({ hours: draftHours(d), stage: d.stage, templateName: fuName(d.templateId) }));

  return (
    <>
      {header}
      <div className="pm2-body">
        <nav aria-label="Campaign steps" className={w.stepsNav}>
          <ol className={w.steps}>
            {STEPS.map((st, i) => {
              const on = i === step;
              const done = !on && (i < step || i <= maxStep);
              return (
                <li key={st.key} className={w.stepItem}>
                  {i > 0 && <i className={`${w.line} ${i <= maxStep || i <= step ? w.lineDone : ""}`} aria-hidden />}
                  <button
                    type="button"
                    className={`${w.step} ${on ? w.on : done ? w.done : ""}`}
                    aria-current={on ? "step" : undefined}
                    aria-label={`Step ${i + 1}: ${st.label}`}
                    disabled={i > maxStep && i > step}
                    onClick={() => goTo(i)}
                  >
                    <span className={w.n} aria-hidden>{done ? <Check strokeWidth={3} /> : i + 1}</span>
                    <span className={w.label}>{st.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className={s.wizard}>
          <div className={s.stack}>
            {stepKey === "template" && <StepTemplate value={form.templateId} onPick={pickTemplate} step={step + 1} total={STEPS.length} />}
            {stepKey === "content" && tpl && (
              <StepContent step={step + 1} total={STEPS.length} tpl={tpl} value={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} problems={content} showErrors={showErrors} />
            )}
            {stepKey === "audience" && (
              <StepAudience
                step={step + 1}
                total={STEPS.length}
                value={form.audience}
                onChange={(p) => setForm((f) => ({ ...f, audience: { ...f.audience, ...p } }))}
                problems={audProblems}
                showErrors={showErrors}
                selfId={campaignId}
              />
            )}
            {stepKey === "schedule" && (
              <StepSchedule
                step={step + 1}
                total={STEPS.length}
                value={form.schedule}
                onChange={(p) => setForm((f) => ({ ...f, schedule: { ...f.schedule, ...p } }))}
                problems={schedProblems}
                showErrors={showErrors}
                pace={{ ...pace, people }}
              />
            )}
            {stepKey === "followups" && (
              <StepFollowups
                step={step + 1}
                total={STEPS.length}
                value={form.followups}
                onChange={(followups) => setForm((f) => ({ ...f, followups }))}
                templates={fuTemplates}
                parentTpl={tpl}
                parentName={form.name.trim() || "Untitled campaign"}
                whenText={whenText}
                problemsFor={(d) => followupProblems(d, fuTemplates.find((t) => t.id === d.templateId) ?? null, tpl)}
                warnings={dupWarnings}
                saveErrors={fuSync.errors}
                showErrors={showErrors}
              />
            )}
            {stepKey === "review" && tpl && (
              <StepReview
                step={step + 1}
                total={STEPS.length}
                sampleFields={sampleFields}
                sampleOk={sampleOk}
                onSampleOk={setSampleOk}
                name={form.name.trim() || "Untitled campaign"}
                tpl={tpl}
                vars={form.vars}
                mediaUrl={form.mediaUrl}
                ai={form.ai}
                audience={form.audience}
                audienceLabel={describeAudience(form.audience, campaignName)}
                schedule={form.schedule}
                startMs={startMs}
                preview={previewCurrent ? previewQ.data : undefined}
                coldShare={coldShare}
                risky={risky}
                typed={typed}
                onTyped={setTyped}
                testDraft={testDraft}
                testDisabled={content.length ? "Finish the message step first." : null}
                pace={pace}
                followupSentences={followupSentences}
              />
            )}

            {showErrors && stepProblems[step].length > 0 && stepKey !== "audience" && stepKey !== "schedule" && stepKey !== "content" && stepKey !== "followups" && (
              <div className={s.err} role="alert">{stepProblems[step].map((p) => <div key={p}>{p}</div>)}</div>
            )}
            {showErrors && stepKey === "audience" && stepProblems[2].length > audProblems.length && (
              <div className={s.err} role="alert">{stepProblems[2].slice(audProblems.length).map((p) => <div key={p}>{p}</div>)}</div>
            )}

            <div className={w.footer}>
              <div className={w.footLeft}>
                {step > 0 && (
                  <button type="button" className="pm2-btn ghost" onClick={() => goTo(step - 1)}>
                    <ArrowLeft size={14} aria-hidden /> Back
                  </button>
                )}
                <span className={w.saveState} role="status">{saveText}</span>
              </div>
              {stepKey !== "review" ? (
                <button type="button" className="pm2-btn dark" onClick={next} disabled={stepKey === "template" && !tpl}>
                  {STEPS[step + 1].next} <ArrowRight size={14} aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  className="pm2-btn pri"
                  disabled={launching}
                  onClick={() => {
                    if (firstBlocked !== -1) {
                      setStep(firstBlocked);
                      setShowErrors(true);
                      return;
                    }
                    setConfirmLaunch(true);
                  }}
                >
                  <Rocket size={14} aria-hidden /> {form.schedule.when === "schedule" ? "Schedule campaign" : "Send campaign"}
                </button>
              )}
            </div>
          </div>

          <aside className={s.side} aria-label="Preview">
            {stepKey !== "review" && stepKey !== "followups" && (
              <>
                <div className={w.frameLabel}>Preview on a phone</div>
                <CampaignPreview tpl={tpl} vars={form.vars} mediaUrl={form.mediaUrl} />
              </>
            )}
            {step >= 2 && (
              <section className="pm2-panel">
                <div className="pm2-p-head"><h3>Who gets it</h3></div>
                <div className="pm2-p-body">
                  <AudiencePreviewPanel
                    q={previewQ}
                    mode={form.audience.mode}
                    coldShare={coldShare}
                    verified={verified || !previewCurrent}
                    startMs={startMs}
                    blocked={audProblems.length ? audProblems[0] : null}
                  />
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>

      {confirmLaunch && (
        <ConfirmDialog
          title={form.schedule.when === "schedule" ? `Schedule for ${fmtInt(people ?? 0)} people?` : `Send to ${fmtInt(people ?? 0)} people now?`}
          body={
            <>
              <b>{form.name.trim() || "Untitled campaign"}</b>{" "}with the message <b>{tpl ? friendlyTemplateName(tpl.name) : ""}</b> goes to {describeAudience(form.audience, campaignName).toLowerCase()}.
              {form.followups.length > 0 && (
                <>
                  {" "}Plus {form.followups.length === 1 ? "1 follow-up" : `${form.followups.length} follow-ups`}, which go out later by themselves to the people they fit.
                </>
              )}
              {" "}Meta charges for each delivered message. You can pause or cancel it any time from its page.
            </>
          }
          confirmLabel={form.schedule.when === "schedule" ? "Yes, schedule it" : "Yes, send it"}
          keepLabel="Not yet"
          busy={launching}
          danger={risky}
          onClose={() => setConfirmLaunch(false)}
          onConfirm={launch}
        />
      )}
      {confirmLeave && (
        <ConfirmDialog
          title="Save your changes before leaving?"
          body="Your latest edits haven't been saved yet. We'll save the draft, then take you back to the campaign list."
          confirmLabel="Save draft and leave"
          keepLabel="Keep editing"
          busy={autosave.state === "saving"}
          onClose={() => setConfirmLeave(false)}
          onConfirm={() => leave(true)}
        />
      )}
    </>
  );
}
