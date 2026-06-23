import { Resend } from 'resend';

let _client: Resend | null = null;

function getClient(): Resend {
  if (_client) return _client;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('RESEND_API_KEY is not set. Add it to .env.local or Vercel project env.');
  }
  _client = new Resend(key);
  return _client;
}

// Customer-facing marketing/campaign sender. Must be a Resend-verified domain
// (trypromunch.in is verified). Override via env to point at a dedicated
// marketing subdomain (e.g. PROMUNCH <hello@news.trypromunch.in>) once it's
// added in Resend, to isolate reputation from B2B cold outreach.
export const DEFAULT_FROM =
  process.env.EMAIL_MARKETING_FROM || 'PROMUNCH <hello@trypromunch.in>';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

export async function sendEmail({ to, subject, html, from, replyTo }: SendEmailOptions) {
  const result = await getClient().emails.send({
    from: from || DEFAULT_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
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

  const client = getClient();
  const results = [];
  for (let i = 0; i < batches.length; i += 100) {
    const chunk = batches.slice(i, i + 100);
    const result = await client.batch.send(chunk);
    results.push(result);
  }
  return results;
}
