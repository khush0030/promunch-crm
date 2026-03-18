import { Resend } from 'resend';

const resendApiKey = process.env.RESEND_API_KEY!;

export const resendClient = new Resend(resendApiKey);

export const DEFAULT_FROM = 'PROMUNCH <onboarding@resend.dev>';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail({ to, subject, html, from }: SendEmailOptions) {
  const result = await resendClient.emails.send({
    from: from || DEFAULT_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  });
  return result;
}

export interface BatchEmailItem {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendBatchEmails(emails: BatchEmailItem[]) {
  const batches = emails.map((e) => ({
    from: e.from || DEFAULT_FROM,
    to: [e.to],
    subject: e.subject,
    html: e.html,
  }));

  // Resend batch API allows up to 100 emails per request
  const results = [];
  for (let i = 0; i < batches.length; i += 100) {
    const chunk = batches.slice(i, i + 100);
    const result = await resendClient.batch.send(chunk);
    results.push(result);
  }
  return results;
}
