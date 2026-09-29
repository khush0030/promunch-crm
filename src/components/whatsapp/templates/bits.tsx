"use client";

// Small presentational pieces shared by the template list and the creator.

import { useState } from "react";
import { AlertTriangle, FileText, Image as ImageIcon, Play, Video, X } from "lucide-react";
import { HelpTip } from "@/components/guide";
import { renderBlanks } from "@/lib/whatsapp/templateKind";
import { statusInfo, videoPosterSrc } from "@/lib/whatsapp/template-display";
import type { TemplateProblem } from "@/lib/whatsapp/template-errors";
import type { Issue } from "@/lib/whatsapp/template-rules";
import { renderWhatsApp } from "../WhatsAppPreview";
import s from "./templates.module.css";

export function StatusPill({ status, withHelp = true }: { status: string; withHelp?: boolean }) {
  const info = statusInfo(status);
  return (
    <span className={s.pillWrap}>
      <span className={`pm2-pill ${info.tone}`}>{info.label}</span>
      {withHelp && <HelpTip term="approval" text={info.explain || undefined} label={`What does ${info.label} mean?`} />}
    </span>
  );
}

export function IssueList({ issues, tone }: { issues: Issue[]; tone: "error" | "warning" }) {
  if (!issues.length) return null;
  return (
    <ul className={s.issues}>
      {issues.map((i, k) => (
        <li key={k} className={`${s.issue} ${tone === "error" ? s.issueErr : s.issueWarn}`}>
          <AlertTriangle aria-hidden="true" />
          <span>
            {i.message}
            {i.fix ? <span className={s.issueFix}> {i.fix}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ProblemBox({ problem, onClose }: { problem: TemplateProblem; onClose?: () => void }) {
  return (
    <div role="alert" className={`${s.box} ${s.boxBad}`}>
      <div className={s.boxTitle}>
        <span>{problem.title}</span>
        {onClose && (
          <button type="button" className={`pm2-btn sm ghost ${s.iconOnly}`} onClick={onClose} aria-label="Dismiss">
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      <div>{problem.explanation}</div>
      <div><strong>What to do:</strong> {problem.howToFix}</div>
      {problem.raw && (
        <details className={s.details}>
          <summary>Details from Meta</summary>
          <div>{problem.raw}</div>
        </details>
      )}
    </div>
  );
}

/**
 * Message text with *bold* etc. rendered like WhatsApp and every {{n}} shown
 * as a labelled chip. With `samples`, a chip shows the example value instead.
 */
export function BlankText({
  text,
  labels,
  samples,
}: {
  text: string;
  labels?: Record<string, string>;
  samples?: Record<string, string>;
}) {
  const segs = renderBlanks(text, labels);
  return (
    <>
      {segs.map((seg, i) =>
        seg.kind === "text" ? (
          <span key={i}>{renderWhatsApp(seg.text, `t${i}-`)}</span>
        ) : (
          <span key={i} className={s.blank} title={`${seg.label} (${seg.raw})`}>
            {samples?.[seg.key]?.trim() || seg.label}
          </span>
        ),
      )}
    </>
  );
}

/**
 * Header picture / video thumbnail for a template card. Videos seek to their
 * first frame (#t=0.1) with playsInline so phones paint a real still instead
 * of a black or empty box; a broken or expired file falls back to an icon.
 */
export function HeaderThumb({ kind, url }: { kind: "image" | "video" | "document"; url: string | null | undefined }) {
  const [broken, setBroken] = useState(false);
  if (kind === "document") {
    return (
      <div className={s.docHead}>
        <FileText aria-hidden="true" /> PDF at the top of the message
      </div>
    );
  }
  if (!url || broken) {
    return (
      <div className={s.thumb}>
        <div className={s.thumbEmpty}>
          {kind === "video" ? <Video aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
          {url ? "Preview not available" : `No ${kind === "video" ? "video" : "picture"} added yet`}
        </div>
      </div>
    );
  }
  return (
    <div className={s.thumb}>
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <>
          <video src={videoPosterSrc(url)} muted playsInline preload="metadata" onError={() => setBroken(true)} aria-label="Header video" />
          <span className={s.play} aria-hidden="true"><Play /></span>
        </>
      )}
    </div>
  );
}
