import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- fakes (hoisted so vi.mock factories can see them) ----------------------
const h = vi.hoisted(() => {
  const state = {
    providers: [{ provider: 'anymailfinder' }] as { provider: string }[],
    lead: { id: 'lead1', name: 'Acme Pharma', domain: 'acmepharma.in', status: 'no_contacts' } as Record<string, unknown> | null,
    suppressed: false,
    reserve: { outcome: 'reserved', id: 'ev1' } as Record<string, unknown> | { error: string },
    reserveBy: {} as Record<string, Record<string, unknown>>,
    secret: 'key-123' as string | null,
    upserts: [] as Record<string, unknown>[],
    updates: [] as { table: string; patch: Record<string, unknown> }[],
    rpcCalls: [] as Record<string, unknown>[],
  };
  const finder = vi.fn(); // anymailfinder
  const hunterFinder = vi.fn();
  const markPrimary = vi.fn();
  return { state, finder, hunterFinder, markPrimary };
});

vi.mock('@/lib/supabase-admin', () => {
  const from = (table: string) => {
    let mode: 'select' | 'update' = 'select';
    let patch: Record<string, unknown> = {};
    const result = () => {
      if (mode === 'update') {
        h.state.updates.push({ table, patch });
        return { data: null, error: null };
      }
      if (table === 'finder_providers') return { data: h.state.providers, error: null };
      if (table === 'leads') return { data: h.state.lead, error: null };
      if (table === 'suppressions') return { data: h.state.suppressed ? { email: 'x' } : null, error: null };
      return { data: null, error: null };
    };
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      order: () => c,
      update: (p: Record<string, unknown>) => {
        mode = 'update';
        patch = p;
        return c;
      },
      upsert: (row: Record<string, unknown>) => {
        h.state.upserts.push(row);
        return Promise.resolve({ error: null });
      },
      maybeSingle: () => Promise.resolve(result()),
      then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
    };
    return c;
  };
  return {
    supabaseAdmin: {
      from,
      rpc: (_fn: string, args: Record<string, unknown>) => {
        h.state.rpcCalls.push(args);
        const r = h.state.reserveBy[args.p_provider as string] ?? h.state.reserve;
        return Promise.resolve('error' in r ? { data: null, error: { message: r.error } } : { data: r, error: null });
      },
    },
  };
});
vi.mock('@/lib/secrets', () => ({ getSecret: async () => h.state.secret }));
vi.mock('../engine', () => ({ markPrimaryContact: h.markPrimary }));
vi.mock('./anymailfinder', () => ({
  anymailFinder: {
    name: 'anymailfinder',
    creditsPerLookup: 2,
    supportedCategories: ['hr', 'buyer', 'operations', 'ceo'],
    findDecisionMaker: h.finder,
  },
}));
vi.mock('./hunter', () => ({
  hunter: {
    name: 'hunter',
    creditsPerLookup: 1,
    supportedCategories: ['hr', 'buyer', 'admin', 'operations', 'ceo'],
    findDecisionMaker: h.hunterFinder,
  },
}));

import { BuyerFinderConfigError, findDecisionMakersForLead, requestKey } from './index';
import { FinderError } from './types';

// The real adapter, imported separately from the mocked module path.
const real = await vi.importActual<typeof import('./anymailfinder')>('./anymailfinder');
const realHunter = await vi.importActual<typeof import('./hunter')>('./hunter');

beforeEach(() => {
  h.state.providers = [{ provider: 'anymailfinder' }];
  h.state.lead = { id: 'lead1', name: 'Acme Pharma', domain: 'acmepharma.in', status: 'no_contacts' };
  h.state.suppressed = false;
  h.state.reserve = { outcome: 'reserved', id: 'ev1' };
  h.state.reserveBy = {};
  h.state.secret = 'key-123';
  h.state.upserts = [];
  h.state.updates = [];
  h.state.rpcCalls = [];
  h.finder.mockReset();
  h.hunterFinder.mockReset();
  h.markPrimary.mockReset();
});

