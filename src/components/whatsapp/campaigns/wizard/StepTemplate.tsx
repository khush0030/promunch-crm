"use client";

// Step 1: pick an approved MARKETING template from a visual gallery. Internal
// (ops, order confirmations) and customer-service templates never show here.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Callout, Pill } from "@/components/pm";
import { GlossaryTerm, NextStepCallout, StepHeader } from "@/components/guide";
import { friendlyTemplateName, isAutomationTemplate, renderBlanks } from "@/lib/whatsapp/templateKind";
import { errorMessage, useApprovedTemplates } from "../api";
import { TemplateThumb } from "../bits";
import { QUALITY_META, campaignTemplates, templateFields, type CampaignTemplate } from "../logic";
import s from "../campaigns.module.css";

export const NEW_TEMPLATE_HREF = "/dashboard/whatsapp?tab=templates&new=1";

// Chip labels for a template's blanks: the name the marketer gave it in the
// creator, else "First name" for name blanks, else "Blank 2".
function blankLabels(t: CampaignTemplate): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of templateFields(t)) {
    if (f.kind === "body") out[f.key] = f.blankLabel ?? (f.isName ? "First name" : `Blank ${f.key}`);
  }
  return out;
}

export function BlankText({ text, labels }: { text: string; labels?: Record<string, string> }) {
  return (
    <>
      {renderBlanks(text, labels).map((seg, i) =>
        seg.kind === "text" ? <span key={i}>{seg.text}</span> : <span key={i} className={s.blankChip}>{seg.label}</span>,
      )}
    </>
  );
}

export function StepTemplate({
  value,
  onPick,
  step,
  total,
}: {
  value: string | null;
  onPick: (t: CampaignTemplate) => void;
  step: number;
  total: number;
}) {
  const q = useApprovedTemplates();
  const [search, setSearch] = useState("");
  const all = useMemo(() => campaignTemplates(q.data ?? []), [q.data]);
  // Automation-only messages ("you left goodies in your cart") never go out as broadcasts.
  const usable = useMemo(() => all.filter((t) => !isAutomationTemplate(t.name)), [all]);
  const automationOnly = useMemo(() => all.filter((t) => isAutomationTemplate(t.name)), [all]);
  const list = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...usable]
      .sort((a, b) => friendlyTemplateName(a.name).localeCompare(friendlyTemplateName(b.name)))
      .filter(
        (t) =>
          !needle ||
          t.name.toLowerCase().includes(needle) ||
          friendlyTemplateName(t.name).toLowerCase().includes(needle) ||
          (t.body ?? "").toLowerCase().includes(needle),
      );
  }, [usable, search]);

  return (
    <div className={s.stack}>
      <StepHeader
        step={step}
        total={total}
        title="Pick the message to send"
        why={
          <>
            WhatsApp only lets a business start a chat with a <GlossaryTerm k="template">template</GlossaryTerm> that Meta has approved.
            Only <GlossaryTerm k="marketing">marketing</GlossaryTerm> templates are shown here, because campaigns are marketing.
          </>
        }
        glossary={["template", "approval", "marketing"]}
      />

      <div className={s.toolbar}>
        <div className={s.searchBox}>
          <Search aria-hidden />
          <input className={s.input} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search messages" aria-label="Search templates" />
        </div>
        <Link href={NEW_TEMPLATE_HREF} className="pm2-btn sm">
          <Plus size={14} aria-hidden /> Create a new template
        </Link>
      </div>

      {q.isError && <Callout tone="crit" title="Couldn't load templates" body={errorMessage(q.error)} />}
      {q.isLoading && <div className="pm2-skel" />}
      {!q.isLoading && !q.isError && usable.length === 0 && (
        <NextStepCallout
          tone="info"
          title="You need an approved marketing template first"
          body="Write your message once as a template and send it to Meta. Approval usually takes a few minutes to a few hours. Then come back here and it will show up."
          primary={{ label: "Create a template", href: NEW_TEMPLATE_HREF }}
        />
      )}
      {!q.isLoading && usable.length > 0 && list.length === 0 && (
        <div className="pm2-empty">No template matches &quot;{search}&quot;. Clear the search to see all of them.</div>
      )}

      <div className={s.gallery} role="radiogroup" aria-label="Approved marketing templates">
        {list.map((t) => {
          const on = t.id === value;
          const quality = QUALITY_META[String(t.quality_score ?? "").toUpperCase()];
          const missingMedia = !!t.needs_media || (["IMAGE", "VIDEO", "DOCUMENT"].includes(String(t.header_type ?? "").toUpperCase()) && !t.header_media_url);
          const labels = blankLabels(t);
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`${s.tplCard} ${on ? s.tplCardOn : ""}`}
              onClick={() => onPick(t)}
            >
              {t.header_type && String(t.header_type).toUpperCase() !== "TEXT" && <TemplateThumb tpl={t} className={s.tplMedia} />}
              <div className={s.tplBubble}>
                <div>
                  {t.header_type === "TEXT" && t.header_text && (
                    <b style={{ display: "block" }}>
                      <BlankText text={t.header_text} labels={{ "1": "Title blank" }} />
                    </b>
                  )}
                  <BlankText text={t.body ?? ""} labels={labels} />
                </div>
              </div>
              <div className={s.tplName}>{friendlyTemplateName(t.name)}</div>
              <div className={s.inline}>
                {quality && <Pill tone={quality.tone}>{quality.label}</Pill>}
                {missingMedia && <Pill tone="warn">Needs a picture</Pill>}
                {on && <Pill tone="neu">Selected</Pill>}
              </div>
            </button>
          );
        })}
      </div>

      {automationOnly.length > 0 && (
        <details className="pm2-card" style={{ padding: "10px 14px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            Why don&apos;t I see {automationOnly.length} other approved message{automationOnly.length === 1 ? "" : "s"}?
          </summary>
          <p style={{ margin: "8px 0 6px", color: "var(--pm-muted)", lineHeight: 1.5 }}>
            These are written for an <GlossaryTerm k="automation">automation</GlossaryTerm>, like a reminder to someone who left
            items in their cart. Sent to a whole group they would not make sense, so they can&apos;t be used in a campaign. To send
            something similar to many people, create a new template.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--pm-muted)" }}>
            {automationOnly.map((t) => (
              <li key={t.id}>{friendlyTemplateName(t.name)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
