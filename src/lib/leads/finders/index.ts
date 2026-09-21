// Buyer Finder orchestrator: find verified decision-maker emails for a lead
// through whichever pay-as-you-go provider the owner has enabled.
//
// Rules this file enforces (see docs/plans/2026-09-15-b2b-buyer-discovery.md):
//   - claim first: credits are reserved atomically (cap + idempotency) BEFORE
//     any paid call; a double-click or retry never pays twice
//   - only provider-verified ("valid") addresses are saved; risky, catch-all
//     and not-found results are recorded in the ledger and dropped
//   - suppressed addresses are never saved
//   - a timeout after send is recorded as UNCERTAIN spend and not retried
//   - this only FINDS emails. It never sends anything.

import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSecret } from '@/lib/secrets';
import { markPrimaryContact } from '../engine';
import { scoreConfidence } from '../mx';
import { anymailFinder } from './anymailfinder';
import { FinderError, type DecisionCategory, type DecisionMakerFinder, type FinderResult, type FinderStatus } from './types';

export { DECISION_CATEGORIES, isDecisionCategory, type DecisionCategory } from './types';

/** Vendor adapters by provider name. Adding a vendor = one file + one line here. */
const ADAPTERS: Record<string, DecisionMakerFinder> = {
  [anymailFinder.name]: anymailFinder,
};

/** Settings -> API keys secret name per provider. */
export const PROVIDER_SECRET: Record<string, string> = {
  anymailfinder: 'ANYMAILFINDER_API_KEY',
};

export const MAX_CATEGORIES_PER_RUN = 3;
const BUCKET_MS = 30 * 24 * 60 * 60 * 1000; // paid lookups are reused for 30 days

/** Thrown when the feature is not switched on / configured (route maps to 409). */
export class BuyerFinderConfigError extends Error {}

/** Idempotency key: same provider + domain + category inside a 30-day bucket = one paid call. */
export function requestKey(provider: string, target: string, category: DecisionCategory, now = Date.now()): string {
  return `${provider}:decision-maker:${target.toLowerCase()}:${category}:${Math.floor(now / BUCKET_MS)}`;
}

export type CategoryOutcome = {
  category: DecisionCategory;
  outcome: 'saved' | 'not_found' | 'risky' | 'blacklisted' | 'already_looked_up' | 'suppressed' | 'stopped' | 'error';
  email?: string;
  personName?: string | null;
  personTitle?: string | null;
  credits: number;
  message?: string;
};

export interface FindBuyersResult {
  provider: string;
  outcomes: CategoryOutcome[];
  creditsCharged: number;
  /** Set when the run halted early (cap, key, balance, timeout...). */
  stopped: string | null;
}

type Reserve =
  | { outcome: 'reserved'; id: string }
  | { outcome: 'duplicate'; prior_status?: string }
  | { outcome: 'cap_exceeded'; used: number; cap: number }
  | { outcome: 'disabled' };

const LEDGER_STATUS: Record<FinderStatus, 'ok' | 'not_found' | 'risky'> = {
  valid: 'ok',
  not_found: 'not_found',
  risky: 'risky',
  blacklisted: 'risky',
};

async function pickProvider(): Promise<{ adapter: DecisionMakerFinder; apiKey: string }> {
  const { data } = await supabaseAdmin
    .from('finder_providers')
    .select('provider')
    .eq('kind', 'finder')
    .eq('enabled', true)
    .order('priority', { ascending: true });
  const names = (data ?? []).map((r) => r.provider as string).filter((n) => ADAPTERS[n]);
  if (!names.length) {
    throw new BuyerFinderConfigError('No email finder is enabled. The owner must enable one and set a monthly credit cap.');
  }
  for (const name of names) {
    const secret = PROVIDER_SECRET[name];
    const apiKey = secret ? await getSecret(secret) : null;
    if (apiKey) return { adapter: ADAPTERS[name], apiKey };
  }
  throw new BuyerFinderConfigError(`Add the API key for ${names[0]} in Settings, API keys.`);
}

async function settle(
  id: string,
  status: 'ok' | 'not_found' | 'risky' | 'error' | 'uncertain' | 'released',
  credits: number | null,
  detail: string | null,
) {
  const { error } = await supabaseAdmin
    .from('provider_usage_events')
    .update({ status, credits_charged: credits, detail, settled_at: new Date().toISOString() })
    .eq('id', id);
  // The paid call already happened; never lose the result over a ledger write.
  if (error) console.error('[buyer-finder] ledger settle failed', id, status, error.message);
}

