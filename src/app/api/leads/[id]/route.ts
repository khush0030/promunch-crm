import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// One business with its emails, contacts, replies and follow-up plan (the
// business drawer).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const [{ data: lead, error }, { data: enrollments }] = await Promise.all([
    supabaseAdmin
      .from('leads')
      .select('*, lead_contacts(*), outreach_drafts(*), outreach_replies(*)')
      .eq('id', id)
      .maybeSingle(),
    supabaseAdmin
      .from('sequence_enrollments')
      .select('status, current_step, next_send_at')
      .eq('lead_id', id)
      .in('status', ['active', 'sending'])
      .limit(1),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ lead, followUp: enrollments?.[0] ?? null });
}
