"use client";

// One template card. Marketing ("For campaigns") cards carry the actions;
// automatic-message and team-alert cards are read-only.

import Link from "next/link";
import { Copy, Lock, Pencil, Send, Trash2, Wrench } from "lucide-react";
import { HelpTip } from "@/components/guide";
import { friendlyTemplateName, type TemplateKind } from "@/lib/whatsapp/templateKind";
import { CATEGORY_LABEL, qualityInfo } from "@/lib/whatsapp/template-display";
import { guessBlankLabels } from "@/lib/whatsapp/template-draft";
import { explainRejection } from "@/lib/whatsapp/template-errors";
import { languageLabel, mediaKindForHeader } from "@/lib/whatsapp/template-rules";
import { MediaUploader } from "../MediaUploader";
import type { TemplateRow } from "./api";
import { BlankText, HeaderThumb, ProblemBox, StatusPill } from "./bits";
import s from "./templates.module.css";

function labelsOf(t: TemplateRow): Record<string, string> {
  const known: Record<string, string> = {};
  if (Array.isArray(t.variables)) {
    for (const v of t.variables as { name?: unknown; label?: unknown }[]) {
      if (v?.name && typeof v.label === "string") known[String(v.name)] = v.label;
    }
  }
  return guessBlankLabels(t.body ?? "", known);
}

export function TemplateCard({
  t,
  kind,
  onEdit,
  onDuplicate,
  onDelete,
  onAttachMedia,
}: {
  t: TemplateRow;
  kind: TemplateKind;
  onEdit: (t: TemplateRow) => void;
  onDuplicate: (t: TemplateRow) => void;
  onDelete: (t: TemplateRow) => void;
  onAttachMedia: (t: TemplateRow, url: string | null) => void;
}) {
  const friendly = friendlyTemplateName(t.name);
  const q = qualityInfo(t.quality_score);
  const media = mediaKindForHeader(t.header_type);
  const editable = kind === "marketing";
  const atMeta = !!t.meta_template_id;
  const rejected = t.status === "rejected" ? explainRejection(t.rejection_reason, t.rejected_reason_detail) : null;
  const paused = t.status === "disabled" || t.status === "paused";
  const missingFile = !!media && (!!t.needs_media || !t.header_media_url);
  const showAttach = kind !== "internal" && missingFile && t.status !== "draft";

  return (
    <article className={`${s.card} ${editable ? "" : s.cardReadonly}`} aria-label={friendly}>
      <div className={s.cardHead}>
        <div className={s.grow}>
          <div className={s.cardTitle}>{friendly}</div>
          <div className={s.mono}>{t.name}</div>
        </div>
        <StatusPill status={t.status} />
      </div>

      <div className={s.cardMeta}>
        <span>{CATEGORY_LABEL[t.category] ?? t.category}</span>
        <span>{languageLabel(t.language)}</span>
        {q && (
          <span className={s.pillWrap}>
            <span className={`pm2-pill ${q.tone}`}>{q.label}</span>
            <HelpTip term="quality_rating" label="What is the quality rating?" />
          </span>
        )}
      </div>

      {t.previous_category && t.previous_category !== t.category && (
        <div className={s.catNote}>
          Meta changed this from {CATEGORY_LABEL[t.previous_category] ?? t.previous_category} to {CATEGORY_LABEL[t.category] ?? t.category}.
        </div>
      )}

      {media && <HeaderThumb kind={media} url={t.header_media_url} />}
      {t.header_type === "TEXT" && t.header_text && <div className={s.headerText}>{t.header_text}</div>}
      <div className={s.bodyText}>
        <BlankText text={t.body ?? ""} labels={labelsOf(t)} />
      </div>
      {t.footer && <div className={s.footLine}>{t.footer}</div>}

      {showAttach && media && (
        <div className={`${s.box} ${s.boxWarn}`}>
          <div>
            We don&apos;t have this template&apos;s {media === "document" ? "PDF" : media === "image" ? "picture" : "video"} yet, so it can&apos;t be sent.
            Upload the same file Meta approved. This does not send it to Meta again.
          </div>
          <MediaUploader kind={media} value={null} onChange={(url) => onAttachMedia(t, url)} />
        </div>
      )}

      {rejected && editable && <ProblemBox problem={rejected} />}
      {paused && editable && (
        <div className={`${s.box} ${s.boxBad}`}>
          Meta paused this template, usually because customers blocked or reported it. Soften the wording and send it again.
        </div>
      )}
      {t.status === "pending" && (
        <div className={s.hint}>Meta is reviewing it. Usually a few minutes, up to 24 hours. This page updates by itself.</div>
      )}

      {editable ? (
        <div className={s.actions}>
          {(rejected || paused) && (
            <button type="button" className={`pm2-btn pri ${s.bigBtn}`} onClick={() => onEdit(t)}>
              <Wrench aria-hidden="true" /> Fix and resubmit
            </button>
          )}
          {t.status === "approved" && (
            <Link href={`/dashboard/whatsapp/campaigns/new?template=${t.id}`} className="pm2-btn sm pri">
              <Send aria-hidden="true" /> Use in campaign
            </Link>
          )}
          {t.status === "draft" && !atMeta && (
            <button type="button" className="pm2-btn sm pri" onClick={() => onEdit(t)}>
              <Pencil aria-hidden="true" /> Continue editing
            </button>
          )}
          {!(rejected || paused) && atMeta && (
            <button type="button" className="pm2-btn sm" onClick={() => onEdit(t)}>
              <Pencil aria-hidden="true" /> Edit &amp; resubmit
            </button>
          )}
          <button type="button" className="pm2-btn sm" onClick={() => onDuplicate(t)} title="Copy into a new template with a _v2 style name">
            <Copy aria-hidden="true" /> Duplicate as new version
          </button>
          <button type="button" className={`pm2-btn sm ${s.iconOnly} ${s.danger}`} onClick={() => onDelete(t)} aria-label={`Delete ${friendly}`}>
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className={s.readonly}>
          <Lock aria-hidden="true" />
          <span>
            {kind === "internal"
              ? "Used by the system to alert the team. View only."
              : "Sent automatically by Automations, for example order updates. View only, not for campaigns."}
          </span>
        </div>
      )}
    </article>
  );
}
