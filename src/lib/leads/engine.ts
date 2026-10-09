// Pipeline tick engine: DB-as-queue with per-row compare-and-set claims
// (same "claim before act" principle as wa_confirmation_claims). One tick does
// a bounded amount of work so it fits in one Vercel function invocation
// (maxDuration 300s). pg_cron calls /api/cron/leads-tick every 2 minutes
// (migration 20261010110000), so finding runs on the server: nobody has to
// keep a tab open.
//
// Order per tick: recover stale claims -> discover (round-robin over EVERY
// active search) -> check websites (fair across searches) -> send approved
// first emails (paced, inside the daily cap) -> due follow-ups.
// Nothing here writes emails: AI writing only happens when a person ticks
// businesses and presses "Write emails" (lib/leads/write.ts).

import { supabaseAdmin } from '@/lib/supabase-admin';
import { searchTextPage, websiteToDomain, isSocialDomain } from './places';
import { crawlSite, primaryScore } from './scraper';
import { verifyEmail, scoreConfidence } from './mx';
import { scoreFit } from './fit';
import { enrichCompany, CompanyEnrichment } from './enrich-company';
import { processSequences } from './sequence-engine';
import { mapLimit } from './db';
import { inSendWindow } from './schedule';
import { sendFirstEmail } from './send';

const STALE_CLAIM_MINUTES = 15;
const MAX_SEARCH_PAGES = 3; // Places caps text search at 60 results
const SEARCHES_PER_TICK = 4; // round-robin: up to 4 searches get one page each
const SEARCH_CLAIM_MS = 90_000; // another tick skips a search touched this recently
const CRAWL_BATCH = 12;
const CRAWL_CONCURRENCY = 4;
const MAX_CRAWL_ATTEMPTS = 2;
const SEND_PER_TICK = 2; // pacing: at most 2 first emails per 2-minute tick
// Stop STARTING new work after this; in-flight crawls (<= ~60s) still finish
// well inside the 300s function limit.
const TICK_BUDGET_MS = 120_000;

export interface TickSummary {
  discovered: number;
  crawled: number;
  contactsFound: number;
  sent: number;
  sequenceSent: number;
  errors: string[];
}

type LeadRow = {
  id: string;
  name: string;
  website: string | null;
  domain: string | null;
  city: string | null;
  category: string | null;
  types: string[] | null;
  site_snippet: string | null;
  offer: string | null;
  subject_hint: string | null;
  products: string[] | null;
  enrichment: CompanyEnrichment | null;
  crawl_attempts: number;
};

const LEAD_COLUMNS =
  'id, name, website, domain, city, category, types, site_snippet, offer, subject_hint, products, enrichment, crawl_attempts';

export async function tick(): Promise<TickSummary> {
  const summary: TickSummary = { discovered: 0, crawled: 0, contactsFound: 0, sent: 0, sequenceSent: 0, errors: [] };
  const deadline = Date.now() + TICK_BUDGET_MS;

  await recoverStaleClaims();
  await discover(summary);
  await crawlBatch(summary, deadline);
  await sendApproved(summary);
  await processSequences(summary);

  return summary;
}

async function recoverStaleClaims() {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
  await supabaseAdmin
    .from('leads')
    .update({ status: 'new', claimed_at: null })
    .eq('status', 'crawling')
    .lt('claimed_at', staleBefore);
  // A write request that died mid-way: back to Ready (never auto-redrafted;
  // a person presses "Write emails" again).
  await supabaseAdmin
    .from('leads')
    .update({ status: 'ready', claimed_at: null, error: 'writing was interrupted, try again' })
    .eq('status', 'drafting')
    .lt('claimed_at', staleBefore);
  // Enrollments stuck in 'sending' (tick died mid-send) go back to active;
  // the outreach_drafts row keeps the evidence and the per-step unique index
  // stops a second send of the same step.
  await supabaseAdmin
    .from('sequence_enrollments')
    .update({ status: 'active' })
    .eq('status', 'sending')
    .lt('updated_at', staleBefore);
}

// ---------------------------------------------------------------- discover --

