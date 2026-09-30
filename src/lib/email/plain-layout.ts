// Plain-text-looking "founder" email wrapper for flow steps with format:"plain".
//
// Looks like a personal note from a real person: no logo banner, no card, no
// background colour, left-aligned body in the reader's default-ish font, an
// optional simple signature. It is still a MARKETING email, so the compliance
// footer (unsubscribe link + physical postal address) is always present, and
// the caller still attaches marketingHeaders() (List-Unsubscribe one-click).
//
// Kept separate from layout.ts so renderMarketingEmail() callers are untouched.
// Pure: takes the unsubscribe URL instead of signing it, so it is unit-testable
// without UNSUBSCRIBE_SECRET.

import {
  EMAIL_COLORS as C,
  EMAIL_FONT,
  EMAIL_LAYOUT as L,
  EMAIL_TYPE as T,
  emailFooterAddress,
  emailHead,
  escHtml as esc,
  footerInnerHtml,
  preheaderHtml,
} from "./brand-tokens";

// Same tokens as the designed layout (brand-tokens.ts): same font, 16px body,
// #111 text, grey footer. Only the logo banner, card and grey page are dropped.

/** Same env + fallback as layout.ts (both read brand-tokens.ts). */
export function plainFooterAddress(): string {
  return emailFooterAddress();
}

export interface PlainEmailOptions {
  unsubscribeUrl: string;
  bodyHtml: string;
  previewText?: string;
  /** Plain text, newlines become line breaks. e.g. "Parth\nFounder, PROMUNCH". */
  signature?: string;
  footerAddress?: string;
}

export function renderPlainMarketingEmail(o: PlainEmailOptions): string {
  const sig = o.signature?.trim()
    ? `<p style="margin:24px 0 0 0;">${o.signature.trim().split(/\r?\n/).map(esc).join("<br>")}</p>`
    : "";
  const address = o.footerAddress ?? plainFooterAddress();
  return `<!doctype html>
<html lang="en">
${emailHead()}
<body style="margin:0;padding:0;background:${C.card};font-family:${EMAIL_FONT};color:${C.ink};-webkit-text-size-adjust:100%;">
${preheaderHtml(o.previewText)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="background:${C.card};">
  <tr><td align="left" style="padding:20px 16px;">
    <table role="presentation" width="${L.width}" cellpadding="0" cellspacing="0" border="0" style="max-width:${L.width}px;width:100%;">
      <tr>
        <td align="left" style="font-family:${EMAIL_FONT};font-size:${T.body}px;line-height:${T.lineHeight};color:${C.ink};text-align:left;">
          ${o.bodyHtml}
          ${sig}
        </td>
      </tr>
      <tr>
        <td align="left" style="padding-top:32px;">
          <div style="border-top:1px solid ${C.line};padding-top:16px;">${footerInnerHtml(o.unsubscribeUrl, address, "left")}</div>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
