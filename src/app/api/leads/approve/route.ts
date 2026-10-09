import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { parseBody } from '@/lib/api-helpers';
import { isMissingSchema } from '@/lib/leads/db';

export const dynamic = 'force-dynamic';

// The Approve queue.
//   GET  ?batch=<id>  first emails waiting for approval (best fit first),
//                     optionally only one batch; plus the batch list.
//   POST {draft_ids}  approve: draft -> approved, lead -> approved. The server
//                     tick then sends them paced inside the daily cap through
//                     the one atomic send claim. Nothing sends from here.
export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const batch = new URL(req.url).searchParams.get('batch') || '';

  const select =
    'id, lead_id, contact_id, subject, body_text, status, edited, error, created_at, batch_id, ' +
    'leads(id, name, website, domain, city, category, status, fit_score, fit_reason, enrichment, products), ' +
    'lead_contacts(id, email, person_name, person_title, verify_status, mailbox_status, role_hint)';
  let q = supabaseAdmin
    .from('outreach_drafts')
    .select(select)
    .in('status', ['draft', 'failed'])
    .is('enrollment_id', null)
    .order('created_at', { ascending: true })
    .limit(800);
  if (batch) q = q.eq('batch_id', batch);
  let { data, error } = await q;
  if (error && isMissingSchema(error)) {
    // Before migration 20261010110000: no batch_id column.
    ({ data, error } = await supabaseAdmin
      .from('outreach_drafts')
      .select(select.replace(', batch_id', ''))
      .in('status', ['draft', 'failed'])
      .is('enrollment_id', null)
      .order('created_at', { ascending: true })
      .limit(800));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { leads: { fit_score: number | null; status: string } | null };
  const rows = ((data ?? []) as unknown as Row[])
    // Only businesses still waiting (a closed lead's stray draft is not shown).
    .filter((r) => r.leads && ['drafted', 'approved'].includes(r.leads.status))
    .sort((a, b) => (b.leads?.fit_score ?? -1) - (a.leads?.fit_score ?? -1));

  const { data: batches } = await supabaseAdmin
    .from('outreach_batches')
    .select('id, created_at, lead_count, follow_up_count, follow_up_days, source, list_id, lead_lists(name)')
    .order('created_at', { ascending: false })
    .limit(20);

  return NextResponse.json({ drafts: rows, batches: batches ?? [] });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = await parseBody<{ draft_ids?: unknown }>(req);
  const ids = Array.isArray(body?.draft_ids) ? body.draft_ids.map(String).filter(Boolean).slice(0, 800) : [];
  if (!ids.length) return NextResponse.json({ error: 'nothing to approve' }, { status: 400 });

  const { data: settings } = await supabaseAdmin.from('outreach_settings').select('paused').eq('id', 1).maybeSingle();
  if (settings?.paused) {
    return NextResponse.json({ error: 'Sending is paused in Settings. Turn it back on to approve emails.' }, { status: 409 });
  }

  // Compare-and-set: only drafts still waiting move to approved.
  const now = new Date().toISOString();
  const { data: approved, error } = await supabaseAdmin
    .from('outreach_drafts')
    .update({ status: 'approved', approved_at: now, error: null, updated_at: now })
    .in('id', ids)
    .in('status', ['draft', 'failed'])
    .is('enrollment_id', null)
    .select('id, lead_id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const leadIds = (approved ?? []).map((d) => d.lead_id as string);
  if (leadIds.length) {
    await supabaseAdmin
      .from('leads')
      .update({ status: 'approved', error: null, updated_at: now })
      .in('id', leadIds)
      .eq('status', 'drafted');
  }
  return NextResponse.json({ ok: true, approved: leadIds.length, skipped: ids.length - leadIds.length });
}
