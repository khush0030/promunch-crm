import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateDraft, DRAFT_MODEL } from '@/lib/leads/draft';

export const maxDuration = 60;

// Generate (or regenerate) the outreach draft for a lead. Existing pending
// draft is replaced; sent/replied drafts are left untouched.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { contactId?: string };

  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', id).maybeSingle();
  if (!lead) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

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
    });

    // Replace any still-editable draft for this lead.
    await supabaseAdmin
      .from('outreach_drafts')
      .update({ status: 'discarded', updated_at: new Date().toISOString() })
      .eq('lead_id', id)
      .in('status', ['draft', 'approved', 'failed']);

    const { data: inserted, error } = await supabaseAdmin
      .from('outreach_drafts')
      .insert({
        lead_id: id,
        contact_id: contact.id,
        subject: draft.subject,
        body_text: draft.body,
        model: DRAFT_MODEL,
        status: 'draft',
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    if (['ready', 'no_contacts'].includes(lead.status)) {
      await supabaseAdmin
        .from('leads')
        .update({ status: 'drafted', updated_at: new Date().toISOString() })
        .eq('id', id);
    }

    return NextResponse.json({ ok: true, draft: inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
