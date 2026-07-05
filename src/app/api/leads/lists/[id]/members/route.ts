import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as { lead_ids?: string[] } | null;
  const leadIds = (body?.lead_ids ?? []).filter(Boolean).slice(0, 1000);
  if (!leadIds.length) return NextResponse.json({ error: 'lead_ids is required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('lead_list_members')
    .upsert(
      leadIds.map((lead_id) => ({ list_id: id, lead_id })),
      { onConflict: 'list_id,lead_id', ignoreDuplicates: true },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, added: leadIds.length });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as { lead_ids?: string[] } | null;
  const leadIds = (body?.lead_ids ?? []).filter(Boolean);
  if (!leadIds.length) return NextResponse.json({ error: 'lead_ids is required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('lead_list_members')
    .delete()
    .eq('list_id', id)
    .in('lead_id', leadIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, removed: leadIds.length });
}
