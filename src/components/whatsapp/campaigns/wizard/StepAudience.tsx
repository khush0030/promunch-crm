"use client";

// Step 3: who gets it. Preset cards (Warm is the default), then the details
// for the chosen kind of audience. The live count sits in the side panel.

import { useMemo, useState, type ReactNode } from "react";
import { Card, Chips } from "@/components/pm";
import type { Campaign } from "../../types";
import { useCampaigns, useSegments, useTags } from "../api";
import { RETARGET_STAGES, SEGMENTS, fmtInt, fmtIst, type AudienceMode, type AudienceState } from "../logic";
import { CsvListPanel } from "./CsvListPanel";
import s from "../campaigns.module.css";

const OPTIONS: { mode: AudienceMode; title: string; hint: string; badge?: ReactNode; danger?: boolean }[] = [
  {
    mode: "warm",
    title: "Warm",
    hint: "People who replied to us or read our messages in the last 90 days, or bought in the last 60. Skips anyone who got a promo this week or was held back by Meta recently.",
    badge: <span className={s.badge}>Recommended</span>,
  },
  { mode: "engaged", title: "Engaged only", hint: "Only people who messaged us in the last 90 days. Smallest list, best delivery." },
  { mode: "segment", title: "Customer groups", hint: "Buyers by how much and how recently they ordered (VIP, Loyal, At risk...)." },
  { mode: "tags", title: "By tags", hint: "Include people with certain tags, and leave out others." },
  { mode: "retarget", title: "Follow up a past campaign", hint: "People who didn't read it, read but didn't reply, or were held back by Meta." },
  { mode: "csv", title: "Upload a list", hint: "A CSV of phone numbers who agreed to hear from PROMUNCH." },
  {
    mode: "everyone",
    title: "Everyone opted in",
    hint: "The whole list, including people who never talked to us. Meta blocks most of these. Ask the owner first.",
    danger: true,
    badge: <span className={`${s.badge} ${s.badgeWarn}`}>Risky</span>,
  },
];

export function StepAudience({
  value,
  onChange,
  problems,
  showErrors,
  selfId,
}: {
  value: AudienceState;
  onChange: (patch: Partial<AudienceState>) => void;
  problems: string[];
  showErrors: boolean;
  selfId: string | null;
}) {
  return (
    <div className={s.stack}>
      <div>
        <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Choose who gets it</h2>
        <p className={s.help} style={{ margin: 0 }}>
          Meta gives every WhatsApp user a small allowance of marketing messages across all businesses, and spends it on people who talk to
          the business. A warmer list means more messages arrive and our number stays in good standing.
        </p>
      </div>

      <div className={s.optionGrid} role="radiogroup" aria-label="Audience">
        {OPTIONS.map((o) => {
          const on = value.mode === o.mode;
          return (
            <button
              key={o.mode}
              type="button"
              role="radio"
              aria-checked={on}
              className={`${s.option} ${o.danger ? s.optionDanger : ""} ${on ? s.optionOn : ""}`}
              onClick={() => onChange({ mode: o.mode })}
            >
              <span className={s.optionTitle}>{o.title} {o.badge}</span>
              <span className={s.optionHint}>{o.hint}</span>
            </button>
          );
        })}
      </div>

      {value.mode === "segment" && <SegmentPicker value={value.segments} onChange={(segments) => onChange({ segments })} />}
      {value.mode === "tags" && <TagFilters value={value} onChange={onChange} />}
      {value.mode === "retarget" && <RetargetPicker value={value} onChange={onChange} selfId={selfId} />}
      {value.mode === "csv" && (
        <Card title="Your list">
          <CsvListPanel tag={value.csvTag} count={value.csvCount} consent={value.csvConsent} onChange={onChange} />
        </Card>
      )}
      {value.mode === "everyone" && (
        <div className={s.danger}>
          <b>Most of this list has never messaged us.</b> On past broadcasts Meta held back about 7 in 10 of these messages, and every refusal
          lowers our number&apos;s standing. Only use this with the owner&apos;s okay. You&apos;ll be asked to type the number of people before it sends.
        </div>
      )}

      {showErrors && problems.length > 0 && (
        <div className={s.err} role="alert">{problems.map((p) => <div key={p}>{p}</div>)}</div>
      )}
    </div>
  );
}

function SegmentPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data: segs = [] } = useSegments();
  const byTier = Object.fromEntries(segs.map((x) => [x.rfm_tier, Number(x.customers)]));
  return (
    <Card title="Customer groups" basis="pick one or more">
      <div className={s.optionGrid}>
        {SEGMENTS.map((seg) => {
          const on = value.includes(seg.key);
          const n = seg.tags.reduce((a, t) => a + (byTier[t] ?? 0), 0);
          return (
            <button
              key={seg.key}
              type="button"
              aria-pressed={on}
              className={`${s.option} ${on ? s.optionOn : ""}`}
              onClick={() => onChange(on ? value.filter((k) => k !== seg.key) : [...value, seg.key])}
            >
              <span className={s.optionTitle}>{seg.label} <span className="pm2-num" style={{ marginLeft: "auto" }}>{fmtInt(n)}</span></span>
              <span className={s.optionHint}>{seg.hint}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function tagLabel(t: string): string {
  if (t.startsWith("rfm:")) return `Group: ${t.slice(4).replace(/_/g, " ")}`;
  if (t.startsWith("tier:")) return `Engagement: ${t.slice(5)}`;
  if (t.startsWith("list:")) return `List: ${t.slice(5)}`;
  return t;
}

function TagFilters({ value, onChange }: { value: AudienceState; onChange: (p: Partial<AudienceState>) => void }) {
  const { data: tags = [], isLoading } = useTags();
  const [which, setWhich] = useState<"tagsAny" | "tagsAll" | "excludeTags">("tagsAny");
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tags.filter((t) => !needle || t.tag.toLowerCase().includes(needle)).slice(0, 80);
  }, [tags, search]);
  const current = value[which];
  const toggle = (t: string) => onChange({ [which]: current.includes(t) ? current.filter((x) => x !== t) : [...current, t] } as Partial<AudienceState>);

  const summary = (label: string, list: string[]) =>
    list.length ? <div className={s.help}><b>{label}:</b> {list.map(tagLabel).join(", ")}</div> : null;

  return (
    <Card title="Tags">
      <div className={s.stack}>
        <Chips
          ariaLabel="Which tag rule to edit"
          value={which}
          onChange={(k) => setWhich(k as typeof which)}
          items={[
            { key: "tagsAny", label: "Has any of", count: value.tagsAny.length },
            { key: "tagsAll", label: "Has all of", count: value.tagsAll.length },
            { key: "excludeTags", label: "Leave out", count: value.excludeTags.length },
          ]}
        />
        <input className={s.input} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tags" aria-label="Search tags" />
        <div className={s.tagPicker}>
          {isLoading && <span className={s.help}>Loading tags…</span>}
          {shown.map((t) => (
            <button
              key={t.tag}
              type="button"
              aria-pressed={current.includes(t.tag)}
              className={`pm2-chip ${current.includes(t.tag) ? s.tagOn : ""}`}
              onClick={() => toggle(t.tag)}
            >
              {tagLabel(t.tag)} <em>{fmtInt(t.count)}</em>
            </button>
          ))}
        </div>
        {summary("Has any of", value.tagsAny)}
        {summary("Has all of", value.tagsAll)}
        {summary("Leave out", value.excludeTags)}
      </div>
    </Card>
  );
}

function RetargetPicker({
  value,
  onChange,
  selfId,
}: {
  value: AudienceState;
  onChange: (p: Partial<AudienceState>) => void;
  selfId: string | null;
}) {
  const { data: campaigns = [] } = useCampaigns();
  const past = campaigns.filter((c: Campaign) => c.id !== selfId && (c.sent_count > 0 || c.failed_count > 0));
  return (
    <Card title="Follow up a past campaign">
      <div className={s.stack}>
        <label className={s.field}>
          <span className={s.label}>Campaign</span>
          <select className={s.select} value={value.retargetCampaignId} onChange={(e) => onChange({ retargetCampaignId: e.target.value })}>
            <option value="">Pick a campaign</option>
            {past.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({fmtInt(c.sent_count)} reached, {fmtIst(c.started_at ?? c.created_at)})
              </option>
            ))}
          </select>
          {past.length === 0 && <span className={s.help}>No past campaigns have reached anyone yet.</span>}
        </label>
        <div className={s.optionGrid} role="radiogroup" aria-label="Who to follow up">
          {RETARGET_STAGES.map((st) => {
            const on = value.retargetStage === st.key;
            return (
              <button
                key={st.key}
                type="button"
                role="radio"
                aria-checked={on}
                className={`${s.option} ${on ? s.optionOn : ""}`}
                onClick={() => onChange({ retargetStage: st.key })}
              >
                <span className={s.optionTitle}>{st.label}</span>
                <span className={s.optionHint}>{st.hint}</span>
              </button>
            );
          })}
        </div>
        {value.retargetStage === "failed_cap" && (
          <p className={s.help} style={{ margin: 0 }}>Tip: wait a few days before following up people Meta held back, or they&apos;ll likely be held back again.</p>
        )}
      </div>
    </Card>
  );
}
