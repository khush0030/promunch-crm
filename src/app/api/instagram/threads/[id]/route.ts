import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// GET a single thread with its full message history.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  // ?peek=1 = the Inbox hub previewing a thread without opening it — skip the
  // unread_count reset so the badge doesn't clear until the agent actually
  // opens the conversation. Everything else about this response is identical.
  const peek = new URL(req.url).searchParams.get('peek') === '1';

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
  if (!peek) await supabaseAdmin.from('ig_threads').update({ unread_count: 0 }).eq('id', id);

  return NextResponse.json({ thread, messages: messages ?? [] });
}
