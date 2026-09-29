"use client";

// Live WhatsApp bubble for the creator. Same look as WhatsAppPreview, but
// blanks render as labelled chips (or their example values) and colours live
// in the CSS module.

import { useState } from "react";
import { CornerUpLeft, ExternalLink, FileText, Phone, Smartphone } from "lucide-react";
import { HelpTip } from "@/components/guide";
import { finalFooter, isMarketingCategory } from "@/lib/whatsapp/template-rules";
import { videoPosterSrc } from "@/lib/whatsapp/template-display";
import type { EditorDraft } from "@/lib/whatsapp/template-draft";
import { tagUrlForWhatsApp } from "@/lib/utm";
import { BlankText } from "../bits";
import s from "../templates.module.css";

export function PhonePreview({ d, notes = true, id }: { d: EditorDraft; notes?: boolean; id?: string }) {
  const [examples, setExamples] = useState(false);
  const footer = finalFooter(d.category, d.footer);
  const btns = d.buttons.filter((b) => b.text);
  const headerLabels: Record<string, string> = { "1": "Header blank" };
  const hasBlanks = /\{\{\d+\}\}/.test(d.body + d.header_text);
  const links = d.buttons.filter((b): b is Extract<EditorDraft["buttons"][number], { type: "URL" }> => b.type === "URL" && !!b.url);

  return (
    <div className={s.stackTight} id={id}>
      <div className={s.previewHead}>
        <span className={s.previewTitle}>
          <Smartphone aria-hidden="true" width={14} height={14} /> What the customer sees
        </span>
        {hasBlanks && (
          <div className="pm2-seg" role="group" aria-label="Show blanks as">
            <button type="button" className={examples ? "" : "on"} aria-pressed={!examples} onClick={() => setExamples(false)}>Blanks</button>
            <button type="button" className={examples ? "on" : ""} aria-pressed={examples} onClick={() => setExamples(true)}>Examples</button>
          </div>
        )}
      </div>
      <div className={s.phone}>
        <div className={s.bubble}>
          {d.header_type === "IMAGE" && (d.header_media_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={d.header_media_url} alt="Header picture" />
            : <div className={s.bubbleMedia}>Your picture goes here</div>)}
          {d.header_type === "VIDEO" && (d.header_media_url
            ? <video src={videoPosterSrc(d.header_media_url)} controls playsInline preload="metadata" />
            : <div className={s.bubbleMedia}>Your video goes here</div>)}
          {d.header_type === "DOCUMENT" && (
            <div className={s.bubbleDoc}><FileText aria-hidden="true" /> {d.header_media_url ? "PDF attached" : "Your PDF goes here"}</div>
          )}
          {d.header_type === "TEXT" && d.header_text && (
            <div className={s.bubbleHead}>
              <BlankText text={d.header_text} labels={headerLabels} samples={examples ? d.headerSamples : undefined} />
            </div>
          )}
          <div className={s.bubbleBody}>
            {d.body
              ? <BlankText text={d.body} labels={d.blankLabels} samples={examples ? d.bodySamples : undefined} />
              : <span className={s.bubblePlaceholder}>Your message appears here as you type.</span>}
          </div>
          {footer && <div className={s.bubbleFoot}>{footer}</div>}
          <div className={s.bubbleTime}>10:30 AM</div>
          {btns.length > 0 && (
            <div className={s.bubbleBtns}>
              {btns.map((b, i) => (
                <div key={i} className={s.bubbleBtn}>
                  {b.type === "URL" && <ExternalLink aria-hidden="true" />}
                  {b.type === "PHONE_NUMBER" && <Phone aria-hidden="true" />}
                  {b.type === "QUICK_REPLY" && <CornerUpLeft aria-hidden="true" />}
                  {b.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {notes && (
        <div className={s.previewNotes}>
          {isMarketingCategory(d.category) && (
            <div>
              &quot;Reply STOP to unsubscribe&quot; is added for you, so customers can always opt out.
              <HelpTip term="stop_footer" />
            </div>
          )}
          {links.map((b, i) => {
            const dynamic = b.url.includes("{{");
            const shown = dynamic ? (b.example || b.url) : tagUrlForWhatsApp(b.url, { medium: "template_button", campaign: d.name });
            return (
              <div key={i}>
                &quot;{b.text || "Link"}&quot; opens {shown}
                {dynamic
                  ? " (an example; the end changes for each customer)."
                  : ". Tracking is added so orders from this button show under WhatsApp revenue."}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
