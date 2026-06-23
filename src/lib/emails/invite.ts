// Branded PROMUNCH invite email. Sent via Resend (DEFAULT_FROM = the verified
// trypromunch.in domain), NOT Supabase's default auth email. The action link is
// minted server-side with supabaseAdmin.auth.admin.generateLink({type:'invite'}).
//
// Brand rules (enforced): PROMUNCH is always all-caps; never use em dashes.

const BRAND = "#B9303F";

export function inviteEmailSubject(): string {
  return "You're invited to the PROMUNCH CRM";
}

export function inviteEmailText({
  inviteUrl,
  inviterName,
  recipientName,
}: {
  inviteUrl: string;
  inviterName?: string;
  recipientName?: string;
}): string {
  const hi = recipientName ? `Hi ${recipientName},` : "Hi,";
  const by = inviterName ? `${inviterName} has invited you` : "You've been invited";
  return [
    hi,
    "",
    `${by} to join the PROMUNCH CRM, the place where the team runs orders, support, WhatsApp and campaigns.`,
    "",
    "Set up your account here (link valid for 24 hours):",
    inviteUrl,
    "",
    "Once you set a password you'll land in the dashboard and a short guided tour will show you around.",
    "",
    "PROMUNCH - Your Munchy Pal",
  ].join("\n");
}

export function inviteEmailHtml({
  inviteUrl,
  inviterName,
  recipientName,
}: {
  inviteUrl: string;
  inviterName?: string;
  recipientName?: string;
}): string {
  const hi = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi,";
  const by = inviterName
    ? `<strong>${escapeHtml(inviterName)}</strong> has invited you`
    : "You've been invited";
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F5F1EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2A2622;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EA;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#FFFFFF;border-radius:16px;border:1px solid #E7E0D5;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <div style="font-size:18px;font-weight:700;letter-spacing:0.01em;color:${BRAND};">PROMUNCH</div>
                <div style="font-size:11px;letter-spacing:0.16em;color:#8A8174;font-weight:600;text-transform:uppercase;">CRM</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <h1 style="font-size:21px;font-weight:600;letter-spacing:-0.015em;margin:14px 0 6px 0;">You're on the team</h1>
                <p style="font-size:14px;line-height:1.6;color:#5A5247;margin:0 0 4px 0;">${hi}</p>
                <p style="font-size:14px;line-height:1.6;color:#5A5247;margin:8px 0 0 0;">
                  ${by} to join the PROMUNCH CRM, where the team runs orders, support, WhatsApp and campaigns in one place.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;">
                <a href="${inviteUrl}" style="display:inline-block;background:${BRAND};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:10px;">
                  Set up my account
                </a>
                <p style="font-size:12px;color:#8A8174;margin:14px 0 0 0;">This link is valid for 24 hours. After you set a password, a short guided tour shows you around the dashboard.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 28px 32px;border-top:1px solid #F0EAE0;margin-top:12px;">
                <p style="font-size:12px;color:#A39A8B;margin:14px 0 0 0;">If the button doesn't work, copy this link into your browser:</p>
                <p style="font-size:12px;color:${BRAND};word-break:break-all;margin:6px 0 0 0;">${inviteUrl}</p>
                <p style="font-size:12px;color:#A39A8B;margin:18px 0 0 0;">PROMUNCH - Your Munchy Pal</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
