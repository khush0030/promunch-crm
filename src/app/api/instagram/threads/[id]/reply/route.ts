import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Human reply from the dashboard. Routes through the ig-send edge function so
// the send is recorded in ig_messages and any failure is Slack-alerted. Taking
// over a thread flips it to 'human' so the bot goes quiet.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const text = (body.text ?? '').toString().trim();
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

  // a human replying owns the conversation from here on
  await supabaseAdmin.from('ig_threads').update({ status: 'human' }).eq('id', id);

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ig-send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ thread_id: id, kind: 'text', text, sent_by: 'human' }),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
