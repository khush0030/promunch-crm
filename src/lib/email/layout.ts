// Shared branded wrapper for all customer marketing email (campaigns + flows).
//
// Copy rules (AGENTS.md §5): PROMUNCH in all caps, no em dashes in customer
// copy, tagline "Your Munchy Pal", never mention Oltaflock. Every marketing
// send goes through renderMarketingEmail() so the unsubscribe footer and the
// physical postal address (CAN-SPAM / Gmail bulk requirement) are always
// present. Styles are inline because email clients strip <style> blocks.

import { unsubscribeUrl } from "./unsubscribe";

// Warm-editorial palette (mirrors design/promunch-design-tokens.css).
const C = {
  side: "#1B2A20",
  accent: "#E0A24E",
  ink: "#1A1714",
  muted: "#6E665A",
  hint: "#9A9081",
  app: "#F1EBE0",
  card: "#FFFFFF",
  line: "#EFE8DB",
  blue: "#3C6E72",
};

/** Full postal address for the footer. Set the real address in env. */
function footerAddress(): string {
  return process.env.EMAIL_FOOTER_ADDRESS || "PROMUNCH, Vippy Industries Ltd, Mumbai, India";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface MarketingEmailOptions {
  contactId: string;
  bodyHtml: string;
  previewText?: string;
}

/**
 * Wrap author-provided body HTML in the PROMUNCH shell with a compliant footer.
 * Returns a complete HTML document string ready to hand to Resend.
 */
export function renderMarketingEmail({ contactId, bodyHtml, previewText }: MarketingEmailOptions): string {
  const unsub = unsubscribeUrl(contactId);
  const preheader = previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(previewText)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.app};font-family:'Geist',system-ui,-apple-system,'Segoe UI',sans-serif;color:${C.ink};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.app};padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${C.card};border-radius:16px;overflow:hidden;border:1px solid #E8DFD0;">
      <tr>
        <td style="background:${C.side};padding:22px 28px;text-align:center;">
          <div style="color:#ffffff;font-weight:800;font-size:18px;letter-spacing:.5px;">PROMUNCH</div>
          <div style="color:${C.accent};font-size:11px;font-style:italic;margin-top:2px;">Your Munchy Pal</div>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;font-size:14px;line-height:1.6;color:${C.ink};">
          ${bodyHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:18px 28px;border-top:1px solid ${C.line};font-size:11px;line-height:1.6;color:${C.hint};text-align:center;">
          You are receiving this because you subscribed to PROMUNCH email.<br>
          <a href="${unsub}" style="color:${C.blue};text-decoration:underline;">Unsubscribe</a> at any time.<br>
          ${esc(footerAddress())}
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
