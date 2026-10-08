// Auto-reply email for a bulk order inquiry. Look matches the approved mockup
// (Oct 7 2026) and the flow emails: brand-tokens.ts colours, fonts and logo.
// Transactional (the person asked for a quote), so no unsubscribe link; the
// footer says why they got it and carries the postal address.
//
// Copy rules: PROMUNCH caps, no em dashes, "Your Munchy Pal". Inline styles
// because some clients strip <style>.

import {
  EMAIL_BRAND,
  EMAIL_COLORS as C,
  EMAIL_FONT,
  EMAIL_HEADING_FONT,
  EMAIL_LAYOUT as L,
  EMAIL_MONO,
  EMAIL_TYPE as T,
  emailFooterAddress,
  emailHead,
  escHtml,
  logoHtml,
  preheaderHtml,
} from "@/lib/email/brand-tokens";
import {
  QUANTITY_BANDS,
  USE_CASES,
  firstName,
  questionsFor,
  shortDate,
  type BulkInquiryInput,
} from "./schema";

export interface BulkEmailInput {
  inquiry: Pick<BulkInquiryInput, "name" | "company" | "city" | "useCase" | "quantityBand" | "neededBy">;
  refNo: number | string;
  opener: string;
  whatsappDisplay: string;
  replyTo?: string;
  /** Override the order-type subject, e.g. for a late follow-up. */
  subject?: string;
}

export interface BulkEmail {
  subject: string;
  preview: string;
  html: string;
  text: string;
}

export function renderBulkInquiryEmail(o: BulkEmailInput): BulkEmail {
  const q = o.inquiry;
  const uc = USE_CASES[q.useCase];
  const first = firstName(q.name);
  const subject = o.subject || uc.subject;
  const preview = `A few quick details and we will send your pricing.`;
  const replyTo = o.replyTo || "hello@promunch.in";
  const questions = questionsFor(q.useCase, q.quantityBand === "unsure");
  // "unsure" is our default, not something the person said: leave it out.
  const tags = [uc.label, q.quantityBand === "unsure" ? null : QUANTITY_BANDS[q.quantityBand], q.city, q.neededBy ? `By ${shortDate(q.neededBy)}` : null]
    .filter(Boolean) as string[];
  const waDigits = o.whatsappDisplay.replace(/\D/g, "");
  const mailto = `mailto:${replyTo}?subject=${encodeURIComponent("Re: " + subject)}`;

  const label = (s: string, color: string = C.brand) =>
    `<div style="font-family:${EMAIL_MONO};font-size:11px;line-height:1.4;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:${color};">${escHtml(s)}</div>`;

  const tagHtml = tags
    .map((t) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;background:${C.card};border:1px solid ${C.line};border-radius:999px;font-family:${EMAIL_FONT};font-size:14px;line-height:1.3;font-weight:700;color:${C.ink};">${escHtml(t)}</span>`)
    .join("");

  const qHtml = questions
    .map((t, i) => `<tr><td valign="top" style="width:26px;padding:6px 0;font-family:${EMAIL_HEADING_FONT};font-size:15px;line-height:1.5;color:${C.brand};">${i + 1}.</td><td style="padding:6px 0;font-family:${EMAIL_FONT};font-size:${T.body}px;line-height:1.5;color:${C.ink};">${escHtml(t)}</td></tr>`)
    .join("");

  const html = `<!doctype html>
<html lang="en">
${emailHead()}
<body style="margin:0;padding:0;background:${C.page};font-family:${EMAIL_FONT};color:${C.ink};-webkit-text-size-adjust:100%;">
${preheaderHtml(preview)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
  <tr><td align="center" style="padding:24px 0;">
    <table role="presentation" class="pm-card" width="${L.width}" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="width:${L.width}px;max-width:${L.width}px;background:${C.card};border:1px solid ${C.line};border-radius:${L.cardRadius}px;overflow:hidden;">
      <tr>
        <td class="pm-pad" style="padding:20px ${L.pad}px;border-bottom:1px solid ${C.line};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td align="left">${logoHtml({ href: EMAIL_BRAND.website, align: "left", logoWidth: 150 })}</td>
            <td align="right" style="font-family:${EMAIL_MONO};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.hint};white-space:nowrap;">Bulk order · B-${escHtml(String(o.refNo))}</td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td class="pm-pad" bgcolor="${C.brand}" style="background:${C.brand};padding:28px ${L.pad}px 26px;">
          ${label("★ Request received", "#F6D7D9")}
          <div style="margin-top:8px;font-family:${EMAIL_HEADING_FONT};font-size:${T.h1}px;line-height:1.1;font-weight:${T.headingWeight};text-transform:uppercase;color:${C.onBrand};">Thanks, ${escHtml(first)}. Your quote is on its way.</div>
        </td>
      </tr>
      <tr>
        <td class="pm-pad" style="padding:26px ${L.pad}px 8px;">
          <p style="margin:0 0 20px;font-family:${EMAIL_FONT};font-size:17px;line-height:${T.lineHeight};color:${C.ink};">${escHtml(o.opener)}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.panel}" style="background:${C.panel};border-radius:12px;">
            <tr><td style="padding:14px 16px 8px;">
              ${label("Your request")}
              <div style="margin-top:10px;">${tagHtml}</div>
            </td></tr>
          </table>
          <div style="margin:24px 0 4px;">${label("Just reply with")}</div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">${qHtml}</table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;"><tr>
            <td bgcolor="${C.brand}" style="background:${C.brand};border-radius:${L.buttonRadius}px;">
              <a href="${escHtml(mailto)}" style="display:inline-block;padding:14px 22px;font-family:${EMAIL_HEADING_FONT};font-size:15px;letter-spacing:.5px;text-transform:uppercase;color:${C.onBrand};text-decoration:none;white-space:nowrap;">Reply with details</a>
            </td>
          </tr></table>
          <p style="margin:0 0 8px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.5;color:${C.muted};">Prefer WhatsApp? <a href="https://wa.me/${waDigits}" style="color:${C.ink};font-weight:700;text-decoration:none;white-space:nowrap;">${escHtml(o.whatsappDisplay)}</a></p>
        </td>
      </tr>
      <tr>
        <td class="pm-pad" style="padding:18px ${L.pad}px 24px;">
          <div style="font-family:${EMAIL_FONT};font-size:${T.body}px;line-height:1.4;color:${C.ink};">Team PROMUNCH</div>
          <div style="font-family:${EMAIL_HEADING_FONT};font-size:14px;line-height:1.4;text-transform:uppercase;color:${C.brand};">${escHtml(EMAIL_BRAND.tagline)}</div>
        </td>
      </tr>
      <tr>
        <td class="pm-pad" style="padding:16px ${L.pad}px 22px;border-top:1px solid ${C.line};font-family:${EMAIL_FONT};font-size:${T.footer}px;line-height:1.6;color:${C.muted};">
          You are receiving this because you requested a bulk quote on promunch.in.<br>${escHtml(emailFooterAddress())}
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    `Thanks, ${first}. Your quote is on its way.`,
    "",
    o.opener,
    "",
    `Your request: ${tags.join(" · ")}`,
    "",
    "Just reply with:",
    ...questions.map((t, i) => `${i + 1}. ${t}`),
    "",
    `Or WhatsApp us on ${o.whatsappDisplay}.`,
    "",
    "Team PROMUNCH",
    EMAIL_BRAND.tagline,
    "",
    `Bulk order B-${o.refNo}. You are receiving this because you requested a bulk quote on promunch.in.`,
    emailFooterAddress(),
  ].join("\n");

  return { subject, preview, html, text };
}
