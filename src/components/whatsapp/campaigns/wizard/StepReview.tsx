"use client";

// Step 5: everything on one card, a test send, and (for risky audiences) a
// typed confirmation. The launch button lives in the wizard footer.

import type { ReactNode } from "react";
import { Card } from "@/components/pm";
import { GlossaryTerm, PlainSummary, StepHeader } from "@/components/guide";
import { friendlyTemplateName } from "@/lib/whatsapp/templateKind";
import type { AudiencePreview } from "../api";
import { CampaignPreview } from "../bits";
import {
  RETARGET_STAGES,
  SEGMENTS,
  estimateOutcome,
  fmtInr,
  fmtInt,
  fmtIst,
  fmtIstDate,
  mediaKindOf,
  type AudienceState,
  type VarField,
  type CampaignTemplate,
  type ScheduleState,
} from "../logic";
import { TestSendPanel } from "./TestSendPanel";
import s from "../campaigns.module.css";
import { useNow } from "../useNow";

export function describeAudience(a: AudienceState, campaignName?: (id: string) => string | undefined): string {
  switch (a.mode) {
    case "warm":
      return "Warm: replied, read or bought recently";
    case "engaged":
      return "Engaged only: messaged us in the last 90 days";
    case "segment":
      return `Customer groups: ${SEGMENTS.filter((x) => a.segments.includes(x.key)).map((x) => x.label).join(", ") || "none picked"}`;
    case "tags": {
      const parts = [
        a.tagsAny.length ? `has any of ${a.tagsAny.join(", ")}` : "",
        a.tagsAll.length ? `has all of ${a.tagsAll.join(", ")}` : "",
        a.excludeTags.length ? `leaving out ${a.excludeTags.join(", ")}` : "",
      ].filter(Boolean);
      return `Tags: ${parts.join("; ")}`;
    }
    case "retarget": {
      const st = RETARGET_STAGES.find((x) => x.key === a.retargetStage)?.label ?? a.retargetStage;
      return `Follow-up of "${campaignName?.(a.retargetCampaignId) ?? "a past campaign"}": ${st.toLowerCase()}`;
    }
    case "csv":
      return `Uploaded list ${a.csvTag?.replace(/^list:/, "") ?? ""}`;
    case "everyone":
      return "Everyone opted in";
  }
}

