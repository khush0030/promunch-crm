import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Manually suppress a lead: all its contact emails go on the do-not-contact
// list and the lead leaves the pipeline.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const { data: contacts } = await supabaseAdmin
    .from('lead_contacts')
    .select('email')
    .eq('lead_id', id);

  if (contacts?.length) {
    await supabaseAdmin.from('suppressions').upsert(
      contacts.map((c) => ({ email: c.email, reason: 'manual' })),
      { onConflict: 'email', ignoreDuplicates: true },
    );
  }

  await supabaseAdmin
    .from('outreach_drafts')
    .update({ status: 'discarded', updated_at: new Date().toISOString() })
    .eq('lead_id', id)
    .in('status', ['draft', 'approved', 'failed']);

  const { error } = await supabaseAdmin
    .from('leads')
    .update({ status: 'suppressed', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, suppressed: contacts?.length ?? 0 });
}
