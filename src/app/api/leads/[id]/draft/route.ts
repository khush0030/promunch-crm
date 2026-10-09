import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateDraft, DRAFT_MODEL } from '@/lib/leads/draft';
import { getKnowledgeBase } from '@/lib/leads/kb';
import { isMissingSchema } from '@/lib/leads/db';

export const maxDuration = 60;

// "Rewrite" (or write one) for a single business, grounded in the Master KB
// exactly like the batch writer. The pending draft is replaced (keeping its
// batch, so it stays in the same Approve queue). Refused once the business
// was emailed, replied, or was marked not interested: one first email ever.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { contactId?: string };

  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', id).maybeSingle();
  if (!lead) return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  if (!['ready', 'drafted', 'approved'].includes(lead.status)) {
    return NextResponse.json({ error: 'This business cannot get a new email (already emailed, closed, or no email yet).' }, { status: 409 });
  }
  const { data: sentBefore } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id')
    .eq('lead_id', id)
    .in('status', ['sending', 'sent', 'replied', 'bounced'])
    .limit(1);
  if (sentBefore?.length) return NextResponse.json({ error: 'This business was already emailed.' }, { status: 409 });
  const { data: settings } = await supabaseAdmin.from('outreach_settings').select('paused').eq('id', 1).maybeSingle();
  if (settings?.paused) return NextResponse.json({ error: 'Sending is paused in Settings, so new emails are not written.' }, { status: 409 });

  let contactQuery = supabaseAdmin.from('lead_contacts').select('*').eq('lead_id', id);
  contactQuery = body.contactId
    ? contactQuery.eq('id', body.contactId)
    : contactQuery.eq('is_primary', true);
  const { data: contact } = await contactQuery.maybeSingle();
  if (!contact) return NextResponse.json({ error: 'no contact to draft for' }, { status: 400 });

  const { data: suppressed } = await supabaseAdmin
    .from('suppressions')
    .select('email')
    .eq('email', contact.email)
    .maybeSingle();
  if (suppressed) {
    return NextResponse.json({ error: `${contact.email} is suppressed` }, { status: 409 });
  }

  try {
    const draft = await generateDraft({
      companyName: lead.name,
      category: lead.category,
      city: lead.city,
      roleHint: contact.role_hint,
      siteSnippet: lead.site_snippet,
      offer: lead.offer,
      subjectHint: lead.subject_hint,
      products: lead.products,
      enrichment: lead.enrichment,
      knowledgeBase: await getKnowledgeBase(),
    });

    // Replace any still-editable draft for this lead (compare-and-set: a
    // draft the tick already claimed for sending is left alone).
    const { data: replaced } = await supabaseAdmin
      .from('outreach_drafts')
      .update({ status: 'discarded', updated_at: new Date().toISOString() })
      .eq('lead_id', id)
      .is('enrollment_id', null)
      .in('status', ['draft', 'approved', 'failed'])
      .select('*');
    const { data: inFlight } = await supabaseAdmin
      .from('outreach_drafts')
      .select('id')
      .eq('lead_id', id)
      .eq('status', 'sending')
      .limit(1);
    if (inFlight?.length) return NextResponse.json({ error: 'This email is being sent right now.' }, { status: 409 });

    const prevBatch = (replaced ?? []).map((d) => (d as { batch_id?: string | null }).batch_id).find(Boolean) ?? null;
    const row: Record<string, unknown> = {
      lead_id: id,
      contact_id: contact.id,
      subject: draft.subject,
      body_text: draft.body,
      model: DRAFT_MODEL,
      status: 'draft',
    };
    if (prevBatch) row.batch_id = prevBatch;
    let { data: inserted, error } = await supabaseAdmin.from('outreach_drafts').insert(row).select('*').single();
    if (error && isMissingSchema(error)) {
      delete row.batch_id;
      ({ data: inserted, error } = await supabaseAdmin.from('outreach_drafts').insert(row).select('*').single());
    }
    if (error) throw new Error(error.message);

    // A rewritten email goes back to "Waiting for approval".
    await supabaseAdmin
      .from('leads')
      .update({ status: 'drafted', error: null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .in('status', ['ready', 'drafted', 'approved']);

    return NextResponse.json({ ok: true, draft: inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