export function StepReview({
  name,
  tpl,
  vars,
  mediaUrl,
  ai,
  audience,
  audienceLabel,
  schedule,
  startMs,
  preview,
  coldShare,
  risky,
  typed,
  onTyped,
  testDraft,
  testDisabled,
  pace,
  step,
  total,
  sampleFields,
  sampleOk,
  onSampleOk,
  followupSentences = [],
}: {
  /** One plain sentence per follow-up. */
  followupSentences?: string[];
  step: number;
  total: number;
  /** Blanks whose value is exactly Meta's sample text. */
  sampleFields: VarField[];
  sampleOk: boolean;
  onSampleOk: (v: boolean) => void;
  name: string;
  tpl: CampaignTemplate;
  vars: Record<string, string>;
  mediaUrl: string | null;
  ai: boolean;
  audience: AudienceState;
  audienceLabel: string;
  schedule: ScheduleState;
  startMs: number;
  preview: AudiencePreview | undefined;
  coldShare: number | null;
  risky: boolean;
  typed: string;
  onTyped: (v: string) => void;
  testDraft: Parameters<typeof TestSendPanel>[0]["draft"];
  testDisabled: string | null;
  pace: { perDay: number | null; finishMs: number | null };
}) {
  const people = preview?.counts.eligible_total ?? 0;
  const now = useNow();
  const est = estimateOutcome(people, audience.mode, coldShare);
  const rows: [string, ReactNode][] = [
    ["Name", name],
    ["Message", friendlyTemplateName(tpl.name)],
    ["Picture", mediaUrl ? "A new file just for this campaign" : tpl.header_media_url ? "The template's own file" : "None"],
    ["AI personalisation", ai ? "On" : "Off"],
    ["Audience", audienceLabel],
    ["Will get it", `${fmtInt(people)} people`],
    [
      "Expected",
      <>
        about {fmtInt(est.delivered)} arrive, about {fmtInt(est.heldBack)} <GlossaryTerm k="held_back">held back by Meta</GlossaryTerm>
      </>,
    ],
    ["Estimated cost", `about ${fmtInr(est.costInr)} (only delivered messages are charged, incl. GST)`],
    [
      "When",
      schedule.when === "now"
        ? `Now${startMs > now + 60_000 ? `, first messages at ${fmtIst(startMs)} (after quiet hours)` : ""}`
        : `${fmtIst(startMs)} India time${schedule.repeat ? `, repeats ${schedule.repeat}${schedule.until ? ` until ${schedule.until}` : ""}` : ""}`,
    ],
    [
      "Follow-ups",
      followupSentences.length ? (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {followupSentences.map((x) => <li key={x}>{x}</li>)}
        </ul>
      ) : (
        "None"
      ),
    ],
    ["Pace", `${pace.perDay != null ? `about ${fmtInt(pace.perDay)} a day` : "depends on today's budget"}${pace.finishMs ? `, done about ${fmtIstDate(pace.finishMs)}` : ""}`],
  ];

  const kind = mediaKindOf(tpl);
  const mediaWord = kind === "image" ? "picture" : kind === "video" ? "video" : kind === "document" ? "PDF" : null;
  const withMedia = mediaUrl && mediaWord ? ` with your new ${mediaWord}` : "";
  const startText =
    schedule.when === "now"
      ? startMs > now + 60_000
        ? `starting ${fmtIst(startMs)} (after quiet hours)`
        : "starting now"
      : `starting ${fmtIst(startMs)} India time`;
  const finishText = pace.finishMs ? `, finishing around ${fmtIstDate(pace.finishMs)}` : "";
  const sentences: ReactNode[] = [
    `This will send the "${friendlyTemplateName(tpl.name)}" message${withMedia} to about ${fmtInt(people)} people, ${startText}${finishText}. It will cost about ${fmtInr(est.costInr)}.`,
    ...followupSentences.map((x) => `Follow-up: ${x}`),
    `About ${fmtInt(est.heldBack)} will probably be held back by Meta. That is normal, costs nothing, and we try them again later.`,
    "Nothing is sent until you press the button below and confirm. You can pause or cancel it any time after.",
  ];

  return (
    <div className={s.stack}>
      <StepHeader
        step={step}
        total={total}
        title="Check and send"
        why="Read the summary once, send yourself a test, then launch."
        glossary={["test_send", "held_back", "delivered", "daily_budget"]}
      />

      <PlainSummary title="What will happen" sentences={sentences} />

      {sampleFields.length > 0 && (
        <div className={s.danger} role="alert">
          <b>Some blanks still have Meta&apos;s example text.</b> {sampleFields.map((f) => `"${f.label}" says "${f.sample}"`).join("; ")}. Customers
          would see exactly that. Go back to step 2 and type your own words, or tick the box if you really mean it.
          <label className={s.check} style={{ marginTop: 8 }}>
            <input type="checkbox" checked={sampleOk} onChange={(e) => onSampleOk(e.target.checked)} />
            <span>Yes, send this exact text</span>
          </label>
        </div>
      )}

      <div className="pm2-g21">
        <Card title="Summary">
          <dl className={s.summary}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <CampaignPreview tpl={tpl} vars={vars} mediaUrl={mediaUrl} />
      </div>

      <TestSendPanel draft={testDraft} disabledReason={testDisabled} />

      {risky && (
        <div className={s.danger}>
          <b>This is a risky audience.</b> Most of these people never messaged PROMUNCH, so Meta will hold back most messages and our number&apos;s
          standing can drop. If the owner has okayed it, type the number of people (<b>{fmtInt(people)}</b>) to confirm.
          <label className={s.field} style={{ marginTop: 8, maxWidth: 220 }}>
            <span className="pm2-sr">Type the number of people</span>
            <input className={s.input} inputMode="numeric" value={typed} onChange={(e) => onTyped(e.target.value)} placeholder={String(people)} />
          </label>
        </div>
      )}
    </div>
  );
}
