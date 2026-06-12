// Free email verification: syntax + MX record via DNS-over-HTTPS.
// Raw SMTP (RCPT TO) checks are not possible from Vercel serverless (port 25),
// so the feedback loop is completed by the Resend bounce webhook -> suppressions.

export type VerifyStatus = 'unverified' | 'mx_ok' | 'mx_fail' | 'syntax_fail';
export type Confidence = 'high' | 'medium' | 'low';

const SYNTAX_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in',
  'outlook.com', 'hotmail.com', 'live.com', 'rediffmail.com', 'icloud.com',
  'protonmail.com', 'proton.me', 'zoho.com', 'zohomail.in', 'aol.com',
]);

export async function checkMx(domain: string, cache?: Map<string, boolean>): Promise<VerifyStatus> {
  if (cache?.has(domain)) return cache.get(domain) ? 'mx_ok' : 'mx_fail';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { accept: 'application/dns-json' }, signal: controller.signal },
    );
    if (!res.ok) return 'unverified';
    const json = (await res.json()) as { Status?: number; Answer?: { type: number }[] };
    const ok = json.Status === 0 && (json.Answer ?? []).some((a) => a.type === 15);
    cache?.set(domain, ok);
    return ok ? 'mx_ok' : 'mx_fail';
  } catch {
    return 'unverified'; // DoH hiccup — don't penalize the contact
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyEmail(
  email: string,
  cache?: Map<string, boolean>,
): Promise<VerifyStatus> {
  if (!SYNTAX_RE.test(email)) return 'syntax_fail';
  return checkMx(email.split('@')[1], cache);
}

/**
 * high   = MX ok and email is on the company's own domain (published on their site)
 * medium = MX ok freemail published on the site (common for Indian SMBs)
 * low    = anything that failed or couldn't be verified
 */
export function scoreConfidence(
  email: string,
  verifyStatus: VerifyStatus,
  siteDomain: string | null,
): Confidence {
  if (verifyStatus === 'mx_fail' || verifyStatus === 'syntax_fail') return 'low';
  const emailDomain = email.split('@')[1] ?? '';
  if (verifyStatus === 'mx_ok' && siteDomain && (emailDomain === siteDomain || emailDomain.endsWith(`.${siteDomain}`))) {
    return 'high';
  }
  if (verifyStatus === 'mx_ok' && FREEMAIL_DOMAINS.has(emailDomain)) return 'medium';
  if (verifyStatus === 'mx_ok') return 'medium'; // valid third-party business domain
  return 'low';
}
