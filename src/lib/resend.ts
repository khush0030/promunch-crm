import { Resend } from 'resend';
import { getSecret } from '@/lib/secrets';

let _client: Resend | null = null;
let _clientKey: string | null = null;

async function getClient(): Promise<Resend> {
  const key = await getSecret('RESEND_API_KEY');
  if (!key) {
    throw new Error('RESEND_API_KEY is not set. Add it in Settings → API keys, .env.local or Vercel project env.');
  }
  // Rebuild the client when the owner rotates the key from the dashboard.
  if (!_client || _clientKey !== key) {
    _client = new Resend(key);
    _clientKey = key;
  }
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
  const result = await (await getClient()).emails.send({
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

  const client = await getClient();
  const results = [];
  for (let i = 0; i < batches.length; i += 100) {
    const chunk = batches.slice(i, i + 100);
    const result = await client.batch.send(chunk);
    results.push(result);
  }
  return results;
}
