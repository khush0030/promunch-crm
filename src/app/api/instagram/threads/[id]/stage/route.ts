import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const STAGES = ['new', 'in_convo', 'terms_sent', 'agreed', 'shipped', 'posted', 'declined'];
const CLASSES = ['collab', 'order', 'spam', 'unknown'];

// Move a thread along the collab pipeline, reassign, take over / hand back, or
// resolve its ticket.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.collab_stage === 'string' && STAGES.includes(body.collab_stage)) patch.collab_stage = body.collab_stage;
  if (typeof body.classification === 'string' && CLASSES.includes(body.classification)) patch.classification = body.classification;
  if (body.status === 'bot' || body.status === 'human') patch.status = body.status;
  if (typeof body.assigned_to === 'string') patch.assigned_to = body.assigned_to || null;
  if (body.resolve_ticket === true) {
    patch.ticket_status = 'resolved';
    patch.escalation_reason = null;
  }
  if (body.archived === true) patch.archived_at = new Date().toISOString();
  if (body.archived === false) patch.archived_at = null;

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.from('ig_threads').update(patch).eq('id', id).select('*').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ thread: data });
}
