// "Write emails for N": the ONLY way a first email gets written. Runs for the
// businesses a person ticked, never automatically. Each lead is claimed
// (ready -> drafting) so a double click or two people writing the same list
// can never produce two drafts; the partial unique index
// outreach_drafts_one_first_email is the database backstop.
//
// AI drafts are grounded in the Master KB (fetched once per batch). A saved
// email can be used instead of AI.

import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateDraft, DRAFT_MODEL } from './draft';
import { getKnowledgeBase } from './kb';
import { renderTemplate } from './templates';
import { isMissingSchema, mapLimit } from './db';
import { createFollowUpSequence } from './send';
import type { CompanyEnrichment } from './enrich-company';

export const MAX_WRITE_BATCH = 60;
const WRITE_CONCURRENCY = 4;
const AI_TRIES = 2; // one retry per business, then it goes back to Ready with the reason

export interface WriteOptions {
  listId?: string | null;
  templateId?: string | null;
  followUpCount?: number;
  followUpDays?: number;
  createdBy?: string | null;
}

export interface WriteResult {
  batchId: string | null;
  written: number;
  skipped: number;
  failed: number;
  reasons: Record<string, number>;
  followUps: 'on' | 'off' | 'unavailable';
}

type LeadRow = {
  id: string;
  name: string;
  city: string | null;
  category: string | null;
  site_snippet: string | null;
  offer: string | null;
  subject_hint: string | null;
  products: string[] | null;
  enrichment: CompanyEnrichment | null;
};

export async function writeEmails(leadIds: string[], opts: WriteOptions = {}): Promise<WriteResult> {
  const ids = [...new Set(leadIds)].slice(0, MAX_WRITE_BATCH);
  const reasons: Record<string, number> = {};
  const note = (r: string) => (reasons[r] = (reasons[r] ?? 0) + 1);
  const result: WriteResult = { batchId: null, written: 0, skipped: 0, failed: 0, reasons, followUps: 'off' };

  const { data: settings } = await supabaseAdmin.from('outreach_settings').select('paused').eq('id', 1).maybeSingle();
  if (settings?.paused) throw new Error('Sending is paused in Settings, so new emails are not written. Turn sending back on first.');

  let template: { subject: string; body_text: string } | null = null;
  if (opts.templateId) {
    const { data } = await supabaseAdmin.from('email_templates').select('subject, body_text').eq('id', opts.templateId).maybeSingle();
    if (!data) throw new Error('That saved email no longer exists.');
    template = data as { subject: string; body_text: string };
  }

  // A business in an older follow-up plan must not also get a first email here.
  const { data: enrolled } = await supabaseAdmin
    .from('sequence_enrollments')
    .select('lead_id')
    .in('lead_id', ids)
    .in('status', ['active', 'sending']);
  const inOldPlan = new Set((enrolled ?? []).map((e) => e.lead_id as string));

  // Batch row (degrades to no batch before the migration).
  const followUpCount = Math.max(0, Math.min(2, Math.floor(opts.followUpCount ?? 0)));
  const followUpDays = Math.max(1, Math.min(30, Math.floor(opts.followUpDays ?? 4)));
  const { data: batch, error: batchErr } = await supabaseAdmin
    .from('outreach_batches')
    .insert({
      list_id: opts.listId ?? null,
      source: template ? 'saved' : 'ai',
      template_id: opts.templateId ?? null,
      follow_up_count: followUpCount,
      follow_up_days: followUpDays,
      lead_count: ids.length,
      created_by: opts.createdBy ?? null,
    })
    .select('id')
    .single();
  if (batchErr && !isMissingSchema(batchErr)) throw new Error(`batch: ${batchErr.message}`);
  const batchId = (batch?.id as string | undefined) ?? null;
  result.batchId = batchId;
  if (followUpCount > 0) {
    if (!batchId) result.followUps = 'unavailable';
    else {
      const seq = await createFollowUpSequence(batchId, followUpCount, followUpDays);
      result.followUps = seq ? 'on' : 'unavailable';
    }
  }

  // Claim: ready -> drafting, only for the ticked leads still Ready.
  const eligible = ids.filter((id) => !inOldPlan.has(id));
  for (let i = 0; i < ids.length - eligible.length; i++) note('already in an older follow-up plan');
  const { data: claimedRows } = eligible.length
    ? await supabaseAdmin
        .from('leads')
        .update({ status: 'drafting', claimed_at: new Date().toISOString(), error: null })
        .in('id', eligible)
        .eq('status', 'ready')
        .select('id, name, city, category, site_snippet, offer, subject_hint, products, enrichment')
    : { data: [] };
  const claimed = (claimedRows ?? []) as LeadRow[];
  const notReady = eligible.length - claimed.length;
  for (let i = 0; i < notReady; i++) note('not ready (already written, sent or no email)');
  result.skipped = ids.length - claimed.length;

  const knowledgeBase = template ? '' : await getKnowledgeBase();

  await mapLimit(claimed, WRITE_CONCURRENCY, async (lead) => {
    const outcome = await writeOne(lead, { template, knowledgeBase, batchId });
    if (outcome === 'written') result.written++;
    else if (outcome === 'failed') result.failed++;
    else {
      result.skipped++;
      note(outcome);
    }
  });
  if (result.failed) note(`${result.failed} could not be written, try again`);

  if (batchId) await supabaseAdmin.from('outreach_batches').update({ lead_count: result.written }).eq('id', batchId);
  return result;
}

