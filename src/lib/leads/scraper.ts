// Free contact discovery: crawl a company website (homepage + up to 4 likely
// contact/about pages) and extract published email addresses.
//
// robots.txt is intentionally not consulted in v1: we fetch at most 5 public
// marketing pages once per company, with an identified UA. Revisit if needed.

import * as cheerio from 'cheerio';

export interface ExtractedContact {
  email: string;
  sourceUrl: string;
  source: 'mailto' | 'regex';
  kind: 'role' | 'personal';
  roleHint: string | null;
}

export interface CrawlResult {
  contacts: ExtractedContact[];
  snippet: string | null; // ~800 chars of about/home prose for AI personalization
  pagesFetched: number;
}

// A plain browser UA: SMB sites (Shopify/Wix bot protection, cheap WAFs) hard-403
// anything that self-identifies as a bot, which silently zeroed out real emails
// (e.g. wrapnwows.com serves 403 to "ProMunchBot" but 200 to a browser UA).
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PAGE_TIMEOUT_MS = 10_000;
const MAX_EXTRA_PAGES = 4;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CONTACT_LINK_RE = /contact|about|reach|connect|team|career|enquir|inquir/i;

const ASSET_EXT_RE = /\.(png|jpe?g|webp|svg|gif|ico|css|js|woff2?|ttf|mp4|pdf)$/i;
// Placeholder addresses sites use in form examples ("abcd@gmail.com").
const PLACEHOLDER_LOCALS = new Set([
  'abc', 'abcd', 'test', 'testing', 'demo', 'sample', 'example', 'user', 'username',
  'name', 'yourname', 'youremail', 'email', 'someone', 'john', 'johndoe', 'john.doe',
  'jane', 'janedoe', 'xyz', 'asdf', 'qwerty', 'firstname', 'lastname',
]);

const NOISE_DOMAINS = [
  'example.com', 'example.org', 'sentry.io', 'sentry-cdn.com', 'wixpress.com',
  'sentry.wixpress.com', 'domain.com', 'email.com', 'yourdomain.com', 'godaddy.com',
  'mysite.com', 'company.com', 'website.com', 'placeholder.com', 'schema.org',
  // B2B marketplace/aggregator addresses embedded in seller sites — emailing
  // these reaches the marketplace, not the company.
  'tradeindia.com', 'indiamart.com', 'justdial.com', 'sulekha.com',
  'exportersindia.com', 'alibaba.com',
];

const ROLE_LOCALS: Record<string, string> = {
  info: 'info', contact: 'info', contactus: 'info', hello: 'info', mail: 'info',
  enquiry: 'enquiry', enquiries: 'enquiry', inquiry: 'enquiry', enquire: 'enquiry',
  sales: 'sales', business: 'sales', bd: 'sales', partnerships: 'sales',
  marketing: 'marketing', orders: 'sales',
  hr: 'hr', careers: 'careers', career: 'careers', jobs: 'careers', recruitment: 'hr',
  admin: 'admin', office: 'admin', accounts: 'admin', support: 'support', help: 'support',
};

// Higher = better target for a B2B gifting/pantry pitch.
const PRIMARY_PRIORITY: Record<string, number> = {
  personal: 100, sales: 80, marketing: 70, enquiry: 60, info: 50, hr: 40, admin: 35,
  support: 20, careers: 10,
};

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const ctype = res.headers.get('content-type') || '';
    if (!ctype.includes('html')) return null;
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) return text.slice(0, MAX_BODY_BYTES);
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function cleanEmail(raw: string): string | null {
  let email = raw.toLowerCase().trim();
  email = email.replace(/^mailto:/, '').split('?')[0];
  email = email.replace(/[.,;:)\]}>'"]+$/, '');
  if (email.includes('%')) return null;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return null;
  const [local, domain] = [email.slice(0, at), email.slice(at + 1)];
  if (local.length > 64 || !domain.includes('.')) return null;
  if (ASSET_EXT_RE.test(email)) return null;
  if (/^[0-9a-f]{16,}$/.test(local)) return null; // tracking-hash locals
  if (PLACEHOLDER_LOCALS.has(local)) return null;
  if (NOISE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return null;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return null;
  return email;
}

export function classifyEmail(email: string): { kind: 'role' | 'personal'; roleHint: string | null } {
  const local = email.split('@')[0].replace(/[._-]/g, '');
  const hint = ROLE_LOCALS[local];
  if (hint) return { kind: 'role', roleHint: hint };
  // Bare role words embedded ("info.delhi") still count as role inboxes.
  for (const [key, value] of Object.entries(ROLE_LOCALS)) {
    if (local.startsWith(key)) return { kind: 'role', roleHint: value };
  }
  return { kind: 'personal', roleHint: null };
}

export function primaryScore(contact: { kind: string; roleHint: string | null }): number {
  if (contact.kind === 'personal') return PRIMARY_PRIORITY.personal;
  return PRIMARY_PRIORITY[contact.roleHint ?? ''] ?? 30;
}

function extractFromHtml(html: string, sourceUrl: string): ExtractedContact[] {
  const found = new Map<string, ExtractedContact>();
  const $ = cheerio.load(html);

  $('a[href^="mailto:"]').each((_, el) => {
    const email = cleanEmail($(el).attr('href') || '');
    if (email && !found.has(email)) {
      found.set(email, { email, sourceUrl, source: 'mailto', ...classifyEmail(email) });
    }
  });

  // Raw-HTML regex pass catches emails embedded in JSON/scripts on JS-rendered sites.
  for (const match of html.match(EMAIL_RE) ?? []) {
    const email = cleanEmail(match);
    if (email && !found.has(email)) {
      found.set(email, { email, sourceUrl, source: 'regex', ...classifyEmail(email) });
    }
  }

  return [...found.values()];
}

function pickContactLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  let baseHost: string;
  try {
    baseHost = new URL(baseUrl).hostname.replace(/^www\./, '');
  } catch {
    return [];
  }

  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text() || '';
    if (!CONTACT_LINK_RE.test(href) && !CONTACT_LINK_RE.test(text)) return;
    try {
      const url = new URL(href, baseUrl);
      if (!/^https?:$/.test(url.protocol)) return;
      if (url.hostname.replace(/^www\./, '') !== baseHost) return;
      url.hash = '';
      links.add(url.toString());
    } catch {
      /* unparseable href */
    }
  });
  return [...links].slice(0, MAX_EXTRA_PAGES);
}

function extractSnippet(html: string): string | null {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header').remove();
  const text = $('p')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => t.length > 40)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 800) : null;
}

export async function crawlSite(website: string): Promise<CrawlResult> {
  const home = await fetchHtml(website);
  if (home === null) {
    return { contacts: [], snippet: null, pagesFetched: 0 };
  }

  const byEmail = new Map<string, ExtractedContact>();
  for (const c of extractFromHtml(home, website)) byEmail.set(c.email, c);
  let snippet = extractSnippet(home);
  let pagesFetched = 1;

  for (const link of pickContactLinks(home, website)) {
    const html = await fetchHtml(link);
    if (html === null) continue;
    pagesFetched++;
    for (const c of extractFromHtml(html, link)) {
      // mailto beats regex for the same address (clearer intent / source).
      const existing = byEmail.get(c.email);
      if (!existing || (existing.source === 'regex' && c.source === 'mailto')) {
        byEmail.set(c.email, c);
      }
    }
    if (!snippet && /about/i.test(link)) snippet = extractSnippet(html);
  }

  return { contacts: [...byEmail.values()], snippet, pagesFetched };
}
