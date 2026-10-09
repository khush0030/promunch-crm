import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/rbac-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// TEST ONLY, admin only: injects a clearly-labelled fake reply for a lead to
// exercise the Replies flow without a real inbound email. Not shown in the
// dashboard (removed from the business drawer); call it by hand when testing.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, name, lead_contacts(id, email, is_primary)')
    .eq('id', id)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  const contacts = (lead.lead_contacts ?? []) as { id: string; email: string; is_primary: boolean }[];
  const contact = contacts.find((c) => c.is_primary) ?? contacts[0];
  if (!contact) return NextResponse.json({ error: 'lead has no contact to reply from' }, { status: 400 });

  const { data: draft } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id')
    .eq('lead_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error: insErr } = await supabaseAdmin.from('outreach_replies').insert({
    lead_id: id,
    draft_id: draft?.id ?? null,
    contact_id: contact.id,
    from_email: contact.email,
    from_name: 'Test reply (simulated)',
    subject: 'Re: (simulated test reply)',
    body_text:
      'This is a simulated reply so you can see how a real one appears here. ' +
      'Delete it from the Replies tab anytime. When Resend inbound is wired, real replies land here automatically.',
    resend_inbound_id: `sim-${id}-${Date.now()}`,
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  if (draft?.id) {
    await supabaseAdmin
      .from('outreach_drafts')
      .update({ status: 'replied', updated_at: new Date().toISOString() })
      .eq('id', draft.id);
  }
  await supabaseAdmin
    .from('leads')
    .update({ status: 'replied', updated_at: new Date().toISOString() })
    .eq('id', id);
  await supabaseAdmin.from('outreach_events').insert({
    draft_id: draft?.id ?? null,
    lead_id: id,
    type: 'replied',
    payload: { simulated: true, from: contact.email },
  });

  return NextResponse.json({ ok: true });
}
