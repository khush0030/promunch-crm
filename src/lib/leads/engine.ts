// Pipeline tick engine — DB-as-queue with per-row compare-and-set claims
// (same "claim before act" principle as wa_confirmation_claims). One tick does a
// bounded amount of work (~90s worst case) so it fits comfortably in a single
// Vercel function invocation; the dashboard "Run pipeline" button and the daily
// cron both call this.

import { supabaseAdmin } from '@/lib/supabase-admin';
import { searchTextPage, websiteToDomain, isSocialDomain } from './places';
import { crawlSite, primaryScore } from './scraper';
import { verifyEmail, scoreConfidence } from './mx';
import { generateDraft, DRAFT_MODEL } from './draft';
import { getKnowledgeBase } from './kb';
import { scoreFit } from './fit';

const STALE_CLAIM_MINUTES = 15;
const MAX_SEARCH_PAGES = 3; // Places caps text search at 60 results
const CRAWL_BATCH = 5;
const DRAFT_BATCH = 5;
const MAX_CRAWL_ATTEMPTS = 2;

export interface TickSummary {
  discovered: number;
  crawled: number;
  contactsFound: number;
  drafted: number;
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
  crawl_attempts: number;
};

const LEAD_COLUMNS =
  'id, name, website, domain, city, category, types, site_snippet, offer, subject_hint, crawl_attempts';

export async function tick(): Promise<TickSummary> {
  const summary: TickSummary = { discovered: 0, crawled: 0, contactsFound: 0, drafted: 0, errors: [] };

  await recoverStaleClaims();
  await discover(summary);
  await crawlBatch(summary);
  await draftBatch(summary);

  return summary;
}

async function recoverStaleClaims() {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
  await supabaseAdmin
    .from('leads')
    .update({ status: 'new', claimed_at: null })
    .eq('status', 'crawling')
    .lt('claimed_at', staleBefore);
  await supabaseAdmin
    .from('leads')
    .update({ status: 'ready', claimed_at: null })
    .eq('status', 'drafting')
    .lt('claimed_at', staleBefore);
}

// ---------------------------------------------------------------- discover --

async function discover(summary: TickSummary) {
  const { data: search } = await supabaseAdmin
    .from('lead_searches')
    .select('*')
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!search) return;

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
          types: p.types ?? [],
          status,
        };
      });

    if (rows.length) {
      const { error } = await supabaseAdmin
        .from('leads')
        .upsert(rows, { onConflict: 'place_id', ignoreDuplicates: true });
      if (error) throw new Error(`lead upsert: ${error.message}`);
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

    summary.discovered = rows.length;
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

async function crawlBatch(summary: TickSummary) {
  const { data: candidates } = await supabaseAdmin
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('status', 'new')
    .not('website', 'is', null)
    .order('created_at', { ascending: true })
    .limit(CRAWL_BATCH);

  const mxCache = new Map<string, boolean>();

  for (const lead of (candidates ?? []) as LeadRow[]) {
    if (!(await claimLead(lead.id, 'new', 'crawling'))) continue;
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
        continue;
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

      // Fit scoring is best-effort — never fail the crawl over it.
      let fit: { score: number; reason: string } | null = null;
      try {
        fit = await scoreFit({
          companyName: lead.name,
          category: lead.category,
          city: lead.city,
          types: lead.types,
          siteSnippet: lead.site_snippet ?? result.snippet,
        });
      } catch (e) {
        summary.errors.push(`fit ${lead.name}: ${e instanceof Error ? e.message : String(e)}`);
      }

      await supabaseAdmin
        .from('leads')
        .update({
          status: usable > 0 ? 'ready' : 'no_contacts',
          claimed_at: null,
          crawl_attempts: lead.crawl_attempts + 1,
          site_snippet: lead.site_snippet ?? result.snippet,
          ...(fit ? { fit_score: fit.score, fit_reason: fit.reason } : {}),
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
// Both used by the dashboard lead actions (Re-score / Enrich), outside the
// queue/claim flow so they work on any lead regardless of its current status.

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

  // Best-effort re-score with the freshest snippet.
  let fit: { score: number; reason: string } | null = null;
  const snippet = l.site_snippet ?? result.snippet;
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

  const promote = (usableTotal ?? 0) > 0 && ['new', 'crawling', 'no_contacts', 'no_website'].includes(l.status as string);
  await supabaseAdmin
    .from('leads')
    .update({
      ...(promote ? { status: 'ready' } : {}),
      site_snippet: snippet,
      crawl_attempts: l.crawl_attempts + 1,
      ...(fit ? { fit_score: fit.score, fit_reason: fit.reason } : {}),
      error: null,
      claimed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId);

  return { contactsFound: contactsFound ?? contactRows.length, newUsable, fit };
}

// ------------------------------------------------------------------- draft --

async function draftBatch(summary: TickSummary) {
  const { data: candidates } = await supabaseAdmin
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('status', 'ready')
    .order('created_at', { ascending: true })
    .limit(DRAFT_BATCH);

  // Fetch the Master KB once for the whole batch (not per draft).
  const knowledgeBase = await getKnowledgeBase();

  for (const lead of (candidates ?? []) as LeadRow[]) {
    if (!(await claimLead(lead.id, 'ready', 'drafting'))) continue;
    try {
      const { data: contact } = await supabaseAdmin
        .from('lead_contacts')
        .select('id, email, role_hint')
        .eq('lead_id', lead.id)
        .eq('is_primary', true)
        .maybeSingle();

      if (!contact) {
        await supabaseAdmin
          .from('leads')
          .update({ status: 'no_contacts', claimed_at: null, updated_at: new Date().toISOString() })
          .eq('id', lead.id);
        continue;
      }

      const { data: suppressed } = await supabaseAdmin
        .from('suppressions')
        .select('email')
        .eq('email', contact.email)
        .maybeSingle();
      if (suppressed) {
        await supabaseAdmin
          .from('leads')
          .update({ status: 'suppressed', claimed_at: null, updated_at: new Date().toISOString() })
          .eq('id', lead.id);
        continue;
      }

      const draft = await generateDraft({
        companyName: lead.name,
        category: lead.category,
        city: lead.city,
        roleHint: contact.role_hint,
        siteSnippet: lead.site_snippet,
        offer: lead.offer,
        subjectHint: lead.subject_hint,
        knowledgeBase,
      });

      const { error } = await supabaseAdmin.from('outreach_drafts').insert({
        lead_id: lead.id,
        contact_id: contact.id,
        subject: draft.subject,
        body_text: draft.body,
        model: DRAFT_MODEL,
        status: 'draft',
      });
      if (error) throw new Error(`draft insert: ${error.message}`);

      await supabaseAdmin
        .from('leads')
        .update({ status: 'drafted', claimed_at: null, updated_at: new Date().toISOString() })
        .eq('id', lead.id);
      summary.drafted++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.errors.push(`draft ${lead.name}: ${msg}`);
      // Put the lead back so the next tick retries drafting.
      await supabaseAdmin
        .from('leads')
        .update({ status: 'ready', claimed_at: null, error: msg, updated_at: new Date().toISOString() })
        .eq('id', lead.id);
    }
  }
}
