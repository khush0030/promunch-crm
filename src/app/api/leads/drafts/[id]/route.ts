import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Edit a draft's copy, or move it through manual transitions
// (discard, mark replied after a reply lands in the outreach inbox).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as
    | { subject?: string; body_text?: string; status?: 'discarded' | 'replied' }
    | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const { data: draft } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id, lead_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!draft) return NextResponse.json({ error: 'draft not found' }, { status: 404 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.subject !== undefined || body.body_text !== undefined) {
    if (!['draft', 'approved', 'failed'].includes(draft.status)) {
      return NextResponse.json({ error: `cannot edit a ${draft.status} draft` }, { status: 409 });
    }
    if (body.subject !== undefined) updates.subject = body.subject.trim();
    if (body.body_text !== undefined) updates.body_text = body.body_text.trim();
    updates.edited = true;
    if (draft.status === 'failed') updates.status = 'draft';
  }

  if (body.status === 'discarded') {
    if (!['draft', 'approved', 'failed'].includes(draft.status)) {
      return NextResponse.json({ error: `cannot discard a ${draft.status} draft` }, { status: 409 });
    }
    updates.status = 'discarded';
  } else if (body.status === 'replied') {
    if (draft.status !== 'sent') {
      return NextResponse.json({ error: 'only sent drafts can be marked replied' }, { status: 409 });
    }
    updates.status = 'replied';
  }

  const { data: updated, error } = await supabaseAdmin
    .from('outreach_drafts')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (body.status === 'replied') {
    await supabaseAdmin
      .from('leads')
      .update({ status: 'replied', updated_at: new Date().toISOString() })
      .eq('id', draft.lead_id);
  } else if (body.status === 'discarded') {
    await supabaseAdmin
      .from('leads')
      .update({ status: 'ready', updated_at: new Date().toISOString() })
      .eq('id', draft.lead_id)
      .eq('status', 'drafted');
  }

  return NextResponse.json({ ok: true, draft: updated });
}