export async function findDecisionMakersForLead(
  leadId: string,
  categories: DecisionCategory[],
  opts: { maxCredits?: number } = {},
): Promise<FindBuyersResult> {
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, name, domain, status')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) throw new Error('lead not found');
  const target = (lead.domain as string | null) || (lead.name as string);

  const { adapter, apiKey } = await pickProvider();
  const cats = [...new Set(categories)].slice(0, MAX_CATEGORIES_PER_RUN);
  const maxCredits = opts.maxCredits ?? cats.length * adapter.creditsPerLookup;

  const outcomes: CategoryOutcome[] = [];
  let creditsCharged = 0;
  let stopped: string | null = null;
  let saved = 0;

  for (const category of cats) {
    if (creditsCharged + adapter.creditsPerLookup > maxCredits) {
      stopped = 'run credit limit reached';
      outcomes.push({ category, outcome: 'stopped', credits: 0, message: stopped });
      break;
    }

    const { data: reserveRaw, error: reserveErr } = await supabaseAdmin.rpc('reserve_provider_credits', {
      p_provider: adapter.name,
      p_operation: 'decision-maker',
      p_lead_id: leadId,
      p_domain: lead.domain,
      p_request_key: requestKey(adapter.name, target, category),
      p_credits: adapter.creditsPerLookup,
    });
    if (reserveErr) throw new BuyerFinderConfigError(`Spend ledger unavailable (is the buyer finder migration applied?): ${reserveErr.message}`);
    const reserve = reserveRaw as Reserve;

    if (reserve.outcome === 'duplicate') {
      outcomes.push({ category, outcome: 'already_looked_up', credits: 0, message: 'Already looked up in the last 30 days, not charged again.' });
      continue;
    }
    if (reserve.outcome === 'cap_exceeded') {
      stopped = `monthly credit cap reached (${reserve.used}/${reserve.cap})`;
      outcomes.push({ category, outcome: 'stopped', credits: 0, message: stopped });
      break;
    }
    if (reserve.outcome === 'disabled') {
      stopped = 'provider disabled';
      outcomes.push({ category, outcome: 'stopped', credits: 0, message: stopped });
      break;
    }

    let result: FinderResult;
    try {
      result = await adapter.findDecisionMaker({ domain: lead.domain, companyName: lead.name, category }, apiKey);
    } catch (e) {
      const kind = e instanceof FinderError ? e.kind : 'server';
      const msg = e instanceof Error ? e.message : String(e);
      if (kind === 'timeout') {
        // The vendor may have processed and billed it. Keep the key blocked.
        await settle(reserve.id, 'uncertain', null, msg);
        stopped = 'provider timed out; spend for that lookup is uncertain and it will not be retried';
        outcomes.push({ category, outcome: 'error', credits: 0, message: stopped });
        break;
      }
      // Definitive failure before any charge: free the key so a retry can happen.
      await settle(reserve.id, 'released', null, msg);
      outcomes.push({ category, outcome: 'error', credits: 0, message: msg });
      if (kind === 'auth' || kind === 'out_of_credits' || kind === 'rate_limit') {
        stopped = msg;
        break;
      }
      continue;
    }

    const charged = result.status === 'valid' ? result.creditsCharged : 0;
    await settle(reserve.id, LEDGER_STATUS[result.status], charged, result.status === 'blacklisted' ? 'blacklisted' : null);
    creditsCharged += charged;

    if (result.status !== 'valid' || !result.email) {
      outcomes.push({ category, outcome: result.status === 'valid' ? 'not_found' : result.status, credits: charged });
      continue;
    }

    const { data: suppressed } = await supabaseAdmin
      .from('suppressions')
      .select('email')
      .eq('email', result.email)
      .maybeSingle();
    if (suppressed) {
      outcomes.push({ category, outcome: 'suppressed', email: result.email, credits: charged, message: 'Address is on the suppression list; not saved.' });
      continue;
    }

    const { error: saveErr } = await supabaseAdmin.from('lead_contacts').upsert(
      {
        lead_id: leadId,
        email: result.email,
        source: adapter.name,
        source_url: null,
        kind: 'personal',
        role_hint: category,
        // MX passed implicitly (the provider delivered a verified mailbox); the
        // real signal is mailbox_status, kept separate from the MX-only field.
        verify_status: 'mx_ok',
        confidence: scoreConfidence(result.email, 'mx_ok', lead.domain),
        person_name: result.personName,
        person_title: result.personTitle,
        decision_category: category,
        mailbox_status: 'valid',
        mailbox_provider: adapter.name,
        mailbox_checked_at: new Date().toISOString(),
      },
      { onConflict: 'lead_id,email' },
    );
    if (saveErr) {
      outcomes.push({ category, outcome: 'error', email: result.email, credits: charged, message: `Found but not saved: ${saveErr.message}` });
      continue;
    }
    saved++;
    outcomes.push({ category, outcome: 'saved', email: result.email, personName: result.personName, personTitle: result.personTitle, credits: charged });
  }

  if (saved > 0) {
    await markPrimaryContact(leadId);
    // Same promotion the manual "add contact" path does, so the lead can move on to drafting.
    if (['new', 'crawling', 'no_contacts', 'no_website'].includes(lead.status as string)) {
      await supabaseAdmin.from('leads').update({ status: 'ready', updated_at: new Date().toISOString() }).eq('id', leadId);
    }
  }

  return { provider: adapter.name, outcomes, creditsCharged, stopped };
}
