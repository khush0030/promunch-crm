// Anymail Finder adapter. Docs: POST /v5.1/find-email/decision-maker takes a
// domain (or company name) plus category names and returns one named person
// with a provider-verified email. Billing is per VALID result only (2 credits);
// risky, blacklisted and not_found are free.

import { FinderError, type DecisionMakerFinder, type FinderInput, type FinderResult, type FinderStatus } from './types';

const ENDPOINT = 'https://api.anymailfinder.com/v5.1/find-email/decision-maker';
const TIMEOUT_MS = 40_000; // vendor recommends a long timeout; typical is 2-5s

const STATUSES: FinderStatus[] = ['valid', 'risky', 'not_found', 'blacklisted'];

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Pure response mapper, exported for tests. Fails closed on unknown shapes. */
export function parseDecisionMakerResponse(body: unknown): FinderResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const status = STATUSES.includes(b.email_status as FinderStatus) ? (b.email_status as FinderStatus) : null;
  if (!status) throw new FinderError('server', 'unrecognised email_status from Anymail Finder');

  // Only a valid result carries a trustworthy address. Anything else is
  // returned without an email so it can never be saved by mistake.
  const email = status === 'valid' ? str(b.valid_email) ?? str(b.email) : null;
  if (status === 'valid' && !email) throw new FinderError('server', 'valid result without an email');

  return {
    status,
    email: email ? email.toLowerCase() : null,
    personName: str(b.person_full_name),
    personTitle: str(b.person_job_title),
    creditsCharged: typeof b.credits_charged === 'number' ? b.credits_charged : status === 'valid' ? 2 : 0,
  };
}

export const anymailFinder: DecisionMakerFinder = {
  name: 'anymailfinder',
  creditsPerLookup: 2,

  async findDecisionMaker(input: FinderInput, apiKey: string): Promise<FinderResult> {
    if (!input.domain && !input.companyName) throw new FinderError('bad_request', 'domain or company name required');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: apiKey },
        body: JSON.stringify({
          decision_maker_category: [input.category],
          ...(input.domain ? { domain: input.domain } : { company_name: input.companyName }),
        }),
        signal: controller.signal,
      });
    } catch (e) {
      // Aborted or dropped after the request may have been accepted: the caller
      // records this as an UNCERTAIN spend rather than retrying blindly.
      throw new FinderError('timeout', e instanceof Error ? e.message : 'network error');
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) throw new FinderError('auth', `Anymail Finder rejected the key (${res.status})`);
    // 402 is the conventional "payment required"; the docs page did not list it, so treated as out of credits.
    if (res.status === 402) throw new FinderError('out_of_credits', 'Anymail Finder credits exhausted');
    if (res.status === 429) throw new FinderError('rate_limit', 'Anymail Finder rate limit');
    if (res.status >= 500) throw new FinderError('server', `Anymail Finder ${res.status}`);
    if (!res.ok) throw new FinderError('bad_request', `Anymail Finder ${res.status}`);

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new FinderError('server', 'Anymail Finder returned non-JSON');
    }
    return parseDecisionMakerResponse(json);
  },
};
