// Internal "new bulk enquiry" alert for the team (hello@ + founders).
// Sent from no-reply@promunch.in so the hello@ inbox agent and deal-scan treat
// it as machine mail (no AI draft, no duplicate deal); Reply-To is the
// customer, so hitting Reply answers them directly. Never sent to a customer.

import {
  EMAIL_COLORS as C,
  EMAIL_FONT,
  EMAIL_HEADING_FONT,
  EMAIL_LAYOUT as L,
  EMAIL_MONO,
  emailHead,
  escHtml,
} from "@/lib/email/brand-tokens";
import { PRODUCTS, QUANTITY_BANDS, USE_CASES, shortDate, type BulkInquiryInput } from "./schema";

export const TEAM_ALERT_FROM = "PROMUNCH Leads <no-reply@promunch.in>";

export function renderTeamAlertEmail(o: {
  inquiry: BulkInquiryInput;
  refNo: number;
  autoReply: string; // email_status of the customer auto-reply
  crmUrl: string;
}): { subject: string; html: string; text: string } {
  const q = o.inquiry;
  const uc = USE_CASES[q.useCase].label;
  const subject = `New bulk enquiry B-${o.refNo}: ${q.company} (${uc}, ${q.city})`;
  const replyState =
    o.autoReply === "sent" ? "Sent automatically" :
    o.autoReply === "skipped_duplicate" ? "Not sent (they already got one today)" :
    o.autoReply === "skipped_disabled" ? "Not sent (auto-reply switched off)" :
    "Not sent (check the CRM)";

  const rows: Array<[string, string]> = [
    ["Name", q.name],
    ["Company", q.company],
    ["Email", q.email],
    ["Phone", q.phone],
    ["Order type", uc],
    ["Quantity", QUANTITY_BANDS[q.quantityBand]],
    ["Products", q.products.length ? q.products.map((p) => PRODUCTS[p]).join(", ") : "Not specified"],
    ["Delivery city", q.city],
    ["Needed by", q.neededBy ? shortDate(q.neededBy) + " " + q.neededBy.slice(0, 4) : "Not specified"],
    ["Their note", q.notes || "None"],
    ["Auto-reply", replyState],
  ];

  const rowHtml = rows
    .map(([k, v]) => `<tr>
      <td valign="top" style="padding:9px 12px 9px 0;border-top:1px solid ${C.line};width:120px;font-family:${EMAIL_MONO};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};">${escHtml(k)}</td>
      <td valign="top" style="padding:9px 0;border-top:1px solid ${C.line};font-family:${EMAIL_FONT};font-size:15px;line-height:1.5;color:${C.ink};">${escHtml(v).replace(/\n/g, "<br>")}</td>
    </tr>`)
    .join("");

  const waDigits = q.phone.replace(/\D/g, "");
  const html = `<!doctype html>
<html lang="en">
${emailHead()}
<body style="margin:0;padding:0;background:${C.page};font-family:${EMAIL_FONT};color:${C.ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
  <tr><td align="center" style="padding:20px 0;">
    <table role="presentation" class="pm-card" width="${L.width}" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="width:${L.width}px;max-width:${L.width}px;background:${C.card};border:1px solid ${C.line};border-radius:${L.cardRadius}px;">
      <tr><td class="pm-pad" bgcolor="${C.brand}" style="background:${C.brand};padding:20px ${L.pad}px;border-radius:${L.cardRadius}px ${L.cardRadius}px 0 0;">
        <div style="font-family:${EMAIL_MONO};font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:#F6D7D9;">★ New bulk enquiry · B-${o.refNo}</div>
        <div style="margin-top:6px;font-family:${EMAIL_HEADING_FONT};font-size:22px;line-height:1.15;text-transform:uppercase;color:#fff;">${escHtml(q.company)}</div>
        <div style="margin-top:4px;font-family:${EMAIL_FONT};font-size:15px;color:#F6D7D9;">${escHtml(uc)} · ${escHtml(q.city)}</div>
      </td></tr>
      <tr><td class="pm-pad" style="padding:8px ${L.pad}px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowHtml}</table>
      </td></tr>
      <tr><td class="pm-pad" style="padding:16px ${L.pad}px 24px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.6;color:${C.ink};">
        <b>Reply to this email</b> to answer ${escHtml(q.name.split(/\s+/)[0] || "them")} directly, or
        <a href="https://wa.me/${waDigits}" style="color:${C.brand};font-weight:700;">WhatsApp them</a>.
        The deal is on the <a href="${escHtml(o.crmUrl)}" style="color:${C.brand};font-weight:700;">CRM deals board</a>.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    `New bulk enquiry B-${o.refNo}: ${q.company}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `Reply to this email to answer them directly, or WhatsApp https://wa.me/${waDigits}`,
    `Deal: ${o.crmUrl}`,
  ].join("\n");

  return { subject, html, text };
}
