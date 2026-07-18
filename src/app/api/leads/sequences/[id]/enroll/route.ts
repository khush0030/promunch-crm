import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { nextSendAt } from '@/lib/leads/schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Enroll a list's eligible members into a sequence. Eligible = has a primary
// mx_ok contact, not suppressed, not already enrolled in this sequence, and
// the lead has not already replied/bounced/been suppressed. An optional
// lead_ids array (campaign wizard selection) restricts enrolment to that
// subset of the list.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id: sequenceId } = await params;

  const body = (await req.json().catch(() => null)) as
    | { list_id?: string; lead_ids?: string[] }
    | null;
  const listId = body?.list_id;
  if (!listId) return NextResponse.json({ error: 'list_id is required' }, { status: 400 });
  const onlyLeadIds = Array.isArray(body?.lead_ids)
    ? new Set(body.lead_ids.map(String).slice(0, 2000))
    : null;

  const [{ data: sequence }, { data: settings }, { data: members }, { data: existing }] = await Promise.all([
    supabaseAdmin.from('email_sequences').select('id, status').eq('id', sequenceId).maybeSingle(),
    supabaseAdmin.from('outreach_settings').select('send_window_start, send_window_end').eq('id', 1).maybeSingle(),
    supabaseAdmin
      .from('lead_list_members')
      .select('lead_id, leads(id, status, name), lead_id')
      .eq('list_id', listId)
      .limit(2000),
    supabaseAdmin.from('sequence_enrollments').select('lead_id').eq('sequence_id', sequenceId),
  ]);
  if (!sequence) return NextResponse.json({ error: 'sequence not found' }, { status: 404 });

  const already = new Set((existing ?? []).map((e) => e.lead_id));
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => (skipped[reason] = (skipped[reason] ?? 0) + 1);

  const candidates: { leadId: string }[] = [];
  for (const m of members ?? []) {
    const lead = m.leads as unknown as { id: string; status: string } | null;
    if (!lead) continue;
    if (onlyLeadIds && !onlyLeadIds.has(lead.id)) continue; // not selected — not a "skip"
    if (already.has(lead.id)) { skip('already enrolled'); continue; }
    if (lead.status === 'replied') { skip('already replied'); continue; }
    if (lead.status === 'bounced') { skip('bounced earlier'); continue; }
    if (lead.status === 'suppressed') { skip('suppressed'); continue; }
    candidates.push({ leadId: lead.id });
  }

  // Primary mx_ok contact per candidate lead, minus suppressed addresses.
  const leadIds = candidates.map((c) => c.leadId);
  const { data: contacts } = leadIds.length
    ? await supabaseAdmin
        .from('lead_contacts')
        .select('id, lead_id, email')
        .in('lead_id', leadIds)
        .eq('is_primary', true)
        .eq('verify_status', 'mx_ok')
    : { data: [] };
  const contactByLead = new Map((contacts ?? []).map((c) => [c.lead_id, c]));

  const emails = (contacts ?? []).map((c) => c.email);
  const { data: suppressions } = emails.length
    ? await supabaseAdmin.from('suppressions').select('email').in('email', emails)
    : { data: [] };
  const suppressedEmails = new Set((suppressions ?? []).map((s) => s.email));

  const now = new Date();
  const firstSend = nextSendAt(
    now,
    0,
    (settings?.send_window_start as number | null) ?? 9,
    (settings?.send_window_end as number | null) ?? 18,
  );

  const rows = [];
  for (const c of candidates) {
    const contact = contactByLead.get(c.leadId);
    if (!contact) { skip('no verified email'); continue; }
    if (suppressedEmails.has(contact.email)) { skip('suppressed'); continue; }
    rows.push({
      sequence_id: sequenceId,
      lead_id: c.leadId,
      contact_id: contact.id,
      list_id: listId,
      status: 'active',
      current_step: 0,
      next_send_at: firstSend.toISOString(),
    });
  }

  if (rows.length) {
    const { error } = await supabaseAdmin
      .from('sequence_enrollments')
      .upsert(rows, { onConflict: 'sequence_id,lead_id', ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enrolling implies the user wants it running.
  if (sequence.status === 'draft') {
    await supabaseAdmin.from('email_sequences').update({ status: 'active' }).eq('id', sequenceId);
  }

  return NextResponse.json({ ok: true, enrolled: rows.length, skipped, first_send_at: firstSend.toISOString() });
}