const validResult = {
  status: 'valid' as const,
  email: 'priya.rao@acmepharma.in',
  personName: 'Priya Rao',
  personTitle: 'Head of HR',
  creditsCharged: 2,
};
const ledger = () => h.state.updates.filter((u) => u.table === 'provider_usage_events').map((u) => u.patch);

describe('requestKey', () => {
  it('is stable inside a 30-day bucket and changes after it', () => {
    const t = Date.UTC(2026, 8, 21);
    expect(requestKey('p', 'Acme.in', 'hr', t)).toBe(requestKey('p', 'acme.in', 'hr', t + 24 * 3600 * 1000));
    expect(requestKey('p', 'acme.in', 'hr', t)).not.toBe(requestKey('p', 'acme.in', 'hr', t + 31 * 24 * 3600 * 1000));
    expect(requestKey('p', 'acme.in', 'hr', t)).not.toBe(requestKey('p', 'acme.in', 'buyer', t));
  });
});

describe('anymailfinder adapter', () => {
  it('maps a valid response and lowercases the email', () => {
    const r = real.parseDecisionMakerResponse({
      email_status: 'valid',
      valid_email: 'Priya.Rao@AcmePharma.in',
      person_full_name: 'Priya Rao',
      person_job_title: 'Head of HR',
      credits_charged: 2,
    });
    expect(r).toMatchObject({ status: 'valid', email: 'priya.rao@acmepharma.in', creditsCharged: 2 });
  });

  it('never returns an email for risky results', () => {
    const r = real.parseDecisionMakerResponse({ email_status: 'risky', email: 'a@b.in', credits_charged: 0 });
    expect(r.email).toBeNull();
    expect(r.creditsCharged).toBe(0);
  });

  it('fails closed on an unknown status or a valid result with no email', () => {
    expect(() => real.parseDecisionMakerResponse({ email_status: 'maybe' })).toThrow(FinderError);
    expect(() => real.parseDecisionMakerResponse({ email_status: 'valid' })).toThrow(FinderError);
    expect(() => real.parseDecisionMakerResponse(null)).toThrow(FinderError);
  });

  describe('http errors', () => {
    afterEach(() => vi.unstubAllGlobals());
    const call = () => real.anymailFinder.findDecisionMaker({ domain: 'a.in', companyName: 'A', category: 'hr' }, 'k');
    const stub = (status: number) => vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));

    it.each([
      [401, 'auth'],
      [402, 'out_of_credits'],
      [429, 'rate_limit'],
      [500, 'server'],
      [400, 'bad_request'],
    ])('status %i -> %s', async (status, kind) => {
      stub(status);
      await expect(call()).rejects.toMatchObject({ kind });
    });

    it('a dropped request is a timeout (uncertain spend)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('aborted'); }));
      await expect(call()).rejects.toMatchObject({ kind: 'timeout' });
    });

    it('sends the key raw in Authorization and the category array', async () => {
      const f = vi.fn(async () => new Response(JSON.stringify({ email_status: 'not_found' }), { status: 200 }));
      vi.stubGlobal('fetch', f);
      await call();
      const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
      expect((init.headers as Record<string, string>).authorization).toBe('k');
      expect(JSON.parse(init.body as string)).toEqual({ decision_maker_category: ['hr'], domain: 'a.in' });
    });
  });
});

