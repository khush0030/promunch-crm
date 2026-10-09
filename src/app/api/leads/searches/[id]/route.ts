import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { parseBody } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

// Stop a running search (the businesses already found stay in its list).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const body = await parseBody<{ action?: string }>(req);
  if (body?.action !== 'stop') return NextResponse.json({ error: 'unknown action' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('lead_searches')
    .update({ status: 'stopped', next_page_token: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['pending', 'running'])
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, stopped: (data?.length ?? 0) > 0 });
}
