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

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Same env + fallback as layout.ts footerAddress(); keep the two in sync. */
export function plainFooterAddress(): string {
  return process.env.EMAIL_FOOTER_ADDRESS || "PROMUNCH, 28, AB Rd, Industrial Area No. 1, Dewas, Madhya Pradesh 455001";
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
  const preheader = o.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(o.previewText)}</div>`
    : "";
  const sig = o.signature?.trim()
    ? `<p style="margin:18px 0 0 0;">${o.signature.trim().split(/\r?\n/).map(esc).join("<br>")}</p>`
    : "";
  const address = o.footerAddress ?? plainFooterAddress();
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
  <tr><td align="left" style="padding:16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr>
        <td align="left" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222222;text-align:left;">
          ${o.bodyHtml}
          ${sig}
        </td>
      </tr>
      <tr>
        <td align="left" style="padding-top:28px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#999999;text-align:left;">
          You are receiving this because you subscribed to PROMUNCH email.
          <a href="${esc(o.unsubscribeUrl)}" style="color:#999999;text-decoration:underline;">Unsubscribe</a>.<br>
          ${esc(address)}
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