describe('findDecisionMakersForLead', () => {
  it('saves a valid decision maker, settles the ledger and promotes the lead', async () => {
    h.finder.mockResolvedValue(validResult);
    const r = await findDecisionMakersForLead('lead1', ['hr']);

    expect(r.creditsCharged).toBe(2);
    expect(r.outcomes[0]).toMatchObject({ category: 'hr', outcome: 'saved', email: 'priya.rao@acmepharma.in' });
    expect(h.state.upserts[0]).toMatchObject({
      lead_id: 'lead1',
      kind: 'personal',
      role_hint: 'hr',
      mailbox_status: 'valid',
      mailbox_provider: 'anymailfinder',
      person_name: 'Priya Rao',
      confidence: 'high',
    });
    expect(ledger()[0]).toMatchObject({ status: 'ok', credits_charged: 2 });
    expect(h.markPrimary).toHaveBeenCalledWith('lead1');
    expect(h.state.updates.some((u) => u.table === 'leads' && u.patch.status === 'ready')).toBe(true);
  });

  it('reserves credits before calling the vendor, keyed for idempotency', async () => {
    let reservedBeforeCall = false;
    h.finder.mockImplementation(async () => {
      reservedBeforeCall = h.state.rpcCalls.length === 1;
      return { ...validResult, status: 'not_found', email: null, creditsCharged: 0 };
    });
    await findDecisionMakersForLead('lead1', ['hr']);
    expect(reservedBeforeCall).toBe(true);
    expect(String(h.state.rpcCalls[0].p_request_key)).toContain('acmepharma.in:hr');
  });

  it('does not call or charge when the lookup was already made (duplicate)', async () => {
    h.state.reserve = { outcome: 'duplicate', prior_status: 'ok' };
    const r = await findDecisionMakersForLead('lead1', ['hr']);
    expect(h.finder).not.toHaveBeenCalled();
    expect(r.outcomes[0].outcome).toBe('already_looked_up');
    expect(r.creditsCharged).toBe(0);
  });

  it('stops without calling when the monthly cap is hit', async () => {
    h.state.reserve = { outcome: 'cap_exceeded', used: 100, cap: 100 };
    const r = await findDecisionMakersForLead('lead1', ['hr', 'buyer']);
    expect(h.finder).not.toHaveBeenCalled();
    expect(r.stopped).toMatch(/cap reached \(100\/100\)/);
    expect(r.outcomes).toHaveLength(1);
  });

  it('honours the per-run credit limit', async () => {
    h.finder.mockResolvedValue(validResult);
    const r = await findDecisionMakersForLead('lead1', ['hr', 'buyer'], { maxCredits: 2 });
    expect(h.finder).toHaveBeenCalledTimes(1);
    expect(r.stopped).toBe('run credit limit reached');
  });

  it('drops risky results: nothing saved, nothing charged', async () => {
    h.finder.mockResolvedValue({ status: 'risky', email: null, personName: null, personTitle: null, creditsCharged: 0 });
    const r = await findDecisionMakersForLead('lead1', ['hr']);
    expect(h.state.upserts).toHaveLength(0);
    expect(r.outcomes[0].outcome).toBe('risky');
    expect(ledger()[0]).toMatchObject({ status: 'risky', credits_charged: 0 });
    expect(h.markPrimary).not.toHaveBeenCalled();
  });

  it('never saves a suppressed address', async () => {
    h.state.suppressed = true;
    h.finder.mockResolvedValue(validResult);
    const r = await findDecisionMakersForLead('lead1', ['hr']);
    expect(h.state.upserts).toHaveLength(0);
    expect(r.outcomes[0].outcome).toBe('suppressed');
  });

  it('marks a timeout as uncertain spend and stops', async () => {
    h.finder.mockRejectedValue(new FinderError('timeout', 'aborted'));
    const r = await findDecisionMakersForLead('lead1', ['hr', 'buyer']);
    expect(ledger()[0]).toMatchObject({ status: 'uncertain', credits_charged: null });
    expect(h.finder).toHaveBeenCalledTimes(1);
    expect(r.stopped).toMatch(/uncertain/);
  });

  it('releases the key and stops on an auth failure', async () => {
    h.finder.mockRejectedValue(new FinderError('auth', 'bad key'));
    const r = await findDecisionMakersForLead('lead1', ['hr', 'buyer']);
    expect(ledger()[0]).toMatchObject({ status: 'released' });
    expect(h.finder).toHaveBeenCalledTimes(1);
    expect(r.stopped).toBe('anymailfinder: bad key');
  });

  it('releases the key but carries on after a one-off server error', async () => {
    h.finder.mockRejectedValueOnce(new FinderError('server', 'boom')).mockResolvedValueOnce(validResult);
    const r = await findDecisionMakersForLead('lead1', ['hr', 'buyer']);
    expect(r.outcomes.map((o) => o.outcome)).toEqual(['error', 'saved']);
  });

  it('refuses to run with no provider enabled or no key set', async () => {
    h.state.providers = [];
    await expect(findDecisionMakersForLead('lead1', ['hr'])).rejects.toBeInstanceOf(BuyerFinderConfigError);
    h.state.providers = [{ provider: 'anymailfinder' }];
    h.state.secret = null;
    await expect(findDecisionMakersForLead('lead1', ['hr'])).rejects.toBeInstanceOf(BuyerFinderConfigError);
    expect(h.finder).not.toHaveBeenCalled();
  });

  it('surfaces a missing migration as a config error, not a silent skip', async () => {
    h.state.reserve = { error: 'function reserve_provider_credits does not exist' };
    await expect(findDecisionMakersForLead('lead1', ['hr'])).rejects.toBeInstanceOf(BuyerFinderConfigError);
    expect(h.finder).not.toHaveBeenCalled();
  });
});