type SearchRow = Record<string, unknown> & { id: string; updated_at: string };

async function discover(summary: TickSummary) {
  // Round-robin: the searches touched longest ago go first, so every active
  // search moves forward each tick instead of only the oldest one.
  const { data: searches } = await supabaseAdmin
    .from('lead_searches')
    .select('*')
    .in('status', ['pending', 'running'])
    .order('updated_at', { ascending: true })
    .limit(SEARCHES_PER_TICK);

  for (const search of (searches ?? []) as SearchRow[]) {
    // Claim: compare-and-set on updated_at, so an overlapping tick skips it.
    if (Date.now() - new Date(search.updated_at).getTime() < SEARCH_CLAIM_MS && search.status === 'running') continue;
    const { data: claimed } = await supabaseAdmin
      .from('lead_searches')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', search.id)
      .eq('updated_at', search.updated_at)
      .in('status', ['pending', 'running'])
      .select('id');
    if (!claimed?.length) continue;
    await discoverOne(search, summary);
  }
}

async function discoverOne(search: SearchRow, summary: TickSummary) {
  try {
    const page = await searchTextPage(
      search.query as string,
      (search.next_page_token as string | null) ?? undefined,
    );

    const findEmails = (search.find_emails as boolean | null) !== false; // default on
    const maxResults = (search.max_results as number | null) ?? null;
    const alreadyHave = search.results_count as number;
    // How many more this search is still allowed to add (null = no target cap).
    const remaining = maxResults != null ? Math.max(0, maxResults - alreadyHave) : Infinity;

    const rows = page.places
      .filter((p) => p.id && p.displayName?.text)
      .slice(0, remaining)
      .map((p) => {
        const domain = websiteToDomain(p.websiteUri);
        const crawlable = !!p.websiteUri && !isSocialDomain(domain);
        // find_emails off => keep the company as a plain listing, never crawled.
        const status = crawlable ? (findEmails ? 'new' : 'listed') : 'no_website';
        return {
          place_id: p.id,
          name: p.displayName!.text!,
          website: p.websiteUri ?? null,
          domain,
          address: p.formattedAddress ?? null,
          city: search.city as string,
          category: search.category as string,
          search_id: search.id as string,
          offer: (search.offer as string | null) ?? null,
          subject_hint: (search.subject_hint as string | null) ?? null,
          products: (search.products as string[] | null) ?? null,
          types: p.types ?? [],
          status,
        };
      });

    if (rows.length) {
      const { error } = await supabaseAdmin
        .from('leads')
        .upsert(rows, { onConflict: 'place_id', ignoreDuplicates: true });
      if (error) throw new Error(`lead upsert: ${error.message}`);

      // Membership: every discovered company joins the search's list — also
      // companies that already existed as leads from an earlier search
      // (upsert ignored them, but this list should still contain them).
      const listId = search.list_id as string | null;
      if (listId) {
        const { data: pageLeads } = await supabaseAdmin
          .from('leads')
          .select('id')
          .in('place_id', rows.map((r) => r.place_id));
        if (pageLeads?.length) {
          await supabaseAdmin
            .from('lead_list_members')
            .upsert(
              pageLeads.map((l) => ({ list_id: listId, lead_id: l.id })),
              { onConflict: 'list_id,lead_id', ignoreDuplicates: true },
            );
        }
      }
    }

    const pagesFetched = (search.pages_fetched as number) + 1;
    const reachedTarget = maxResults != null && alreadyHave + rows.length >= maxResults;
    const done = !page.nextPageToken || pagesFetched >= MAX_SEARCH_PAGES || reachedTarget;
    await supabaseAdmin
      .from('lead_searches')
      .update({
        status: done ? 'done' : 'running',
        next_page_token: done ? null : page.nextPageToken,
        pages_fetched: pagesFetched,
        results_count: (search.results_count as number) + rows.length,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', search.id);

    summary.discovered += rows.length;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    summary.errors.push(`discover "${search.query}": ${msg}`);
    await supabaseAdmin
      .from('lead_searches')
      .update({ status: 'error', error: msg, updated_at: new Date().toISOString() })
      .eq('id', search.id);
  }
}

// ------------------------------------------------------------ crawl+verify --

/** Atomic per-row claim: update succeeds only if the row is still in fromStatus. */
async function claimLead(id: string, fromStatus: string, toStatus: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('leads')
    .update({ status: toStatus, claimed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', fromStatus)
    .select('id');
  return (data?.length ?? 0) > 0;
}

async function crawlBatch(summary: TickSummary, deadline: number) {
  // Cheap scan of the queue (ids only), then fair pick across searches:
  // one business per search in turn, so a big search never starves a small
  // one started after it.
  const { data: queue } = await supabaseAdmin
    .from('leads')
    .select('id, search_id')
    .eq('status', 'new')
    .not('website', 'is', null)
    .order('created_at', { ascending: true })
    .limit(500);
  const bySearch = new Map<string, string[]>();
  for (const l of queue ?? []) {
    const k = (l.search_id as string | null) ?? 'none';
    if (!bySearch.has(k)) bySearch.set(k, []);
    bySearch.get(k)!.push(l.id as string);
  }
  const pickedIds: string[] = [];
  const queues = [...bySearch.values()];
  while (pickedIds.length < CRAWL_BATCH && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) pickedIds.push(next);
      if (pickedIds.length >= CRAWL_BATCH) break;
    }
  }
  if (!pickedIds.length) return;
  const { data: rows } = await supabaseAdmin.from('leads').select(LEAD_COLUMNS).in('id', pickedIds);
  const picked = (rows ?? []) as LeadRow[];

  const mxCache = new Map<string, boolean>();
  await mapLimit(picked, CRAWL_CONCURRENCY, async (lead) => {
    if (Date.now() > deadline) return;
    await crawlOne(lead, summary, mxCache);
  });
}

async function crawlOne(lead: LeadRow, summary: TickSummary, mxCache: Map<string, boolean>) {
  {
    if (!(await claimLead(lead.id, 'new', 'crawling'))) return;
    try {
      const result = await crawlSite(lead.website!);

      if (result.pagesFetched === 0) {
        const attempts = lead.crawl_attempts + 1;
        const giveUp = attempts >= MAX_CRAWL_ATTEMPTS;
        await supabaseAdmin
          .from('leads')
          .update({
            status: giveUp ? 'no_contacts' : 'new',
            claimed_at: null,
            crawl_attempts: attempts,
            error: 'site unreachable',
            updated_at: new Date().toISOString(),
          })
          .eq('id', lead.id);
        return;
      }

      let usable = 0;
      const contactRows = [];
      for (const c of result.contacts) {
        const verifyStatus = await verifyEmail(c.email, mxCache);
        const confidence = scoreConfidence(c.email, verifyStatus, lead.domain);
        if (verifyStatus === 'mx_ok') usable++;
        contactRows.push({
          lead_id: lead.id,
          email: c.email,
          source_url: c.sourceUrl,
          source: c.source,
          kind: c.kind,
          role_hint: c.roleHint,
          verify_status: verifyStatus,
          confidence,
          is_primary: false,
        });
      }

      if (contactRows.length) {
        await supabaseAdmin
          .from('lead_contacts')
          .upsert(contactRows, { onConflict: 'lead_id,email', ignoreDuplicates: true });
        await markPrimaryContact(lead.id);
      }

      const snippet = lead.site_snippet ?? result.snippet;

      // Stage 1 (analysis) + Stage 3 (enrichment) are best-effort — never fail
      // the crawl over them. Both read the freshly-crawled site text.
      let fit: { score: number; reason: string } | null = null;
      try {
        fit = await scoreFit({
          companyName: lead.name,
          category: lead.category,
          city: lead.city,
          types: lead.types,
          siteSnippet: snippet,
        });
      } catch (e) {
        summary.errors.push(`fit ${lead.name}: ${e instanceof Error ? e.message : String(e)}`);
      }

      let enrichment: CompanyEnrichment | null = null;
      try {
        enrichment = await enrichCompany({
          companyName: lead.name,
          category: lead.category,
          city: lead.city,
          types: lead.types,
          siteSnippet: snippet,
        });
      } catch (e) {
        summary.errors.push(`enrich ${lead.name}: ${e instanceof Error ? e.message : String(e)}`);
      }

      await supabaseAdmin
        .from('leads')
        .update({
          status: usable > 0 ? 'ready' : 'no_contacts',
          claimed_at: null,
          crawl_attempts: lead.crawl_attempts + 1,
          site_snippet: snippet,
          ...(fit ? { fit_score: fit.score, fit_reason: fit.reason } : {}),
          ...(enrichment ? { enrichment, enriched_at: new Date().toISOString() } : {}),
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id);

      summary.crawled++;
      summary.contactsFound += contactRows.length;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.errors.push(`crawl ${lead.name}: ${msg}`);
      await supabaseAdmin
        .from('leads')
        .update({ status: 'no_contacts', claimed_at: null, error: msg, updated_at: new Date().toISOString() })
        .eq('id', lead.id);
    }
  }
}

/** Pick the best sendable contact (mx_ok, best role priority) and flag it. */
export async function markPrimaryContact(leadId: string): Promise<void> {
  const { data: contacts } = await supabaseAdmin
    .from('lead_contacts')
    .select('id, email, kind, role_hint, verify_status, confidence')
    .eq('lead_id', leadId);
  if (!contacts?.length) return;

  const sendable = contacts.filter((c) => c.verify_status === 'mx_ok');
  if (!sendable.length) return;
  sendable.sort(
    (a, b) =>
      primaryScore({ kind: b.kind, roleHint: b.role_hint }) -
      primaryScore({ kind: a.kind, roleHint: a.role_hint }),
  );

  await supabaseAdmin.from('lead_contacts').update({ is_primary: false }).eq('lead_id', leadId);
  await supabaseAdmin.from('lead_contacts').update({ is_primary: true }).eq('id', sendable[0].id);
}

// ----------------------------------------------------- on-demand enrichment --
// Used by the dashboard ("Find more emails" on one business), outside the
// queue/claim flow so they work on any lead regardless of its current status
// (including `listed`: saved without email finding).

/** Re-run the AI fit score for a single lead from its existing Places + snippet data. */
export async function rescoreLead(leadId: string): Promise<{ score: number; reason: string }> {
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) throw new Error('lead not found');

  const l = lead as LeadRow;
  const fit = await scoreFit({
    companyName: l.name,
    category: l.category,
    city: l.city,
    types: l.types,
    siteSnippet: l.site_snippet,
  });
  await supabaseAdmin
    .from('leads')
    .update({ fit_score: fit.score, fit_reason: fit.reason, updated_at: new Date().toISOString() })
    .eq('id', leadId);
  return fit;
}

export interface EnrichResult {
  contactsFound: number; // total contacts on the lead after enrich
  newUsable: number; // mx_ok contacts found this pass
  fit: { score: number; reason: string } | null;
}

/** Re-crawl a lead's site to (re)discover + verify contacts, then re-score fit. */
export async function enrichLead(leadId: string): Promise<EnrichResult> {
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select(`${LEAD_COLUMNS}, status`)
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) throw new Error('lead not found');
  const l = lead as LeadRow & { status: string };
  if (!l.website) throw new Error('lead has no website to crawl');

  const result = await crawlSite(l.website);
  const mxCache = new Map<string, boolean>();
  let newUsable = 0;
  const contactRows = [];
  for (const c of result.contacts) {
    const verifyStatus = await verifyEmail(c.email, mxCache);
    const confidence = scoreConfidence(c.email, verifyStatus, l.domain);
    if (verifyStatus === 'mx_ok') newUsable++;
    contactRows.push({
      lead_id: leadId,
      email: c.email,
      source_url: c.sourceUrl,
      source: c.source,
      kind: c.kind,
      role_hint: c.roleHint,
      verify_status: verifyStatus,
      confidence,
      is_primary: false,
    });
  }
  if (contactRows.length) {
    await supabaseAdmin
      .from('lead_contacts')
      .upsert(contactRows, { onConflict: 'lead_id,email', ignoreDuplicates: true });
    await markPrimaryContact(leadId);
  }

  // Best-effort re-score + re-enrich with the freshest snippet.
  const snippet = l.site_snippet ?? result.snippet;
  let fit: { score: number; reason: string } | null = null;
  try {
    fit = await scoreFit({
      companyName: l.name,
      category: l.category,
      city: l.city,
      types: l.types,
      siteSnippet: snippet,
    });
  } catch {
    /* leave fit unchanged */
  }
  let enrichment: CompanyEnrichment | null = null;
  try {
    enrichment = await enrichCompany({
      companyName: l.name,
      category: l.category,
      city: l.city,
      types: l.types,
      siteSnippet: snippet,
    });
  } catch {
    /* leave enrichment unchanged */
  }

  // Promote a stuck lead back into the pipeline if we now have a sendable contact.
  const { count: usableTotal } = await supabaseAdmin
    .from('lead_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', leadId)
    .eq('verify_status', 'mx_ok');
  const { count: contactsFound } = await supabaseAdmin
    .from('lead_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', leadId);

  const promote =
    (usableTotal ?? 0) > 0 && ['new', 'crawling', 'listed', 'no_contacts', 'no_website'].includes(l.status as string);
  await supabaseAdmin
    .from('leads')
    .update({
      ...(promote ? { status: 'ready' } : {}),
      site_snippet: snippet,
      crawl_attempts: l.crawl_attempts + 1,
      ...(fit ? { fit_score: fit.score, fit_reason: fit.reason } : {}),
      ...(enrichment ? { enrichment, enriched_at: new Date().toISOString() } : {}),
      error: null,
      claimed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId);

  return { contactsFound: contactsFound ?? contactRows.length, newUsable, fit };
}

// ------------------------------------------------------------------- send --

/**
 * Send approved first emails, paced: at most SEND_PER_TICK per tick, only in
 * the IST send window, stopping at the daily cap or when paused. Every send
 * goes through sendFirstEmail (the atomic b2b_claim_send claim).
 */
async function sendApproved(summary: TickSummary) {
  const { data: settings } = await supabaseAdmin.from('outreach_settings').select('*').eq('id', 1).maybeSingle();
  if (!settings || settings.paused) return;
  const windowStart = (settings.send_window_start as number | null) ?? 9;
  const windowEnd = (settings.send_window_end as number | null) ?? 18;
  if (!inSendWindow(new Date(), windowStart, windowEnd)) return;

  const { data: queued } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id')
    .eq('status', 'approved')
    .is('enrollment_id', null)
    .order('approved_at', { ascending: true })
    .limit(SEND_PER_TICK);

  for (const d of queued ?? []) {
    const r = await sendFirstEmail(d.id as string, ['approved']);
    if (r.ok) summary.sent++;
    else {
      if (r.outcome === 'cap' || r.outcome === 'paused') return;
      if (r.outcome === 'send_failed' || r.outcome === 'error') summary.errors.push(`send ${d.id}: ${r.message}`);
    }
  }
}

// ---------------------------------------------------------- find more emails --

/**
 * "Find more emails" for a selection: put the businesses that have a website
 * back in the queue (status new, attempts reset) so the server tick re-checks
 * their websites. Returns how many were queued and how many have no website.
 */
export async function queueRecheck(leadIds: string[]): Promise<{ queued: number; noWebsite: number; skipped: number }> {
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, website, domain, status')
    .in('id', leadIds);
  const findable = (leads ?? []).filter((l) => ['listed', 'no_contacts', 'no_website'].includes(l.status as string));
  const crawlable = findable.filter((l) => l.website && !isSocialDomain(l.domain as string | null)).map((l) => l.id as string);
  if (crawlable.length) {
    await supabaseAdmin
      .from('leads')
      .update({ status: 'new', crawl_attempts: 0, claimed_at: null, error: null, updated_at: new Date().toISOString() })
      .in('id', crawlable)
      .in('status', ['listed', 'no_contacts', 'no_website']);
  }
  return {
    queued: crawlable.length,
    noWebsite: findable.length - crawlable.length,
    skipped: (leads ?? []).length - findable.length,
  };
}
