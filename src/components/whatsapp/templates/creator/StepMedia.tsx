"use client";

// Step 3: header (none / text / picture / video / PDF) and buttons.

import { ArrowUp, CornerUpLeft, ExternalLink, FileText, Image as ImageIcon, Phone, Type, Video, X, Ban, type LucideIcon } from "lucide-react";
import { GlossaryTerm, HelpTip, StepHeader } from "@/components/guide";
import {
  FOOTER_MAX, HEADER_TEXT_MAX, MAX_BUTTONS, finalFooter, isMarketingCategory, mediaKindForHeader, varNumbers,
} from "@/lib/whatsapp/template-rules";
import type { DraftButton, HeaderKind } from "@/lib/whatsapp/template-draft";
import { MediaUploader } from "../../MediaUploader";
import { IssueList } from "../bits";
import type { StepProps } from "./fieldTypes";
import s from "../templates.module.css";

const HEADERS: { key: HeaderKind; title: string; text: string; Icon: LucideIcon }[] = [
  { key: "", title: "No header", text: "Just the message. Quickest to approve.", Icon: Ban },
  { key: "IMAGE", title: "Picture", text: "A product or festive photo on top. Best for campaigns.", Icon: ImageIcon },
  { key: "VIDEO", title: "Video", text: "A short clip on top. MP4, up to 16 MB.", Icon: Video },
  { key: "TEXT", title: "Text title", text: "A bold one-line title above the message.", Icon: Type },
  { key: "DOCUMENT", title: "PDF", text: "A PDF such as a catalogue or price list.", Icon: FileText },
];

const BTN_KIND: Record<DraftButton["type"], { label: string; Icon: LucideIcon }> = {
  URL: { label: "Visit website", Icon: ExternalLink },
  PHONE_NUMBER: { label: "Call us", Icon: Phone },
  QUICK_REPLY: { label: "Quick reply", Icon: CornerUpLeft },
};

