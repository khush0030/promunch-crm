// Hunter adapter (free plan: 50 credits/month, API included). Uses Domain
// Search filtered by department, which returns named people at a company with
// their position, seniority and a verification status. A query costs 1 credit
// only when it returns at least one result; empty results are free.

import {
  FinderError,
  type DecisionCategory,
  type DecisionMakerFinder,
  type FinderInput,
  type FinderResult,
} from './types';

const ENDPOINT = 'https://api.hunter.io/v2/domain-search';
const TIMEOUT_MS = 30_000;

/** Our role -> Hunter `department` value. Roles not listed are unsupported. */
const DEPARTMENT: Partial<Record<DecisionCategory, string>> = {
  hr: 'hr',
  buyer: 'procurement',
  admin: 'administrative',
  operations: 'operations',
  ceo: 'executive',
  finance: 'finance',
  marketing: 'marketing',
  sales: 'sales',
  it: 'it',
};

type HunterEmail = {
  value?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  position?: unknown;
  seniority?: unknown;
  confidence?: unknown;
  verification?: { status?: unknown } | null;
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

const SENIORITY_RANK: Record<string, number> = { executive: 3, senior: 2, junior: 1 };

/**
 * Pure response mapper, exported for tests. Only an address Hunter itself
 * marks `valid` can become a result; accept_all and unknown are never saved.
 * Picks the most senior valid person, then the highest confidence.
 */
export function parseDomainSearchResponse(body: unknown): FinderResult {
  const data = (body as { data?: { emails?: unknown } } | null)?.data;
  if (!data || !Array.isArray(data.emails)) throw new FinderError('server', 'unexpected Hunter response shape');
  const emails = data.emails as HunterEmail[];

  // Hunter bills a query that returns at least one result, valid or not.
  const creditsCharged = emails.length > 0 ? 1 : 0;
  if (!emails.length) return { status: 'not_found', email: null, personName: null, personTitle: null, creditsCharged };

  const valid = emails
    .filter((e) => e.verification?.status === 'valid' && str(e.value) && (str(e.first_name) || str(e.last_name)))
    .sort((a, b) => {
      const sa = SENIORITY_RANK[String(a.seniority)] ?? 0;
      const sb = SENIORITY_RANK[String(b.seniority)] ?? 0;
      if (sb !== sa) return sb - sa;
      return (typeof b.confidence === 'number' ? b.confidence : 0) - (typeof a.confidence === 'number' ? a.confidence : 0);
    });

  const best = valid[0];
  if (!best) return { status: 'risky', email: null, personName: null, personTitle: null, creditsCharged };
  return {
    status: 'valid',
    email: str(best.value)!.toLowerCase(),
    personName: [str(best.first_name), str(best.last_name)].filter(Boolean).join(' ') || null,
    personTitle: str(best.position),
    creditsCharged,
  };
}

export const hunter: DecisionMakerFinder = {
  name: 'hunter',
  creditsPerLookup: 1,
  supportedCategories: Object.keys(DEPARTMENT) as DecisionCategory[],

  async findDecisionMaker(input: FinderInput, apiKey: string): Promise<FinderResult> {
    const department = DEPARTMENT[input.category];
    if (!department) throw new FinderError('bad_request', `Hunter does not support the ${input.category} role`);
    if (!input.domain && !input.companyName) throw new FinderError('bad_request', 'domain or company name required');

    const params = new URLSearchParams({ department, type: 'personal', required_field: 'full_name', limit: '10' });
    if (input.domain) params.set('domain', input.domain);
    else params.set('company', input.companyName);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      // Key goes in a header, not the URL, so it never lands in request logs.
      res = await fetch(`${ENDPOINT}?${params}`, { headers: { 'X-API-KEY': apiKey }, signal: controller.signal });
    } catch (e) {
      throw new FinderError('timeout', e instanceof Error ? e.message : 'network error');
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) throw new FinderError('auth', 'Hunter rejected the key (401)');
    // Per Hunter's docs: 429 = usage (credit) limit reached, 403 = rate limit.
    if (res.status === 429) throw new FinderError('out_of_credits', 'Hunter usage limit reached for this period');
    if (res.status === 403) throw new FinderError('rate_limit', 'Hunter rate limit');
    if (res.status >= 500) throw new FinderError('server', `Hunter ${res.status}`);
    if (!res.ok) throw new FinderError('bad_request', `Hunter ${res.status}`);

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new FinderError('server', 'Hunter returned non-JSON');
    }
    return parseDomainSearchResponse(json);
  },
};
