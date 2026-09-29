"use client";

// Small shared pieces: template thumbnail, phone preview, status pill,
// technical-details disclosure.

import type { ReactNode } from "react";
import { FileText, ImageIcon, MessageSquareText, Video } from "lucide-react";
import { Pill } from "@/components/pm";
import { WhatsAppPreview } from "../WhatsAppPreview";
import type { TemplateButton } from "../types";
import { fillText, SAMPLE_NAME, statusMeta } from "./logic";
import s from "./campaigns.module.css";

type TplLike = {
  header_type?: string | null;
  header_text?: string | null;
  header_media_url?: string | null;
  body?: string | null;
  footer?: string | null;
  buttons?: TemplateButton[] | null;
} | null | undefined;

export function TemplateThumb({ tpl, mediaUrl, className }: { tpl: TplLike; mediaUrl?: string | null; className?: string }) {
  const ht = String(tpl?.header_type ?? "").toUpperCase();
  const url = mediaUrl || tpl?.header_media_url || null;
  let inner: ReactNode = <MessageSquareText aria-hidden />;
  if (ht === "IMAGE") {
    // eslint-disable-next-line @next/next/no-img-element
    inner = url ? <img src={url} alt="" loading="lazy" /> : <ImageIcon aria-hidden />;
  } else if (ht === "VIDEO") {
    inner = url ? <video src={url} muted preload="metadata" aria-hidden /> : <Video aria-hidden />;
  } else if (ht === "DOCUMENT") {
    inner = <FileText aria-hidden />;
  }
  return <div className={className ?? s.thumb}>{inner}</div>;
}

// What one customer (named SAMPLE_NAME) sees, in a phone-ish frame.
export function CampaignPreview({
  tpl,
  vars,
  mediaUrl,
  name = SAMPLE_NAME,
  caption,
}: {
  tpl: TplLike;
  vars: Record<string, string>;
  mediaUrl?: string | null;
  name?: string;
  caption?: ReactNode;
}) {
  return (
    <div className={s.phone} aria-label="WhatsApp message preview">
      <div className={s.phoneTop}>
        <i aria-hidden />
        <span>
          <b style={{ color: "var(--pm-ink)" }}>PROMUNCH</b>
          <br />
          {caption ?? `How ${name} sees it`}
        </span>
      </div>
      {tpl ? (
        <WhatsAppPreview
          headerType={tpl.header_type}
          headerMediaUrl={mediaUrl || tpl.header_media_url}
          headerText={fillText(tpl.header_text, vars, name, true)}
          body={fillText(tpl.body, vars, name)}
          footer={tpl.footer}
          buttons={tpl.buttons}
        />
      ) : (
        <div className="pm2-empty">Pick a template to see the message here.</div>
      )}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <Pill tone={m.tone} tip={m.hint}>
      {m.label}
    </Pill>
  );
}

export function TechDetails({ children, label = "Technical details" }: { children: ReactNode; label?: string }) {
  return (
    <details className={s.details}>
      <summary>{label}</summary>
      <div className={s.raw}>{children}</div>
    </details>
  );
}
