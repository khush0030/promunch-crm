// Shared branded wrapper for all customer marketing email (campaigns + flows).
//
// Copy rules (AGENTS.md §5): PROMUNCH in all caps, no em dashes in customer
// copy, tagline "Your Munchy Pal", never mention Oltaflock. Every marketing
// send goes through renderMarketingEmail() so the unsubscribe footer and the
// physical postal address (CAN-SPAM / Gmail bulk requirement) are always
// present. Styles are inline because some clients strip <style> blocks.

import { unsubscribeUrl } from "./unsubscribe";
import {
  EMAIL_BRAND,
  EMAIL_COLORS as C,
  EMAIL_FONT,
  EMAIL_LAYOUT as L,
  EMAIL_TYPE as T,
  emailFooterAddress,
  emailHead,
  footerInnerHtml,
  preheaderHtml,
  logoHtml,
} from "./brand-tokens";

// Look: the PROMUNCH storefront style (brand-tokens.ts: promunch.in colours,
// fonts and logo), shared with plain-layout.ts, brand-blocks.ts and the Email
// Studio default theme, so flow emails are siblings of Studio campaigns.

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
  return `<!doctype html>
<html lang="en">
${emailHead()}
<body style="margin:0;padding:0;background:${C.page};font-family:${EMAIL_FONT};color:${C.ink};-webkit-text-size-adjust:100%;">
${preheaderHtml(previewText)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
  <tr><td align="center" style="padding:24px 0;">
    <table role="presentation" class="pm-card" width="${L.width}" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="width:${L.width}px;max-width:${L.width}px;background:${C.card};border:1px solid ${C.line};border-radius:${L.cardRadius}px;">
      <tr>
        <td class="pm-pad" style="padding:24px ${L.pad}px 16px;border-bottom:1px solid ${C.line};">
          ${logoHtml({ tagline: EMAIL_BRAND.tagline, href: EMAIL_BRAND.website })}
        </td>
      </tr>
      <tr>
        <td class="pm-pad" style="padding:28px ${L.pad}px 12px;font-family:${EMAIL_FONT};font-size:${T.body}px;line-height:${T.lineHeight};color:${C.ink};text-align:left;">
          ${bodyHtml}
        </td>
      </tr>
      <tr>
        <td class="pm-pad" style="padding:20px ${L.pad}px 24px;border-top:1px solid ${C.line};">
          ${footerInnerHtml(unsub, emailFooterAddress())}
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