type OneOutcome = 'written' | 'failed' | 'no email' | 'asked not to be emailed' | 'already emailed' | 'already has an email waiting';

async function writeOne(
  lead: LeadRow,
  ctx: { template: { subject: string; body_text: string } | null; knowledgeBase: string; batchId: string | null },
): Promise<OneOutcome> {
  const release = async (status: string, error: string | null = null) => {
    await supabaseAdmin
      .from('leads')
      .update({ status, claimed_at: null, error, updated_at: new Date().toISOString() })
      .eq('id', lead.id)
      .eq('status', 'drafting');
  };

  const { data: contact } = await supabaseAdmin
    .from('lead_contacts')
    .select('id, email, role_hint, person_name')
    .eq('lead_id', lead.id)
    .eq('is_primary', true)
    .maybeSingle();
  if (!contact) {
    await release('no_contacts');
    return 'no email';
  }
  const { data: suppressed } = await supabaseAdmin.from('suppressions').select('email').eq('email', contact.email).maybeSingle();
  if (suppressed) {
    await release('suppressed');
    return 'asked not to be emailed';
  }
  const { data: prior } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id')
    .eq('lead_id', lead.id)
    .is('enrollment_id', null)
    .in('status', ['sending', 'sent', 'replied', 'bounced'])
    .limit(1);
  if (prior?.length) {
    await release('contacted');
    return 'already emailed';
  }

  let subject = '';
  let body = '';
  let model = DRAFT_MODEL;
  let lastError = '';
  if (ctx.template) {
    const vars = { name: contact.person_name ?? null, company: lead.name, city: lead.city, category: lead.category };
    subject = renderTemplate(ctx.template.subject, vars);
    body = renderTemplate(ctx.template.body_text, vars);
    model = 'template';
  } else {
    for (let attempt = 1; attempt <= AI_TRIES && !body; attempt++) {
      try {
        const d = await generateDraft({
          companyName: lead.name,
          category: lead.category,
          city: lead.city,
          roleHint: contact.role_hint,
          siteSnippet: lead.site_snippet,
          offer: lead.offer,
          subjectHint: lead.subject_hint,
          products: lead.products,
          enrichment: lead.enrichment,
          knowledgeBase: ctx.knowledgeBase,
        });
        subject = d.subject;
        body = d.body;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    if (!body) {
      await release('ready', `writing failed: ${lastError.slice(0, 200)}`);
      return 'failed';
    }
  }

  const row: Record<string, unknown> = {
    lead_id: lead.id,
    contact_id: contact.id,
    subject,
    body_text: body,
    model,
    status: 'draft',
  };
  if (ctx.batchId) row.batch_id = ctx.batchId;
  const { error } = await supabaseAdmin.from('outreach_drafts').insert(row);
  if (error) {
    // 23505 = the one-first-email index refused a second live draft.
    if (error.code === '23505') {
      await release('drafted');
      return 'already has an email waiting';
    }
    await release('ready', `could not save: ${error.message.slice(0, 200)}`);
    return 'failed';
  }
  await release('drafted');
  return 'written';
}