export function StepMedia({ d, update, errorsFor, warningsFor, touch, total }: StepProps & { total: number }) {
  const media = mediaKindForHeader(d.header_type);
  const headerVars = d.header_type === "TEXT" ? varNumbers(d.header_text) : [];
  const shownFooter = finalFooter(d.category, d.footer);

  function setButtons(buttons: DraftButton[]) { update({ buttons }); touch("buttons"); }
  function patchButton(i: number, patch: Partial<DraftButton>) {
    const next = [...d.buttons];
    next[i] = { ...next[i], ...patch } as DraftButton;
    setButtons(next);
  }
  function moveUp(i: number) {
    if (i === 0) return;
    const next = [...d.buttons];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setButtons(next);
  }

  return (
    <div className={s.cMain}>
      <StepHeader
        step={3}
        total={total}
        title="Picture and buttons"
        why="A picture makes the message stand out in the chat list. A button gives people one easy thing to tap."
        glossary={["header_media", "stop_footer"]}
      />

      <section className={s.section} aria-labelledby="tpl-hdr">
        <h3 id="tpl-hdr" className={s.sectionTitle}>
          Top of the message (<GlossaryTerm k="header_media">header</GlossaryTerm>)
        </h3>
        <div className={s.choices}>
          {HEADERS.map((h) => {
            const on = d.header_type === h.key;
            return (
              <button
                key={h.key || "none"}
                type="button"
                className={`${s.choice} ${on ? s.choiceOn : ""}`}
                aria-pressed={on}
                onClick={() => {
                  update({
                    header_type: h.key,
                    header_media_url: h.key && h.key !== "TEXT" && h.key === d.header_type ? d.header_media_url : null,
                    header_media: null,
                  });
                  touch("header");
                }}
              >
                <span className={s.choiceTitle}><h.Icon aria-hidden="true" />{h.title}</span>
                <span className={s.choiceText}>{h.text}</span>
              </button>
            );
          })}
        </div>

        {d.header_type === "TEXT" && (
          <div className={s.field}>
            <label className={s.label} htmlFor="tpl-htext">Title text</label>
            <input
              id="tpl-htext"
              className={`${s.input} ${errorsFor("header").length ? s.inputErr : ""}`}
              value={d.header_text}
              placeholder="Something new is here"
              onChange={(e) => update({ header_text: e.target.value })}
              onBlur={() => touch("header")}
            />
            <div className={s.hint}>Up to {HEADER_TEXT_MAX} characters, one line, no emojis. You can use one blank, {"{{1}}"}.</div>
            {headerVars.map((n) => (
              <div key={n} className={s.field}>
                <label className={s.hint} htmlFor={`hs-${n}`}>Example for {`{{${n}}}`} (Meta&apos;s reviewer sees this)</label>
                <input
                  id={`hs-${n}`}
                  className={s.input}
                  value={d.headerSamples[String(n)] ?? ""}
                  onChange={(e) => update({ headerSamples: { ...d.headerSamples, [String(n)]: e.target.value } })}
                  onBlur={() => touch("header_samples")}
                />
              </div>
            ))}
          </div>
        )}

        {media && (
          <div className={s.field}>
            <span className={s.label}>
              Upload the {media === "document" ? "PDF" : media === "image" ? "picture" : "video"}
              <HelpTip text="Meta's reviewer sees this file. Campaigns can swap in a different picture later, as long as it fits the same message." />
            </span>
            <MediaUploader
              kind={media}
              value={d.header_media_url}
              onChange={(url, m) => { update({ header_media_url: url, header_media: m ? { mime: m.mime, size: m.size } : null }); touch("header"); }}
            />
          </div>
        )}
        <IssueList tone="error" issues={errorsFor("header")} />
        <IssueList tone="error" issues={errorsFor("header_samples")} />
      </section>

      <section className={s.section} aria-labelledby="tpl-btns">
        <h3 id="tpl-btns" className={s.sectionTitle}>Buttons (optional)</h3>
        <div className={s.help}>Up to 2 website buttons and 1 call button, {MAX_BUTTONS} in total. Button labels can&apos;t have emojis.</div>
        {d.buttons.map((b, i) => {
          const k = BTN_KIND[b.type];
          const dynamic = b.type === "URL" && b.url.includes("{{");
          const base = b.type === "URL" ? b.url.replace(/\{\{1\}\}$/, "") : "";
          const rowErr = errorsFor(`buttons.${i}`);
          return (
            <div key={i} className={s.btnRow}>
              <div className={s.btnRowHead}>
                <span className={s.btnKind}><k.Icon aria-hidden="true" /> {k.label}</span>
                <span className={s.inline}>
                  {i > 0 && (
                    <button type="button" className={`pm2-btn sm ${s.iconOnly}`} onClick={() => moveUp(i)} aria-label={`Move button ${i + 1} up`}>
                      <ArrowUp aria-hidden="true" />
                    </button>
                  )}
                  <button type="button" className={`pm2-btn sm ${s.iconOnly} ${s.danger}`} onClick={() => setButtons(d.buttons.filter((_, j) => j !== i))} aria-label={`Remove button ${i + 1}`}>
                    <X aria-hidden="true" />
                  </button>
                </span>
              </div>
              <div className={s.btnFields}>
                <div className={s.field}>
                  <label className={s.hint} htmlFor={`btn-t-${i}`}>Button text</label>
                  <input id={`btn-t-${i}`} className={`${s.input} ${rowErr.length ? s.inputErr : ""}`} value={b.text} maxLength={40}
                    placeholder={b.type === "URL" ? "Shop now" : b.type === "PHONE_NUMBER" ? "Call us" : "Yes please"}
                    onChange={(e) => patchButton(i, { text: e.target.value })} />
                </div>
                {b.type === "URL" && (
                  <div className={s.field}>
                    <label className={s.hint} htmlFor={`btn-u-${i}`}>Web address it opens</label>
                    <input id={`btn-u-${i}`} className={s.input} value={b.url} inputMode="url" placeholder="https://promunch.in"
                      onChange={(e) => patchButton(i, { url: e.target.value })} />
                  </div>
                )}
                {b.type === "PHONE_NUMBER" && (
                  <div className={s.field}>
                    <label className={s.hint} htmlFor={`btn-p-${i}`}>Phone number, with country code</label>
                    <input id={`btn-p-${i}`} className={s.input} value={b.phone_number} inputMode="tel" placeholder="+919876543210"
                      onChange={(e) => patchButton(i, { phone_number: e.target.value })} />
                  </div>
                )}
              </div>
              {b.type === "URL" && (
                <label className={s.check}>
                  <input
                    type="checkbox"
                    checked={dynamic}
                    onChange={(e) => patchButton(i, { url: e.target.checked ? `${base.replace(/\/?$/, "/")}{{1}}` : base })}
                  />
                  <span>
                    The end of the link changes for each customer (for example their cart or order link).
                    <span className={s.hint}> Most campaigns don&apos;t need this.</span>
                  </span>
                </label>
              )}
              {dynamic && (
                <div className={s.field}>
                  <label className={s.hint} htmlFor={`btn-e-${i}`}>
                    Example of a full link (Meta&apos;s reviewer sees this). It must start with {base} and add something after it.
                  </label>
                  <input id={`btn-e-${i}`} className={s.input} value={b.type === "URL" ? b.example ?? "" : ""}
                    placeholder={`${base}abc123`} onChange={(e) => patchButton(i, { example: e.target.value })} />
                </div>
              )}
              <IssueList tone="error" issues={rowErr} />
            </div>
          );
        })}
        <IssueList tone="error" issues={errorsFor("buttons").filter((e) => e.field === "buttons")} />
        <div className={s.inline}>
          <button type="button" className="pm2-btn sm" onClick={() => setButtons([...d.buttons, { type: "URL", text: "Shop now", url: "https://promunch.in" }])}>
            <ExternalLink aria-hidden="true" /> Visit website
          </button>
          <button type="button" className="pm2-btn sm" onClick={() => setButtons([...d.buttons, { type: "PHONE_NUMBER", text: "Call us", phone_number: "" }])}>
            <Phone aria-hidden="true" /> Call us
          </button>
          <button type="button" className="pm2-btn sm" onClick={() => setButtons([...d.buttons, { type: "QUICK_REPLY", text: "" }])}>
            <CornerUpLeft aria-hidden="true" /> Quick reply
          </button>
        </div>
        <div className={s.hint}>
          Quick reply puts a tap-to-answer button in the chat, and the answer comes to the WhatsApp inbox. Links to our store get tracking added
          automatically, so orders they bring in show under WhatsApp revenue.
        </div>
      </section>

      <details className={s.section}>
        <summary className={s.sectionTitle}>Small grey line at the bottom (optional)</summary>
        <div className={s.field}>
          <label className={s.hint} htmlFor="tpl-foot">Footer text</label>
          <input id="tpl-foot" className={s.input} value={d.footer} placeholder="Your Munchy Pal"
            onChange={(e) => update({ footer: e.target.value })} onBlur={() => touch("footer")} />
          {isMarketingCategory(d.category) && (
            <div className={s.hint}>
              Customers will see: <strong>{shownFooter}</strong> ({(shownFooter ?? "").length}/{FOOTER_MAX}). The{" "}
              <GlossaryTerm k="stop_footer">STOP line</GlossaryTerm> is always added for marketing.
            </div>
          )}
          <IssueList tone="error" issues={errorsFor("footer")} />
          <IssueList tone="warning" issues={warningsFor("footer")} />
        </div>
      </details>
    </div>
  );
}
