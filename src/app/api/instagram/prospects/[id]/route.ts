import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const STATUSES = ['new', 'shortlisted', 'contacted', 'in_convo', 'rejected'];

// Move a prospect through the discovery pipeline (shortlist / reject / mark
// contacted after a manual DM) or refresh its reel views.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.status === 'string' && STATUSES.includes(body.status)) {
    patch.status = body.status;
    if (body.status === 'contacted') {
      patch.contacted_at = new Date().toISOString();
      patch.contacted_via = body.contacted_via === 'email' || body.contacted_via === 'whatsapp' ? body.contacted_via : 'ig_manual';
    }
  }
  if (typeof body.phone === 'string') patch.phone = body.phone.trim() || null;
  if (typeof body.pitch_dm === 'string' && body.pitch_dm.trim()) patch.pitch_dm = body.pitch_dm.trim();

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.from('ig_prospects').update(patch).eq('id', id).select('*').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'prospect not found' }, { status: 404 });

  // record a manual-DM contact in the outreach log so there's an audit trail
  if (patch.status === 'contacted' && patch.contacted_via === 'ig_manual') {
    await supabaseAdmin.from('ig_outreach_log').insert({
      prospect_id: id,
      channel: 'ig_manual',
      body: data.pitch_dm ?? null,
    });
  }

  return NextResponse.json({ prospect: data });
}