describe('hunter adapter', () => {
  const email = (over: Record<string, unknown>) => ({
    value: 'a@acme.in', first_name: 'A', last_name: 'B', position: 'Manager', seniority: 'junior', confidence: 80,
    verification: { status: 'valid' }, ...over,
  });

  it('picks the most senior valid person, then highest confidence', () => {
    const r = realHunter.parseDomainSearchResponse({ data: { emails: [
      email({ value: 'junior@acme.in', seniority: 'junior', confidence: 99 }),
      email({ value: 'head@acme.in', first_name: 'Priya', last_name: 'Rao', position: 'Head of HR', seniority: 'executive', confidence: 70 }),
      email({ value: 'senior@acme.in', seniority: 'senior', confidence: 95 }),
    ] } });
    expect(r).toMatchObject({ status: 'valid', email: 'head@acme.in', personName: 'Priya Rao', personTitle: 'Head of HR', creditsCharged: 1 });
  });

  it('never saves accept_all or unknown addresses, but reports the credit it cost', () => {
    const r = realHunter.parseDomainSearchResponse({ data: { emails: [
      email({ verification: { status: 'accept_all' } }),
      email({ value: 'b@acme.in', verification: { status: 'unknown' } }),
    ] } });
    expect(r).toMatchObject({ status: 'risky', email: null, creditsCharged: 1 });
  });

  it('skips addresses with no person name (generic mailboxes)', () => {
    const r = realHunter.parseDomainSearchResponse({ data: { emails: [email({ first_name: null, last_name: null })] } });
    expect(r.status).toBe('risky');
  });

  it('an empty result is not_found and free', () => {
    expect(realHunter.parseDomainSearchResponse({ data: { emails: [] } })).toMatchObject({ status: 'not_found', creditsCharged: 0 });
  });

  it('fails closed on an unexpected shape', () => {
    expect(() => realHunter.parseDomainSearchResponse({})).toThrow(FinderError);
    expect(() => realHunter.parseDomainSearchResponse(null)).toThrow(FinderError);
  });

  describe('http', () => {
    afterEach(() => vi.unstubAllGlobals());
    const call = (category: 'hr' | 'buyer' | 'logistics' = 'buyer') =>
      realHunter.hunter.findDecisionMaker({ domain: 'acme.in', companyName: 'Acme', category }, 'hk');

    it('sends the key in a header and maps buyer to the procurement department', async () => {
      const f = vi.fn(async () => new Response(JSON.stringify({ data: { emails: [] } }), { status: 200 }));
      vi.stubGlobal('fetch', f);
      await call('buyer');
      const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).not.toContain('hk');
      expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('hk');
      const q = new URL(url).searchParams;
      expect(q.get('department')).toBe('procurement');
      expect(q.get('domain')).toBe('acme.in');
      expect(q.get('type')).toBe('personal');
    });

    it('refuses an unsupported role before any request is made', async () => {
      const f = vi.fn();
      vi.stubGlobal('fetch', f);
      await expect(call('logistics')).rejects.toMatchObject({ kind: 'bad_request' });
      expect(f).not.toHaveBeenCalled();
    });

    it.each([
      [401, 'auth'],
      [429, 'out_of_credits'],
      [403, 'rate_limit'],
      [500, 'server'],
    ])('status %i -> %s', async (status, kind) => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
      await expect(call('hr')).rejects.toMatchObject({ kind });
    });
  });
});

