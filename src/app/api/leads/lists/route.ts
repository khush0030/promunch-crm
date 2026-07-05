import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// Lists index: every list with the counts the card grid shows.
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const [{ data: lists, error }, { data: members }, { data: enrollments }] = await Promise.all([
    supabaseAdmin
      .from('lead_lists')
      .select('id, name, description, source_search_id, archived, created_at, updated_at')
      .eq('archived', false)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('lead_list_members')
      .select('list_id, lead_id, leads(status)')
      .limit(20000),
    supabaseAdmin
      .from('sequence_enrollments')
      .select('list_id, status, email_sequences(name)')
      .limit(20000),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Statuses that imply a verified email / a completed contact.
  const EMAIL_STATUSES = new Set(['ready', 'drafting', 'drafted', 'contacted', 'replied', 'bounced']);
  const CONTACTED_STATUSES = new Set(['contacted', 'replied', 'bounced']);

  type Agg = { leads: number; withEmail: number; contacted: number; replied: number };
  const agg = new Map<string, Agg>();
  for (const m of members ?? []) {
    const a = agg.get(m.list_id) ?? { leads: 0, withEmail: 0, contacted: 0, replied: 0 };
    const status = (m.leads as unknown as { status: string } | null)?.status ?? '';
    a.leads++;
    if (EMAIL_STATUSES.has(status)) a.withEmail++;
    if (CONTACTED_STATUSES.has(status)) a.contacted++;
    if (status === 'replied') a.replied++;
    agg.set(m.list_id, a);
  }

  // Which lists have a sequence actively running against them?
  const activeSeq = new Map<string, string>();
  for (const e of enrollments ?? []) {
    if (!e.list_id) continue;
    if (e.status === 'active' || e.status === 'sending') {
      const seq = e.email_sequences as unknown as { name: string } | null;
      activeSeq.set(e.list_id, seq?.name ?? 'sequence');
    }
  }

  return NextResponse.json({
    lists: (lists ?? []).map((l) => ({
      ...l,
      ...(agg.get(l.id) ?? { leads: 0, withEmail: 0, contacted: 0, replied: 0 }),
      active_sequence: activeSeq.get(l.id) ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { name?: string; description?: string } | null;
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('lead_lists')
    .insert({ name: name.slice(0, 120), description: body?.description?.trim() || null })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ list: data });
}
