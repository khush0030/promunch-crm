import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// GET a single thread with its full message history.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const [{ data: thread, error }, { data: messages }] = await Promise.all([
    supabaseAdmin.from('ig_threads').select('*').eq('id', id).maybeSingle(),
    supabaseAdmin
      .from('ig_messages')
      .select('*')
      .eq('thread_id', id)
      .order('created_at', { ascending: true }),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!thread) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // viewing a thread clears its unread badge
  await supabaseAdmin.from('ig_threads').update({ unread_count: 0 }).eq('id', id);

  return NextResponse.json({ thread, messages: messages ?? [] });
}
