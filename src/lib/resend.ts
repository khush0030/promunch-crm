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

// Where customer replies should land. The recovery copy invites people to reply
// ("reply to this email and we will sort it out"), so this must be a mailbox a
// human actually reads. hello@promunch.in is the Google Workspace inbox the
// email agent already monitors. Without this, replies go to the From address on
// the sending domain, which for trypromunch.in is an AWS SES inbound endpoint.
export const DEFAULT_REPLY_TO = process.env.EMAIL_REPLY_TO || 'hello@promunch.in';

/**
 * Plain-text alternative derived from the HTML body.
 *
 * Sending HTML with no text/plain part is a long-standing spam signal: every
 * legitimate bulk sender provides multipart/alternative, and filters treat
 * HTML-only mail as a bot marker. Cheap to fix, and it also renders correctly
 * in text-only clients and watch/preview panes.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    // keep the destination of links visible in the text part
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
      const text = String(label).replace(/<[^>]+>/g, "").trim();
      return text ? `${text}: ${href}` : String(href);
    })
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l) => l.trim()).join("\n")
    .trim();
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  /** Override the auto-derived plain-text part. */
  text?: string;
  // Per-message headers, e.g. List-Unsubscribe / List-Unsubscribe-Post for
  // one-click unsubscribe on marketing sends.
  headers?: Record<string, string>;
}

export async function sendEmail({ to, subject, html, from, replyTo, text, headers }: SendEmailOptions) {
  const result = await (await getClient()).emails.send({
    from: from || DEFAULT_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text: text || htmlToText(html),
    replyTo: replyTo || DEFAULT_REPLY_TO,
    ...(headers ? { headers } : {}),
  });
  return result;
}

export interface BatchEmailItem {
  to: string;
  subject: string;
  html: string;
  from?: string;
  headers?: Record<string, string>;
}

export async function sendBatchEmails(emails: BatchEmailItem[]) {
  const batches = emails.map((e) => ({
    from: e.from || DEFAULT_FROM,
    to: [e.to],
    subject: e.subject,
    html: e.html,
    // Same multipart/alternative reasoning as sendEmail — campaign blasts are
    // the sends most likely to be filtered, so they need it most.
    text: htmlToText(e.html),
    replyTo: DEFAULT_REPLY_TO,
    ...(e.headers ? { headers: e.headers } : {}),
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
