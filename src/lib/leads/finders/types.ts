// Provider-agnostic contract for paid "find the decision maker's email" vendors.
// One adapter per vendor; the orchestrator (./index.ts) never imports a vendor
// directly, so swapping to a different pay-as-you-go service is one new file.

/** Buyer roles we can ask a provider for. Values match Anymail Finder's categories. */
export const DECISION_CATEGORIES = [
  'hr',
  'buyer',
  'operations',
  'ceo',
  'finance',
  'logistics',
  'marketing',
  'sales',
  'it',
  'engineering',
] as const;
export type DecisionCategory = (typeof DECISION_CATEGORIES)[number];

export function isDecisionCategory(v: unknown): v is DecisionCategory {
  return typeof v === 'string' && (DECISION_CATEGORIES as readonly string[]).includes(v);
}

export interface FinderInput {
  domain: string | null;
  companyName: string;
  category: DecisionCategory;
}

/**
 * valid       = provider verified the mailbox (the only status we save)
 * risky       = catch-all / unconfirmed; providers do not charge for it
 * not_found   = no person or address found
 * blacklisted = provider flagged the address as do-not-mail
 */
export type FinderStatus = 'valid' | 'risky' | 'not_found' | 'blacklisted';

export interface FinderResult {
  status: FinderStatus;
  email: string | null;
  personName: string | null;
  personTitle: string | null;
  /** Credits the provider says it charged for this call. */
  creditsCharged: number;
}

export type FinderErrorKind =
  | 'auth' // bad/missing key: pause the provider, not the contact
  | 'out_of_credits' // vendor balance exhausted
  | 'rate_limit'
  | 'bad_request'
  | 'server'
  | 'timeout'; // request may still have been billed: cost is UNCERTAIN

export class FinderError extends Error {
  constructor(
    public kind: FinderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'FinderError';
  }
}

export interface DecisionMakerFinder {
  /** Matches finder_providers.provider and the usage ledger. */
  readonly name: string;
  /** Worst-case credits one lookup can charge; reserved before the call. */
  readonly creditsPerLookup: number;
  findDecisionMaker(input: FinderInput, apiKey: string): Promise<FinderResult>;
}