describe('waterfall (free first, paid only for the gap)', () => {
  const both = () => { h.state.providers = [{ provider: 'hunter' }, { provider: 'anymailfinder' }]; };
  const miss = { status: 'not_found' as const, email: null, personName: null, personTitle: null, creditsCharged: 0 };

  it('does not touch the paid provider when the free one finds a person', async () => {
    both();
    h.hunterFinder.mockResolvedValue({ ...validResult, creditsCharged: 1 });
    const r = await findDecisionMakersForLead('lead1', ['hr']);
    expect(r.outcomes[0]).toMatchObject({ outcome: 'saved', provider: 'hunter' });
    expect(h.finder).not.toHaveBeenCalled();
    expect(r.creditsByProvider).toEqual({ hunter: 1 });
  });

  it('falls through to the paid provider when the free one finds nothing', async () => {
    both();
    h.hunterFinder.mockResolvedValue(miss);
    h.finder.mockResolvedValue(validResult);
    const r = await findDecisionMakersForLead('lead1', ['hr']);
    expect(r.outcomes[0]).toMatchObject({ outcome: 'saved', provider: 'anymailfinder' });
    expect(h.state.upserts[0]).toMatchObject({ mailbox_provider: 'anymailfinder', source: 'anymailfinder' });
  });

  it('falls through when the free provider hit its monthly cap, and says so', async () => {
    both();
    h.state.reserveBy = { hunter: { outcome: 'cap_exceeded', used: 50, cap: 50 } };
    h.finder.mockResolvedValue(validResult);
    const r = await findDecisionMakersForLead('lead1', ['hr', 'buyer']);
    expect(h.hunterFinder).not.toHaveBeenCalled();
    expect(r.outcomes.map((o) => o.outcome)).toEqual(['saved', 'saved']);
    expect(r.stopped).toMatch(/hunter: monthly credit cap reached \(50\/50\)/);
  });

  it('counts a Hunter query that returned only unverified addresses as a spent credit', async () => {
    both();
    h.hunterFinder.mockResolvedValue({ status: 'risky', email: null, personName: null, personTitle: null, creditsCharged: 1 });
    h.finder.mockResolvedValue(miss);
    const r = await findDecisionMakersForLead('lead1', ['hr']);
    expect(ledger()[0]).toMatchObject({ status: 'risky', credits_charged: 1 });
    expect(r.creditsByProvider.hunter).toBe(1);
  });

  it('moves on when the free lookup was already made and missed, but not when it already succeeded', async () => {
    both();
    h.state.reserveBy = { hunter: { outcome: 'duplicate', prior_status: 'not_found' } };
    h.finder.mockResolvedValue(validResult);
    expect((await findDecisionMakersForLead('lead1', ['hr'])).outcomes[0]).toMatchObject({ outcome: 'saved', provider: 'anymailfinder' });

    h.finder.mockClear();
    h.state.reserveBy = { hunter: { outcome: 'duplicate', prior_status: 'ok' } };
    const r = await findDecisionMakersForLead('lead1', ['hr']);
    expect(r.outcomes[0].outcome).toBe('already_looked_up');
    expect(h.finder).not.toHaveBeenCalled();
  });

  it('skips a provider that does not support the role without reserving credits', async () => {
    h.state.providers = [{ provider: 'anymailfinder' }];
    const r = await findDecisionMakersForLead('lead1', ['admin']);
    expect(h.state.rpcCalls).toHaveLength(0);
    expect(h.finder).not.toHaveBeenCalled();
    expect(r.outcomes[0]).toMatchObject({ outcome: 'stopped', message: 'no enabled provider supports this role' });
  });

  it('a hard failure on the free provider does not stop the paid one', async () => {
    both();
    h.hunterFinder.mockRejectedValue(new FinderError('out_of_credits', 'usage limit'));
    h.finder.mockResolvedValue(validResult);
    const r = await findDecisionMakersForLead('lead1', ['hr', 'buyer']);
    expect(h.hunterFinder).toHaveBeenCalledTimes(1); // marked dead after the first failure
    expect(r.outcomes.map((o) => o.outcome)).toEqual(['saved', 'saved']);
  });
});
